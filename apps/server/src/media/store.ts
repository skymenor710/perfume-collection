import { randomBytes } from 'node:crypto';
import { contentAddress } from '../storage/keys';
import { mediaStorage } from '../storage/local';
import type { StorageProvider } from '../storage/types';
import { mediaSettings, type MediaSettings } from './content';
import { IMMUTABLE, inventory, migrateObjects } from './migrate';
import type { ProcessedBottle } from './process';

export interface SavedMedia {
  imageUrl: string;
  thumbUrl: string;
  /** O arquivo guardado: PNG 2048×2048 com fundo transparente. */
  masterUrl: string;
  dominantColor: string;
  neutral: boolean;
  cutout: boolean;
}

/**
 * Guarda o frasco processado. As referências devolvidas são as que ficam gravadas na biblioteca.
 *
 *   - MEDIA_BACKEND=local (padrão), ou `storage` passado: como sempre — nome aleatório (nada vindo da loja vira nome de
 *     arquivo) em data/media, referências "media/…".
 *   - MEDIA_BACKEND=r2: chave por conteúdo "p/<sha256>.<formato>". Grava PRIMEIRO a cópia local
 *     (data/media/<sha256>.<formato>, a volta nunca depende de baixar do R2), depois sobe e PROVA cada arquivo
 *     (media/migrate.ts). Se o R2 falhar, a importação falha com erro claro — nenhuma referência sem prova é devolvida.
 */
export async function saveBottleMedia(bottle: ProcessedBottle, storage?: StorageProvider, settings: MediaSettings = mediaSettings()): Promise<SavedMedia> {
  const colors = { dominantColor: bottle.color.hex, neutral: bottle.color.neutral, cutout: bottle.cutout };
  if (storage || settings.backend !== 'r2' || !settings.remote) return { ...(await saveLocal(bottle, storage ?? mediaStorage)), ...colors };
  return { ...(await saveContentAddressed(bottle, settings, settings.remote)), ...colors };
}

async function saveLocal(bottle: ProcessedBottle, storage: StorageProvider) {
  const id = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
  const keys = { master: `${id}.png`, large: `${id}-lg.webp`, small: `${id}-sm.webp` };
  await Promise.all([
    storage.put(keys.master, bottle.master, { contentType: 'image/png', cacheControl: IMMUTABLE }),
    storage.put(keys.large, bottle.large, { contentType: 'image/webp', cacheControl: IMMUTABLE }),
    storage.put(keys.small, bottle.small, { contentType: 'image/webp', cacheControl: IMMUTABLE }),
  ]);
  return { imageUrl: storage.publicUrl(keys.large), thumbUrl: storage.publicUrl(keys.small), masterUrl: storage.publicUrl(keys.master) };
}

async function saveContentAddressed(bottle: ProcessedBottle, settings: MediaSettings, remote: StorageProvider) {
  const files = { master: bottle.master, large: bottle.large, small: bottle.small };
  const local: Record<keyof typeof files, { ref: string; key: string }> = {} as never;
  for (const [role, body] of Object.entries(files) as [keyof typeof files, Buffer][]) {
    const address = contentAddress(body);
    const localKey = `${address.sha256}.${address.ext}`;
    if (!(await mediaStorage.exists(localKey))) await mediaStorage.put(localKey, body, { contentType: address.contentType, sha256: address.sha256 });
    local[role] = { ref: mediaStorage.publicUrl(localKey), key: address.key };
  }
  const refs = Object.values(local).map((l) => l.ref);
  const report = await migrateObjects(
    inventory(refs, (ref) => mediaStorage.resolve(ref.replace(/^media\//, ''))),
    { remote, map: settings.map },
  );
  if (!report.ok) throw new Error(`As fotos não foram confirmadas no R2: ${report.failed.map((f) => f.reason).join('; ')}`);
  return { imageUrl: local.large.key, thumbUrl: local.small.key, masterUrl: local.master.key };
}
