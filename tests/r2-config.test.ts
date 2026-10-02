import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, ConfigError, describeConfig, diagnoseR2, formatR2Diagnosis, parseEnv, reloadConfig } from '../apps/server/src/config';
import { mediaSettings } from '../apps/server/src/media/content';
import { R2StorageProvider } from '../apps/server/src/storage/r2';
import { networkTrap, setupTempData } from './helpers/media-fixtures';

/**
 * FASE 3.1 (hardening sem credenciais) — configuração do R2: diagnóstico, endpoint, jurisdição, URL pública, modo local.
 * Tudo com valores FICTÍCIOS e SEM rede: `fetch` é trocado por uma armadilha que registra e derruba qualquer chamada para fora do laço local.
 */

setupTempData('r2cfg');

const ACC = '0123456789abcdef0123456789abcdef';
const SECRET = 'segredo-de-teste-nao-real';
const KEYID = 'chave-de-teste-nao-real';
const BUCKET = 'meus-perfumes-teste';
const OK = { R2_ACCOUNT_ID: ACC, R2_ACCESS_KEY_ID: KEYID, R2_SECRET_ACCESS_KEY: SECRET, R2_BUCKET: BUCKET, R2_PUBLIC_BASE_URL: 'https://img.exemplo.test' };

let trap: ReturnType<typeof networkTrap>;
beforeEach(() => {
  trap = networkTrap();
});
afterEach(() => {
  expect(trap.offending).toEqual([]);
  trap.restore();
  for (const k of Object.keys(process.env)) if (/^(MEDIA_|R2_)/.test(k)) delete process.env[k];
  reloadConfig();
});

const useEnv = (vars: Record<string, string>) => {
  for (const k of Object.keys(process.env)) if (/^(MEDIA_|R2_)/.test(k)) delete process.env[k];
  Object.assign(process.env, vars);
  reloadConfig();
};

