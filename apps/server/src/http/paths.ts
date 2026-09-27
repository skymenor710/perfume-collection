import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve um caminho dentro de `root` sem permitir sair dele (../, barras invertidas, caminhos absolutos).
 * Só devolve arquivos que existem. Base de toda leitura de arquivo pedida por URL.
 */
export function inside(root: string, rel: string): string | null {
  if (rel.includes('\0')) return null;
  const target = path.resolve(root, `.${path.posix.normalize(`/${rel.replace(/\\/g, '/')}`)}`);
  return target.startsWith(path.resolve(root) + path.sep) && existsSync(target) && statSync(target).isFile() ? target : null;
}

/** decodeURIComponent que não explode com "%E0%A4%A" (vira nulo = 404, não 500). */
export function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
