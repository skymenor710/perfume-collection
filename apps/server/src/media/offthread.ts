import { Worker } from 'node:worker_threads';
import { processBottleImage, type ProcessedBottle, type ProcessOptions } from './process';
import { event } from '../log';

/**
 * `processBottleImage` fora da linha principal. Um único trabalhador, persistente (o modelo de recorte é carregado
 * uma vez), com fila: o servidor HTTP nunca espera um laço de pixels. Se o trabalhador cair, o próximo pedido
 * cria outro; se nem isso der (ambiente sem worker_threads), processa na linha principal — mais lento, mas funciona.
 */

type Pending = { resolve: (b: ProcessedBottle) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

const asBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

function spawn(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  try {
    // .ts em desenvolvimento (tsx herda o carregador pelos execArgv); o mesmo arquivo roda em produção via tsx.
    const w = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: process.execArgv });
    w.unref();
    w.on('message', (msg: { id: number; ok: boolean; result?: ProcessedBottle; message?: string }) => {
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      // Ocioso não segura o processo aberto (scripts terminam); com trabalho na fila, segura.
      if (!pending.size) w.unref();
      if (msg.ok && msg.result) {
        const r = msg.result;
        job.resolve({ ...r, master: asBuffer(r.master), large: asBuffer(r.large), small: asBuffer(r.small) });
      } else {
        job.reject(new Error(msg.message ?? 'falha no processamento da imagem'));
      }
    });
    const fail = (error: Error) => {
      worker = null;
      for (const [id, job] of pending) {
        pending.delete(id);
        job.reject(error);
      }
    };
    w.on('error', fail);
    w.on('exit', (code) => code !== 0 && fail(new Error(`trabalhador de imagem saiu (${code})`)));
    worker = w;
    return w;
  } catch (error) {
    event('image.worker_unavailable', { reason: (error as Error).message }, 'warn');
    broken = true;
    return null;
  }
}

export function processBottleOffThread(input: Buffer, options: ProcessOptions = {}): Promise<ProcessedBottle> {
  const w = spawn();
  if (!w) return processBottleImage(input, options);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.ref();
    w.postMessage({ id, input, options });
  });
}