describe('diagnóstico do R2 (puro, sem rede, sem valores)', () => {
  it('nada definido → absent; só o bucket → partial; tudo → complete', () => {
    const none = diagnoseR2({});
    expect(none.state).toBe('absent');
    expect(none.settings).toBeNull();
    const some = diagnoseR2({ R2_BUCKET: BUCKET });
    expect(some.state).toBe('partial');
    expect(some.components.filter((c) => c.status === 'missing').map((c) => c.name)).toEqual(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL', 'R2_ENDPOINT ou R2_ACCOUNT_ID']);
    expect(diagnoseR2(OK).state).toBe('complete');
  });

  it.each([
    ['R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'],
    ['R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'],
    ['R2_BUCKET', 'R2_BUCKET'],
    ['R2_PUBLIC_BASE_URL', 'R2_PUBLIC_BASE_URL'],
    ['R2_ACCOUNT_ID', 'R2_ENDPOINT ou R2_ACCOUNT_ID'],
  ])('falta só %s → partial, e o diagnóstico aponta exatamente esse componente', (removed, component) => {
    const env: Record<string, string> = { ...OK };
    delete env[removed];
    const d = diagnoseR2(env);
    expect(d.state).toBe('partial');
    expect(d.components.filter((c) => c.status !== 'ok').map((c) => c.name)).toEqual([component]);
    expect(d.settings).toBeNull();
  });

  it('R2_ENDPOINT sozinho substitui o Account ID; o Account ID sozinho gera o endpoint', () => {
    const { R2_ACCOUNT_ID: _omit, ...withoutAccount } = OK;
    expect(diagnoseR2({ ...withoutAccount, R2_ENDPOINT: 'https://s3.exemplo.test' }).state).toBe('complete');
    expect(diagnoseR2(OK).settings?.endpoint).toBe(`https://${ACC}.r2.cloudflarestorage.com`);
  });

  it.each([
    ['padrão (derivado do Account ID)', OK, `https://${ACC}.r2.cloudflarestorage.com`],
    ['Account ID em maiúsculas vira minúsculo', { ...OK, R2_ACCOUNT_ID: ACC.toUpperCase() }, `https://${ACC}.r2.cloudflarestorage.com`],
    ['customizado', { ...OK, R2_ENDPOINT: 'https://s3.exemplo.test' }, 'https://s3.exemplo.test'],
    ['customizado com barra final (normalizado)', { ...OK, R2_ENDPOINT: 'https://s3.exemplo.test/' }, 'https://s3.exemplo.test'],
    ['com jurisdição UE', { ...OK, R2_ENDPOINT: `https://${ACC}.eu.r2.cloudflarestorage.com` }, `https://${ACC}.eu.r2.cloudflarestorage.com`],
    ['com jurisdição FedRAMP', { ...OK, R2_ENDPOINT: `https://${ACC}.fedramp.r2.cloudflarestorage.com` }, `https://${ACC}.fedramp.r2.cloudflarestorage.com`],
  ])('endpoint %s', (_label, env, expected) => {
    const d = diagnoseR2(env);
    expect(d.state).toBe('complete');
    expect(d.settings?.endpoint).toBe(expected);
  });

  it.each([
    ['com caminho', 'https://s3.exemplo.test/caminho'],
    ['duplicando o bucket no caminho', `https://s3.exemplo.test/${BUCKET}`],
    ['http', 'http://s3.exemplo.test'],
    ['com query', 'https://s3.exemplo.test/?a=1'],
    ['com usuário e senha', 'https://usuario:senha@s3.exemplo.test'],
    ['de outra conta (identificador diferente de R2_ACCOUNT_ID)', `https://${'f'.repeat(32)}.r2.cloudflarestorage.com`],
  ])('endpoint inválido: %s', (_label, endpoint) => {
    const d = diagnoseR2({ ...OK, R2_ENDPOINT: endpoint });
    expect(d.state).toBe('invalid');
    expect(d.problems.map((p) => p.name)).toContain('R2_ENDPOINT');
    expect(d.settings).toBeNull();
  });

  it.each([
    ['igual ao endpoint S3 explícito', { R2_ENDPOINT: 'https://s3.exemplo.test', R2_PUBLIC_BASE_URL: 'https://s3.exemplo.test' }],
    ['igual ao endpoint S3 derivado do Account ID', { R2_PUBLIC_BASE_URL: `https://${ACC}.r2.cloudflarestorage.com` }],
    ['qualquer host r2.cloudflarestorage.com (outro bucket/conta)', { R2_PUBLIC_BASE_URL: 'https://outra.r2.cloudflarestorage.com' }],
    ['o endpoint S3 da jurisdição UE', { R2_PUBLIC_BASE_URL: `https://${ACC}.eu.r2.cloudflarestorage.com` }],
    ['com o nome do bucket no caminho (bucket duplicado)', { R2_PUBLIC_BASE_URL: `https://img.exemplo.test/${BUCKET}` }],
    ['com o nome do bucket no meio do caminho', { R2_PUBLIC_BASE_URL: `https://img.exemplo.test/a/${BUCKET}/b` }],
    ['com barras duplicadas no caminho', { R2_PUBLIC_BASE_URL: 'https://img.exemplo.test//fotos' }],
    ['http', { R2_PUBLIC_BASE_URL: 'http://img.exemplo.test' }],
    ['com query', { R2_PUBLIC_BASE_URL: 'https://img.exemplo.test/?x=1' }],
    ['com fragmento', { R2_PUBLIC_BASE_URL: 'https://img.exemplo.test/#x' }],
    ['com usuário e senha', { R2_PUBLIC_BASE_URL: 'https://usuario:senha@img.exemplo.test' }],
  ])('R2_PUBLIC_BASE_URL inválida: %s', (_label, extra) => {
    const d = diagnoseR2({ ...OK, ...extra });
    expect(d.state).toBe('invalid');
    expect(d.problems.map((p) => p.name)).toContain('R2_PUBLIC_BASE_URL');
    expect(d.settings).toBeNull();
  });

  it.each([
    ['r2.dev', 'https://pub-0123456789abcdef.r2.dev', 'https://pub-0123456789abcdef.r2.dev'],
    ['domínio próprio com barra final (normalizada)', 'https://img.exemplo.test/', 'https://img.exemplo.test'],
    ['caminho-base com várias barras finais (normalizado)', 'https://img.exemplo.test/fotos///', 'https://img.exemplo.test/fotos'],
  ])('R2_PUBLIC_BASE_URL válida: %s', (_label, url, expected) => {
    const d = diagnoseR2({ ...OK, R2_PUBLIC_BASE_URL: url });
    expect(d.state).toBe('complete');
    expect(d.settings?.publicBaseUrl).toBe(expected);
  });

  it('nenhuma saída repete o valor recebido nem os segredos (diagnóstico, mensagens, texto do terminal)', () => {
    const bad = { R2_ACCOUNT_ID: 'MARCADOR-SECRETO', R2_BUCKET: 'MARCADOR_SECRETO', R2_ENDPOINT: 'https://MARCADOR-SECRETO.exemplo.test/caminho', R2_PUBLIC_BASE_URL: 'http://MARCADOR-SECRETO.exemplo.test', R2_ACCESS_KEY_ID: KEYID, R2_SECRET_ACCESS_KEY: SECRET };
    const d = diagnoseR2(bad);
    const all = `${JSON.stringify(d)}\n${formatR2Diagnosis(d).join('\n')}`;
    for (const forbidden of [/MARCADOR/i, SECRET, KEYID]) expect(all).not.toMatch(forbidden);
    let message = '';
    try {
      parseEnv({ ...bad, MEDIA_BACKEND: 'r2' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/R2_ENDPOINT/);
    for (const forbidden of [/MARCADOR/i, SECRET, KEYID]) expect(message).not.toMatch(forbidden);
  });

  it('o diagnóstico inteiro pode ir para um log: as chaves ficam fora do JSON (settings não é enumerável), mas o provedor as lê', () => {
    const d = diagnoseR2(OK);
    expect(JSON.stringify(d)).not.toContain(SECRET);
    expect(JSON.stringify(d)).not.toContain(KEYID);
    expect(Object.keys(d)).not.toContain('settings');
    expect(d.settings?.secretAccessKey).toBe(SECRET);
  });
});

describe('modo local: R2 parcial ou inválido NÃO derruba o app; MEDIA_BACKEND=r2 derruba com os nomes', () => {
  it.each([
    ['ausente', {}],
    ['parcial (faltam o segredo e a URL pública)', { R2_ACCOUNT_ID: ACC, R2_ACCESS_KEY_ID: KEYID, R2_BUCKET: BUCKET }],
    ['com formato inválido', { ...OK, R2_BUCKET: 'Bucket_Invalido' }],
  ])('MEDIA_BACKEND=local (ou ausente) com R2 %s: parseEnv passa e o modo é local', (_label, vars) => {
    expect(parseEnv(vars).MEDIA_BACKEND).toBe('local');
    expect(parseEnv({ ...vars, MEDIA_BACKEND: 'local' }).MEDIA_BACKEND).toBe('local');
  });

  it('MEDIA_BACKEND=r2 com configuração incompleta: não sobe, e a mensagem lista só NOMES', () => {
    try {
      parseEnv({ MEDIA_BACKEND: 'r2', R2_BUCKET: BUCKET });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL', 'R2_ENDPOINT']) expect(message).toContain(name);
      expect(message).not.toContain(BUCKET);
    }
  });

  it('MEDIA_BACKEND=r2 com tudo válido sobe', () => {
    expect(parseEnv({ ...OK, MEDIA_BACKEND: 'r2' }).MEDIA_BACKEND).toBe('r2');
  });

  it('config.r2 só existe com R2 completo E válido; o diagnóstico da configuração acompanha', () => {
    useEnv({ ...OK });
    expect(config.r2).not.toBeNull();
    expect(config.r2Diagnosis.state).toBe('complete');
    useEnv({ R2_BUCKET: BUCKET });
    expect(config.r2).toBeNull();
    expect(config.r2Diagnosis.state).toBe('partial');
    useEnv({ ...OK, R2_BUCKET: 'Bucket_Invalido' });
    expect(config.r2).toBeNull();
    expect(config.r2Diagnosis.state).toBe('invalid');
    expect(config.mediaBackend).toBe('local');
  });

  it('describeConfig (o que vai para o log de partida) traz o estado e QUAIS componentes precisam de atenção — nunca valores', () => {
    const partial = describeConfig(parseEnv({ R2_ACCOUNT_ID: ACC, R2_ACCESS_KEY_ID: KEYID, R2_BUCKET: BUCKET, R2_PUBLIC_BASE_URL: 'https://img.exemplo.test' }));
    expect(partial.media).toMatchObject({ backend: 'local', r2Configured: false, r2State: 'partial', r2Attention: ['R2_SECRET_ACCESS_KEY: ausente'] });
    const invalid = describeConfig(parseEnv({ ...OK, R2_BUCKET: 'Bucket_Invalido' }));
    expect(invalid.media).toMatchObject({ r2State: 'invalid', r2Attention: ['R2_BUCKET: inválido'] });
    const complete = describeConfig(parseEnv(OK));
    expect(complete.media).toMatchObject({ r2Configured: true, r2State: 'complete', r2Attention: [] });
    const absent = describeConfig(parseEnv({}));
    expect(absent.media).toMatchObject({ r2Configured: false, r2State: 'absent', r2Attention: [] });
    const text = JSON.stringify([partial, invalid, complete, absent]);
    for (const forbidden of [SECRET, KEYID, ACC, 'img.exemplo.test', BUCKET, 'Bucket_Invalido']) expect(text).not.toContain(forbidden);
  });
});

describe('R2StorageProvider — endereço, bucket e URL pública (sem rede)', () => {
  /** fetch de mentira: anota o pedido assinado e responde 200 — nada sai do processo. */
  function capture() {
    const seen: { method: string; url: string }[] = [];
    const fetch = async (request: Request) => {
      seen.push({ method: request.method, url: request.url });
      return request.method === 'GET' ? new Response('x', { status: 200, headers: { 'content-length': '1' } }) : new Response(null, { status: request.method === 'DELETE' ? 204 : 200 });
    };
    return { seen, fetch };
  }
  const key = `p/${'a'.repeat(64)}.webp`;

  it.each([
    ['padrão', OK, `https://${ACC}.r2.cloudflarestorage.com`],
    ['customizado', { ...OK, R2_ENDPOINT: 'https://s3.exemplo.test' }, 'https://s3.exemplo.test'],
    ['jurisdição UE', { ...OK, R2_ENDPOINT: `https://${ACC}.eu.r2.cloudflarestorage.com` }, `https://${ACC}.eu.r2.cloudflarestorage.com`],
  ])('endpoint %s: o bucket aparece UMA vez e put/get/exists/delete usam a mesma URL', async (_label, env, origin) => {
    const settings = diagnoseR2(env).settings!;
    const { seen, fetch } = capture();
    const r2 = new R2StorageProvider(settings, { fetch });
    await r2.put(key, Buffer.from('x'), { contentType: 'image/webp' });
    await r2.get(key);
    await r2.exists(key);
    await r2.delete(key);
    const urls = new Set(seen.map((s) => s.url));
    expect(urls).toEqual(new Set([`${origin}/${BUCKET}/${key}`]));
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'GET', 'HEAD', 'HEAD', 'DELETE']);
    expect([...urls][0]!.split(BUCKET).length - 1).toBe(1);
  });

  it('a URL pública nunca sai do endereço S3 e não repete barras nem o bucket', () => {
    const settings = diagnoseR2({ ...OK, R2_PUBLIC_BASE_URL: 'https://img.exemplo.test/fotos/' }).settings!;
    const r2 = new R2StorageProvider(settings, { fetch: capture().fetch });
    expect(r2.publicUrl(key)).toBe(`https://img.exemplo.test/fotos/${key}`);
    expect(r2.publicUrl(key)).not.toContain('r2.cloudflarestorage.com');
    expect(r2.publicUrl(key)).not.toContain(BUCKET);
    expect(r2.publicUrl(key)).not.toMatch(/[^:]\/\//);
  });

  it('defesa em profundidade: o provedor recusa ser criado com o endereço S3 como endereço público', () => {
    const base = diagnoseR2(OK).settings!;
    expect(() => new R2StorageProvider({ ...base, publicBaseUrl: base.endpoint })).toThrow(/não pode ser o endereço S3/);
    expect(() => new R2StorageProvider({ ...base, publicBaseUrl: `${base.endpoint}/fotos` })).toThrow(/não pode ser o endereço S3/);
    expect(() => new R2StorageProvider(base)).not.toThrow();
  });

  it('configuração inválida ou incompleta nunca cria cliente nem dispara rede; em modo local não existe provedor', () => {
    useEnv({ ...OK, R2_PUBLIC_BASE_URL: 'http://img.exemplo.test' });
    expect(config.r2).toBeNull();
    expect(mediaSettings().remote).toBeNull();
    useEnv({ ...OK });
    expect(config.r2).not.toBeNull();
    expect(mediaSettings().backend).toBe('local');
    expect(mediaSettings().remote).toBeNull();
    useEnv({ ...OK, MEDIA_BACKEND: 'r2' });
    expect(mediaSettings().remote).toBeInstanceOf(R2StorageProvider);
    // (criar o provedor não chama a rede: a armadilha de fetch do beforeEach confere no afterEach)
  });
});
