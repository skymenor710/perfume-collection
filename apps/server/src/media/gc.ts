import path from 'node:path';
import { config } from '../config';
import { LocalStorageProvider, mediaStorage } from '../storage/local';
import type { StorageProvider } from '../storage/types';

/**
 * Limpeza de mídia: tira do armazenamento os arquivos que nenhum registro usa. Antes dela, cada "pesquisar de novo",
 * prévia cancelada ou remoção deixava arquivos para trás (17 de 23 eram órfãos na auditoria de 27/09/2026).
 *
 * NUNCA apaga: o órfão é COPIADO para a lixeira (data/orfas/<dia>/, fora da pasta servida) e só então sai de
 * data/media. A cópia é conferida antes (mesmo tamanho). Esvaziar a lixeira é decisão do dono.
 *
 * Carência de 6 h: uma importação cuja prévia ainda está aberta (fotos já salvas, perfume ainda não) não perde a foto.
 * Só imagens do nível de cima entram na conta (como sempre foi); subpastas e outros arquivos são deixados em paz.
 */

/** Lixeira do dia (data/orfas/AAAA-MM-DD). */
export function trashFor(day = new Date()): StorageProvider {
  const dir = path.join(config.dataDir, 'orfas', day.toISOString().slice(0, 10));
  return new LocalStorageProvider(() => dir, 'orfas/');
}

export async function collectMediaGarbage(
  referenced: Set<string>,
  graceMs = 6 * 60 * 60 * 1000,
  storage: StorageProvider = mediaStorage,
  now = Date.now(),
  trash: StorageProvider = trashFor(new Date(now)),
): Promise<{ removed: number; bytes: number }> {
  let removed = 0;
  let bytes = 0;
  for (const entry of await storage.list()) {
    if (entry.key.includes('/') || !/\.(webp|png|jpe?g|avif)$/i.test(entry.key)) continue;
    if (referenced.has(storage.publicUrl(entry.key))) continue;
    if (now - entry.modifiedAt.getTime() < graceMs) continue;
    const object = await storage.get(entry.key);
    if (!object) continue;
    // Primeiro a cópia na lixeira (conferida); só depois sai da pasta de mídia.
    if (!(await trash.exists(entry.key))) await trash.put(entry.key, object.body, { contentType: object.contentType });
    const kept = await trash.get(entry.key);
    if (!kept || kept.size !== object.size) continue;
    if (await storage.delete(entry.key)) {
      removed++;
      bytes += entry.size;
    }
  }
  return { removed, bytes };
}
