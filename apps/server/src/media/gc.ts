import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Limpeza de mídia: apaga de data/media os arquivos que nenhum registro usa. Antes dela, cada "pesquisar de novo",
 * prévia cancelada ou remoção deixava arquivos para trás (17 de 23 eram órfãos na auditoria de 27/09/2026) — e a
 * remoção nunca apagava o PNG mestre.
 *
 * Carência de 6 h: uma importação cuja prévia ainda está aberta (fotos já salvas, perfume ainda não) não perde a foto.
 */
export function collectMediaGarbage(referenced: Set<string>, graceMs = 6 * 60 * 60 * 1000): { removed: number; bytes: number } {
  let removed = 0;
  let bytes = 0;
  let files: string[];
  try {
    files = readdirSync(config.mediaDir);
  } catch {
    return { removed, bytes };
  }
  const now = Date.now();
  for (const file of files) {
    if (!/^[\w.-]+\.(webp|png|jpe?g|avif)$/i.test(file)) continue;
    if (referenced.has(`media/${file}`)) continue;
    const full = path.join(config.mediaDir, file);
    try {
      const stat = statSync(full);
      if (now - stat.mtimeMs < graceMs) continue;
      unlinkSync(full);
      removed++;
      bytes += stat.size;
    } catch {
      /* arquivo em uso ou já removido: fica para a próxima */
    }
  }
  return { removed, bytes };
}
