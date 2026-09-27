import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { assertValidKey, contentTypeOf, isValidKey, type PutOptions, type StorageProvider, type StoredEntry, type StoredObject } from './types';

/**
 * Armazenamento numa pasta local (data/media). Duas travas contra sair da pasta: a chave passa pela validação
 * (sem "..", sem barra inicial) E o caminho final é conferido depois de resolvido.
 * Gravação atômica: escreve num arquivo temporário e renomeia — nunca fica foto pela metade.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  constructor(
    /** Pasta raiz (função: a configuração pode mudar em testes). */
    private readonly root: () => string,
    /** Prefixo das referências públicas ("media/" → "media/abc-lg.webp", o formato que o app já usa). */
    private readonly urlPrefix = 'media/',
  ) {}

  /** Caminho no disco de uma chave, ou nulo se a chave for inválida ou escapar da raiz. */
  resolve(key: string): string | null {
    if (!isValidKey(key)) return null;
    const root = path.resolve(this.root());
    const target = path.resolve(root, ...key.split('/'));
    return target.startsWith(root + path.sep) ? target : null;
  }

  private require(key: string): string {
    assertValidKey(key);
    const file = this.resolve(key);
    if (!file) throw new Error('Chave fora da pasta de armazenamento');
    return file;
  }

  async put(key: string, body: Buffer, _options: PutOptions): Promise<void> {
    const file = this.require(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.resolve(key);
    if (!file) return null;
    try {
      const [body, info] = await Promise.all([readFile(file), stat(file)]);
      if (!info.isFile()) return null;
      return { body, contentType: contentTypeOf(key), size: info.size, modifiedAt: info.mtime };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    const file = this.resolve(key);
    if (!file) return false;
    try {
      await unlink(file);
      return true;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    const file = this.resolve(key);
    if (!file) return false;
    try {
      return (await stat(file)).isFile();
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    return `${this.urlPrefix}${assertValidKey(key)}`;
  }

  async list(): Promise<StoredEntry[]> {
    const root = path.resolve(this.root());
    const out: StoredEntry[] = [];
    const walk = async (dir: string, prefix: string) => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const full = path.join(dir, name);
        const key = prefix ? `${prefix}/${name}` : name;
        try {
          const info = await stat(full);
          if (info.isDirectory()) await walk(full, key);
          else if (info.isFile() && isValidKey(key) && !name.endsWith('.tmp')) out.push({ key, size: info.size, modifiedAt: info.mtime });
        } catch {
          /* sumiu no meio da listagem */
        }
      }
    };
    await walk(root, '');
    return out;
  }
}

/** As fotos dos frascos. Referências "media/<chave>" — as mesmas que já estão no library.json. */
export const mediaStorage = new LocalStorageProvider(() => config.mediaDir, 'media/');
