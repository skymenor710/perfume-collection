import { parentPort } from 'node:worker_threads';
import { processBottleImage, type ProcessOptions } from './process';

/**
 * Linha de execução própria para o trabalho pesado de imagem: decodificar, recortar (IA + cor), avaliar e
 * normalizar. Tudo isso roda em laços de pixel que, na linha principal, travavam o servidor por segundos —
 * e uma página aberta nesse meio-tempo concluía "não há servidor". Aqui o servidor continua respondendo.
 */

interface Job {
  id: number;
  input: Uint8Array;
  options: ProcessOptions;
}

parentPort?.on('message', async ({ id, input, options }: Job) => {
  try {
    const result = await processBottleImage(Buffer.from(input.buffer, input.byteOffset, input.byteLength), options);
    // Cópia simples (alguns MB): transferir o ArrayBuffer de um Buffer do Node pode levar junto o pool compartilhado.
    parentPort!.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort!.postMessage({ id, ok: false, message: (error as Error).message });
  }
});
