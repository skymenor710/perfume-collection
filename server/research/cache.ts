import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Cache em disco (data/cache) para respostas de fontes externas: catálogos de loja, páginas de marca no
 * Fragrantica. Pesquisar o mesmo perfume duas vezes não deve bater duas vezes no site de ninguém.
 */

const dir = () => path.join(config.dataDir, 'cache');

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const file = path.join(dir(), `${createHash('sha1').update(key).digest('hex').slice(0, 20)}.json`);
  try {
    const hit = JSON.parse(readFileSync(file, 'utf8')) as { at: number; value: T };
    if (Date.now() - hit.at < ttlMs) return hit.value;
  } catch {
    /* sem cache ainda */
  }
  const value = await load();
  // Falha ou vazio não fica guardado: pode ter sido a rede, e a próxima tentativa merece ir à fonte.
  if (value === null || (Array.isArray(value) && value.length === 0)) return value;
  try {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now(), key, value }));
  } catch {
    /* cache é conveniência */
  }
  return value;
}

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;
