import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { sanitizeLibrary, type Library } from '@perfumes/core/library';
import { volumeMl } from '@perfumes/core/volume';
import type { Db } from './client';
import { deepDiff, diffLibraries, type Difference } from './compare';
import { libraryToRows, type EntryRow, type ImageRow, type LibraryRows, type ProductRow, type UserRow, type VariantRow } from './mapping';
import { entries, importJobs, productImages, products, productVariants, users } from './schema';
import { loadLibrary, sortedLibrary } from './snapshot';

/**
 * Importação data/library.json → Postgres.
 *
 * 1. VALIDA tudo antes de tocar no banco (estrutura, referências, imagens no disco, versões, entradas, valores).
 * 2. Numa ÚNICA transação (com trava exclusiva de importação): insere o que falta, confere o que já existe.
 * 3. VERIFICA dentro da mesma transação: relê o banco e compara campo a campo com o JSON. Diferença = ROLLBACK.
 * 4. Só então COMMIT. Nada fica pela metade.
 *
 * Idempotente: rodar de novo com o mesmo arquivo não muda nada ("nenhuma alteração necessária"). Se o banco tiver
 * um registro DIFERENTE do JSON (ex.: o app já gravou no Postgres depois da troca), a importação PARA e lista as
 * diferenças — só atualiza com `allowUpdate` explícito. Registro que só existe no banco nunca é apagado.
 */

export interface ImageCheck {
  ref: string;
  file: string | null;
  exists: boolean;
  sha256: string | null;
}

export interface Validation {
  ok: boolean;
  library: Library;
  problems: string[];
  warnings: string[];
  images: ImageCheck[];
  counts: { users: number; products: number; variants: number; images: number; entries: number; imageFiles: number };
}

const MONEY_MAX = 9_999_999_999.99;
const isIso = (s: string | null) => s === null || (typeof s === 'string' && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s);
const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) / 100 - n) < 1e-9;

/** Onde mora o arquivo de uma referência de imagem ("bottles/…" no site, "media/…" nos dados). */
export type ImageResolver = (ref: string) => string | null;

