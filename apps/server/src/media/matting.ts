import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import type { InferenceSession as Session } from 'onnxruntime-node';
import sharp from 'sharp';
import { config } from '../config';
import { event } from '../log';
import { egress } from '../net/egress';
import { USER_AGENT } from '../net/safe-fetch';

/**
 * Recorte por IA: BiRefNet-lite (licença MIT; ZhengPeng7/BiRefNet via onnx-community), rodando local na CPU.
 * Feito para "objeto em destaque" — separa frasco de fundo mesmo quando o fundo não é liso, e respeita
 * tampas metálicas, vidro e sombras melhor que a inundação por cor. Devolve só a máscara (alfa 0–255);
 * quem decide entre este recorte e o por cor é a avaliação de qualidade.
 *
 * O modelo (224 MB) é baixado uma vez para data/models na primeira necessidade, e conferido pelo SHA-256.
 */

/**
 * Modelo fixado: URL num commit específico do repositório (não em "main", que pode mudar) e SHA-256 conferido
 * antes de carregar. O hash é o que o próprio Hugging Face publica para o arquivo (X-Linked-ETag), conferido com
 * o arquivo local em 27/09/2026. Se o arquivo não bater — corrompido, trocado ou outra versão — ele NÃO é carregado:
 * baixa de novo uma vez e, se ainda não bater, o app segue só com o recorte por cor.
 */
export const MODEL_COMMIT = 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1';
const MODEL_URL = `https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/${MODEL_COMMIT}/onnx/model.onnx`;
export const MODEL_SHA256 = '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333';
export const MODEL_SIZE = 224_005_088;
const SIDE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const modelPath = () => path.join(config.modelsDir, 'birefnet-lite.onnx');

/** SHA-256 de um arquivo, em fluxo (não carrega 224 MB na memória). */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** O arquivo é exatamente o modelo esperado? (tamanho primeiro, que é barato; depois o hash). */
export async function verifyModelFile(file: string, expected = { sha256: MODEL_SHA256, size: MODEL_SIZE }): Promise<boolean> {
  if (!existsSync(file) || statSync(file).size !== expected.size) return false;
  return (await sha256File(file)) === expected.sha256;
}

/** Download só por https (inclusive nos redirecionamentos para a CDN), dentro do teto global de saída. */
function download(url: string, dest: string, redirects = 5): Promise<void> {
  return egress.run(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!url.startsWith('https://')) return reject(new Error('download do modelo só por https'));
        https
          .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
              res.resume();
              download(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(resolve, reject);
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            const out = createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve()));
            out.on('error', reject);
          })
          .on('error', reject);
      }),
  );
}

/** Baixa para um .part, confere o hash e só então põe no lugar. Arquivo que não bate é apagado. */
async function downloadVerified(file: string): Promise<boolean> {
  const tmp = `${file}.part`;
  event('model.downloading', { model: 'birefnet-lite', commit: MODEL_COMMIT });
  await download(MODEL_URL, tmp);
  if (!(await verifyModelFile(tmp))) {
    rmSync(tmp, { force: true });
    return false;
  }
  renameSync(tmp, file);
  return true;
}

let session: Promise<Session | null> | null = null;

/** Sessão do modelo, ou nulo se não der para baixar/carregar/conferir (aí só o recorte por cor funciona). */
export function matting(): Promise<Session | null> {
  if (!session) {
    session = (async () => {
      const file = modelPath();
      try {
        if (!(await verifyModelFile(file))) {
          mkdirSync(path.dirname(file), { recursive: true });
          if (!(await downloadVerified(file))) {
            event('model.unavailable', { model: 'birefnet-lite', reason: 'checksum_mismatch' }, 'error');
            return null;
          }
        }
        const ort = await import('onnxruntime-node');
        return await ort.InferenceSession.create(file, { graphOptimizationLevel: 'all' });
      } catch (error) {
        event('model.unavailable', { model: 'birefnet-lite', reason: (error as Error).message }, 'warn');
        return null;
      }
    })();
  }
  return session;
}

/** Máscara do objeto em destaque, no tamanho da imagem (1 canal, 0–255). Nulo se o modelo não estiver disponível. */
export async function predictMask(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Uint8Array | null> {
  const s = await matting();
  if (!s) return null;
  const ort = await import('onnxruntime-node');
  const rgb = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
    // Fundo transparente vira branco antes de entrar na rede (ela foi treinada com fotos, não com alfa).
    .flatten({ background: '#ffffff' })
    .resize(SIDE, SIDE, { fit: 'fill', kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const plane = SIDE * SIDE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) });
  const logits = out[s.outputNames[0]].data as Float32Array;
  const mask = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) mask[i] = Math.round(255 / (1 + Math.exp(-logits[i])));
  // extractChannel garante 1 canal na saída (o sharp promove cinza para sRGB de 3 canais no caminho).
  const resized = await sharp(mask, { raw: { width: SIDE, height: SIDE, channels: 1 } }).resize(width, height, { fit: 'fill', kernel: 'cubic' }).extractChannel(0).raw().toBuffer();
  return new Uint8Array(resized.buffer, resized.byteOffset, resized.byteLength);
}
