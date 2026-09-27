import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import type { InferenceSession as Session } from 'onnxruntime-node';
import sharp from 'sharp';
import { config } from '../config';

/**
 * Recorte por IA: BiRefNet-lite (licença MIT; ZhengPeng7/BiRefNet via onnx-community), rodando local na CPU.
 * Feito para "objeto em destaque" — separa frasco de fundo mesmo quando o fundo não é liso, e respeita
 * tampas metálicas, vidro e sombras melhor que a inundação por cor. Devolve só a máscara (alfa 0–255);
 * quem decide entre este recorte e o por cor é a avaliação de qualidade.
 *
 * O modelo (224 MB) é baixado uma vez para data/models na primeira necessidade.
 */

const MODEL_URL = 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx';
const MODEL_SIZE = 224_005_088;
const SIDE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const modelPath = () => path.join(config.modelsDir, 'birefnet-lite.onnx');

function download(url: string, dest: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
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
        const tmp = `${dest}.part`;
        const out = createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => out.close(() => (renameSync(tmp, dest), resolve())));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

let session: Promise<Session | null> | null = null;

/** Sessão do modelo, ou nulo se não der para baixar/carregar (aí só o recorte por cor funciona). */
export function matting(): Promise<Session | null> {
  if (!session) {
    session = (async () => {
      const file = modelPath();
      try {
        if (!existsSync(file) || statSync(file).size !== MODEL_SIZE) {
          mkdirSync(path.dirname(file), { recursive: true });
          console.log('[imagem] Baixando o modelo de recorte (BiRefNet-lite, 224 MB) — só desta vez…');
          await download(MODEL_URL, file);
        }
        const ort = await import('onnxruntime-node');
        return await ort.InferenceSession.create(file, { graphOptimizationLevel: 'all' });
      } catch (error) {
        console.warn(`[imagem] Recorte por IA indisponível (${(error as Error).message}); seguindo com o recorte por cor.`);
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