/** Valida o conteúdo bruto do library.json. Não toca em banco. */
export function validateLibrary(raw: unknown, resolveImage: ImageResolver): Validation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const { library, dropped } = sanitizeLibrary(raw);
  if (dropped) problems.push(`${dropped} entrada(s) inválida(s) seriam descartadas pela validação`);

  // 1. Estrutura sem perda: o que a validação devolve tem de ser IGUAL ao arquivo (nada corrigido em silêncio).
  const rawLib = raw as Library;
  if (rawLib?.schemaVersion !== library.schemaVersion) problems.push(`schemaVersion ${String(rawLib?.schemaVersion)} (esperado ${library.schemaVersion})`);
  for (const d of diffLibraries(rawLib && Array.isArray(rawLib.users) ? rawLib : { ...library, users: [], products: [], entries: [] }, library)) {
    problems.push(`o arquivo seria alterado ao validar: ${d.path}: ${JSON.stringify(d.left)} → ${JSON.stringify(d.right)}`);
  }

  // 2. Unicidade.
  const dup = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) problems.push(`${label} duplicado: ${k}`);
      seen.add(k);
    }
  };
  dup('usuário', library.users.map((u) => u.id));
  dup('username', library.users.map((u) => u.username.toLowerCase()));
  dup('produto', library.products.map((p) => p.id));
  dup('entrada', library.entries.map((e) => e.id));
  dup('entrada (pessoa+produto+lista)', library.entries.map((e) => `${e.userId}|${e.productId}|${e.list}`));
  for (const p of library.products) {
    dup(`versão do produto ${p.id}`, p.variants.map((v) => v.id));
    dup(`imagem do produto ${p.id}`, p.images.map((i) => i.url));
  }

  // 3. Referências.
  const productById = new Map(library.products.map((p) => [p.id, p]));
  const userIds = new Set(library.users.map((u) => u.id));
  for (const e of library.entries) {
    const p = productById.get(e.productId);
    if (!p) problems.push(`entrada ${e.id}: produto ${e.productId} não existe`);
    if (!userIds.has(e.userId)) problems.push(`entrada ${e.id}: usuário ${e.userId} não existe`);
    if (p && e.variantId && !p.variants.some((v) => v.id === e.variantId)) problems.push(`entrada ${e.id}: versão ${e.variantId} não é do produto ${p.id}`);
  }
  for (const p of library.products) {
    for (const i of p.images) if (i.variantId && !p.variants.some((v) => v.id === i.variantId)) problems.push(`imagem ${i.url}: versão ${i.variantId} não é do produto ${p.id}`);
  }

  // 4. Valores (o que o banco guardaria diferente é recusado antes).
  const checkMoney = (where: string, v: number | null) => {
    if (v === null) return;
    if (!Number.isFinite(v) || v < 0 || v > MONEY_MAX) problems.push(`${where}: preço fora do intervalo (${v})`);
    else if (!twoDecimals(v)) problems.push(`${where}: preço com mais de 2 casas (${v}) — numeric(12,2) arredondaria`);
  };
  const checkCurrency = (where: string, c: string | null) => {
    if (c !== null && !/^[A-Z]{3}$/.test(c)) problems.push(`${where}: moeda "${c}" não é um código ISO de 3 letras`);
  };
  const checkVolume = (where: string, text: string | null) => {
    if (text && volumeMl(text) === null) warnings.push(`${where}: volume "${text}" não é um volume único — guardado como texto, volume_ml vazio`);
  };
  for (const u of library.users) {
    if (!isIso(u.createdAt) || !isIso(u.updatedAt)) problems.push(`usuário ${u.id}: data fora do formato ISO`);
  }
  for (const p of library.products) {
    if (!isIso(p.createdAt) || !isIso(p.updatedAt)) problems.push(`produto ${p.id}: data fora do formato ISO`);
    p.variants.forEach((v) => {
      checkMoney(`versão ${p.id}/${v.id}`, v.price);
      checkCurrency(`versão ${p.id}/${v.id}`, v.currency);
      checkVolume(`versão ${p.id}/${v.id}`, v.volume);
    });
  }
  for (const e of library.entries) {
    checkMoney(`entrada ${e.id}`, e.price);
    checkCurrency(`entrada ${e.id}`, e.currency);
    checkVolume(`entrada ${e.id}`, e.volume);
    if (!Number.isInteger(e.position) || Math.abs(e.position) > 2_147_483_647) problems.push(`entrada ${e.id}: posição inválida (${e.position})`);
    if (!isIso(e.addedAt) || !isIso(e.updatedAt) || !isIso(e.acquiredAt)) problems.push(`entrada ${e.id}: data fora do formato ISO`);
    if (e.notes && e.notes.length > 1000) problems.push(`entrada ${e.id}: observação com mais de 1000 caracteres`);
  }

  // 5. Imagens: cada referência precisa do arquivo no disco (e o conteúdo fica registrado pelo SHA-256).
  const refs = new Set<string>();
  for (const p of library.products) for (const i of p.images) for (const r of [i.url, i.thumbUrl, i.masterUrl]) if (r) refs.add(r);
  for (const u of library.users) if (u.avatarUrl) refs.add(u.avatarUrl);
  const images: ImageCheck[] = [...refs].sort().map((ref) => {
    const file = resolveImage(ref);
    const exists = Boolean(file && existsSync(file));
    return { ref, file, exists, sha256: exists ? createHash('sha256').update(readFileSync(file!)).digest('hex') : null };
  });
  for (const i of images) if (!i.exists) problems.push(`imagem ${i.ref}: arquivo não encontrado`);

  const rows = libraryToRows(library);
  return {
    ok: problems.length === 0,
    library,
    problems,
    warnings,
    images,
    counts: { users: rows.users.length, products: rows.products.length, variants: rows.variants.length, images: rows.images.length, entries: rows.entries.length, imageFiles: images.length },
  };
}

/* ------------------------------------------------------------------ importação */

export interface TableReport {
  source: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Registros que só existem no banco (nunca apagados). */
  onlyInDb: number;
}

export interface ImportReport {
  ok: boolean;
  dryRun: boolean;
  stage: 'validação' | 'conflito' | 'verificação' | 'checagens' | 'concluído';
  message: string;
  tables: Record<'users' | 'products' | 'variants' | 'images' | 'entries' | 'importJobs', TableReport>;
  conflicts: Difference[];
  verification: Difference[];
  checks: string[];
  validation: Pick<Validation, 'problems' | 'warnings' | 'counts'>;
  changed: boolean;
}

export interface ImportOptions {
  dryRun?: boolean;
  /** Atualiza registros que já existem no banco com valores diferentes (padrão: para e mostra as diferenças). */
  allowUpdate?: boolean;
  /** Checagens extras sobre o banco já importado (ex.: baseline, Mykonos 50 ml). Qualquer problema = ROLLBACK. */
  checks?: (db: Library) => string[];
  /** Falha proposital numa etapa (só testes de rollback). */
  failAt?: 'users' | 'products' | 'variants' | 'images' | 'entries' | 'verification';
}

