import { mediaStorage } from '../storage/local';
import type { StorageProvider } from '../storage/types';

/**
 * Limpeza de mídia: apaga do armazenamento os arquivos que nenhum registro usa. Antes dela, cada "pesquisar de novo",
 * prévia cancelada ou remoção deixava arquivos para trás (17 de 23 eram órfãos na auditoria de 27/09/2026) — e a
 * remoção nunca apagava o PNG mestre.
 *
 * Carência de 6 h: uma importação cuja prévia ainda está aberta (fotos já salvas, perfume ainda não) não perde a foto.
 * Só imagens do nível de cima entram na conta (como sempre foi); subpastas e outros arquivos são deixados em paz.
 */
export async function collectMediaGarbage(
  referenced: Set<string>,
  graceMs = 6 * 60 * 60 * 1000,
  storage: StorageProvider = mediaStorage,
  now = Date.now(),
): Promise<{ removed: number; bytes: number }> {
  let removed = 0;
  let bytes = 0;
  for (const entry of await storage.list()) {
    if (entry.key.includes('/') || !/\.(webp|png|jpe?g|avif)$/i.test(entry.key)) continue;
    if (referenced.has(storage.publicUrl(entry.key))) continue;
    if (now - entry.modifiedAt.getTime() < graceMs) continue;
    if (await storage.delete(entry.key)) {
      removed++;
      bytes += entry.size;
    }
  }
  return { removed, bytes };
}