class Rollback extends Error {
  constructor(readonly report: ImportReport) {
    super(report.message);
  }
}

const emptyTable = (source: number): TableReport => ({ source, inserted: 0, updated: 0, unchanged: 0, onlyInDb: 0 });

/** Forma comparável de uma linha: datas em ISO, numéricos como número, documentos como texto; só as colunas dadas. */
function comparable(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) out[k] = v.toISOString();
    else if ((k === 'price' || k === 'volumeMl') && v !== null && v !== undefined) out[k] = Number(v);
    else if (v !== null && typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v ?? null;
  }
  return out;
}

export async function importLibrary(db: Db, validation: Validation, options: ImportOptions = {}): Promise<ImportReport> {
  const rows: LibraryRows = libraryToRows(validation.library);
  // A imagem principal leva o SHA-256 do arquivo (base da chave por conteúdo no R2).
  const shaByRef = new Map(validation.images.map((i) => [i.ref, i.sha256]));
  const images: ImageRow[] = rows.images.map((i) => ({ ...i, sha256: shaByRef.get(i.ref) ?? null }));
  const report: ImportReport = {
    ok: false,
    dryRun: Boolean(options.dryRun),
    stage: 'validação',
    message: '',
    tables: {
      users: emptyTable(rows.users.length),
      products: emptyTable(rows.products.length),
      variants: emptyTable(rows.variants.length),
      images: emptyTable(images.length),
      entries: emptyTable(rows.entries.length),
      importJobs: emptyTable(0),
    },
    conflicts: [],
    verification: [],
    checks: [],
    validation: { problems: validation.problems, warnings: validation.warnings, counts: validation.counts },
    changed: false,
  };
  if (!validation.ok) {
    report.message = `Validação falhou (${validation.problems.length} problema(s)); o banco não foi tocado.`;
    return report;
  }

  try {
    await db.transaction(async (tx) => {
      // Uma importação por vez, em qualquer processo (trava liberada no fim da transação).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('perfumes:library-import'))`);

      const plan = async <R extends Record<string, unknown>>(
        name: keyof ImportReport['tables'],
        desired: R[],
        existing: Record<string, unknown>[],
        keyOf: (r: Record<string, unknown>) => string,
      ) => {
        const table = report.tables[name];
        const current = new Map(existing.map((r) => [keyOf(r), r]));
        const keys = Object.keys(desired[0] ?? {});
        const toInsert: R[] = [];
        const toUpdate: R[] = [];
        for (const row of desired) {
          const found = current.get(keyOf(row));
          if (!found) toInsert.push(row);
          else {
            const diffs = deepDiff(comparable(found, keys), comparable(row, keys), `${name}[${keyOf(row)}]`);
            if (diffs.length) {
              toUpdate.push(row);
              report.conflicts.push(...diffs);
            } else table.unchanged++;
          }
        }
        const desiredKeys = new Set(desired.map(keyOf));
        table.onlyInDb = existing.filter((r) => !desiredKeys.has(keyOf(r))).length;
        return { toInsert, toUpdate };
      };

      const [u, p, v, i, e, jobs] = await Promise.all([
        tx.select().from(users),
        tx.select().from(products),
        tx.select().from(productVariants),
        tx.select().from(productImages),
        tx.select().from(entries),
        tx.select({ id: importJobs.id }).from(importJobs),
      ]);
      report.tables.importJobs.onlyInDb = jobs.length;
      const plans = {
        users: await plan('users', rows.users as UserRow[], u, (r) => String(r.id)),
        products: await plan('products', rows.products as ProductRow[], p, (r) => String(r.id)),
        variants: await plan('variants', rows.variants as VariantRow[], v, (r) => `${r.productId}|${r.id}`),
        images: await plan('images', images, i, (r) => `${r.productId}|${r.ref}`),
        entries: await plan('entries', rows.entries as EntryRow[], e, (r) => String(r.id)),
      };

      if (report.conflicts.length && !options.allowUpdate) {
        report.stage = 'conflito';
        report.message = `O banco já tem ${report.conflicts.length} valor(es) diferente(s) do JSON. Nada foi alterado. Confira as diferenças; para sobrescrever com o JSON, rode de novo com --allow-update.`;
        throw new Rollback(report);
      }

      const fail = (at: ImportOptions['failAt']) => {
        if (options.failAt === at) throw new Error(`falha proposital de teste na etapa ${at}`);
      };

      // Ordem das chaves estrangeiras: usuários → produtos → versões → imagens → entradas.
      if (plans.users.toInsert.length) await tx.insert(users).values(plans.users.toInsert);
      for (const r of plans.users.toUpdate) await tx.update(users).set(r).where(eq(users.id, r.id));
      fail('users');
      if (plans.products.toInsert.length) await tx.insert(products).values(plans.products.toInsert);
      for (const r of plans.products.toUpdate) await tx.update(products).set(r).where(eq(products.id, r.id));
      fail('products');
      if (plans.variants.toInsert.length) await tx.insert(productVariants).values(plans.variants.toInsert);
      for (const r of plans.variants.toUpdate) await tx.update(productVariants).set(r).where(and(eq(productVariants.productId, r.productId), eq(productVariants.id, r.id)));
      fail('variants');
      if (plans.images.toInsert.length) await tx.insert(productImages).values(plans.images.toInsert);
      for (const r of plans.images.toUpdate) await tx.update(productImages).set(r).where(and(eq(productImages.productId, r.productId), eq(productImages.ref, r.ref)));
      fail('images');
      if (plans.entries.toInsert.length) await tx.insert(entries).values(plans.entries.toInsert);
      for (const r of plans.entries.toUpdate) await tx.update(entries).set(r).where(eq(entries.id, r.id));
      fail('entries');

      for (const name of ['users', 'products', 'variants', 'images', 'entries'] as const) {
        report.tables[name].inserted = plans[name].toInsert.length;
        report.tables[name].updated = plans[name].toUpdate.length;
      }
      report.changed = Object.values(plans).some((pl) => pl.toInsert.length + pl.toUpdate.length > 0);

      // Verificação DENTRO da transação: o banco relido tem de ser igual ao JSON, campo a campo.
      const inDb = await loadLibrary(tx as unknown as Db);
      const ids = {
        users: new Set(validation.library.users.map((x) => x.id)),
        products: new Set(validation.library.products.map((x) => x.id)),
        entries: new Set(validation.library.entries.map((x) => x.id)),
      };
      const subset = { ...inDb, users: inDb.users.filter((x) => ids.users.has(x.id)), products: inDb.products.filter((x) => ids.products.has(x.id)), entries: inDb.entries.filter((x) => ids.entries.has(x.id)) };
      report.verification = diffLibraries(sortedLibrary(validation.library), subset);
      if (options.failAt === 'verification') report.verification.push({ path: '(teste)', left: 'forçado', right: 'forçado' });
      if (report.verification.length) {
        report.stage = 'verificação';
        report.message = `A verificação encontrou ${report.verification.length} diferença(s) entre JSON e banco. ROLLBACK: nada foi gravado.`;
        throw new Rollback(report);
      }
      report.checks = options.checks?.(inDb) ?? [];
      if (report.checks.length) {
        report.stage = 'checagens';
        report.message = `Checagens falharam (${report.checks.length}). ROLLBACK: nada foi gravado.`;
        throw new Rollback(report);
      }
      if (options.dryRun) {
        report.stage = 'concluído';
        report.ok = true;
        report.message = report.changed ? 'Ensaio concluído: tudo passaria. ROLLBACK proposital — nada foi gravado.' : 'Ensaio: nenhuma alteração necessária.';
        throw new Rollback(report);
      }
    });
  } catch (error) {
    if (error instanceof Rollback) {
      // Falha (conflito, verificação, checagens): nada foi gravado — as contagens voltam a zero.
      // Ensaio (dry-run) bem-sucedido: as contagens mostram o que SERIA feito.
      if (!error.report.ok) {
        for (const t of Object.values(error.report.tables)) {
          t.inserted = 0;
          t.updated = 0;
        }
        error.report.changed = false;
      }
      return error.report;
    }
    report.ok = false;
    report.stage = report.stage === 'validação' ? 'verificação' : report.stage;
    report.message = `Erro durante a importação — ROLLBACK, nada foi gravado: ${(error as Error).message}`;
    for (const t of Object.values(report.tables)) {
      t.inserted = 0;
      t.updated = 0;
    }
    report.changed = false;
    throw Object.assign(new Error(report.message), { report });
  }
  report.ok = true;
  report.stage = 'concluído';
  report.message = report.changed ? 'Importação concluída e verificada.' : 'Nenhuma alteração necessária: o banco já está igual ao JSON.';
  return report;
}
