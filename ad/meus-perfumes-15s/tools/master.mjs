/**
 * Masterização: leva a mixagem a -14 LUFS integrados (referência de Reels/TikTok/YouTube) com pico real ≤ -1 dBTP,
 * e confere no medidor EBU R128 do ffmpeg. Gera audio/out/mix-master.wav (PCM 24 bits, 48 kHz).
 *   node tools/master.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const AD = path.resolve(import.meta.dirname, '..');
const FF = path.join(AD, 'tools', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
const IN = path.join(AD, 'audio', 'out', 'mix-pre-master.wav');
const OUT = path.join(AD, 'audio', 'out', 'mix-master.wav');
const TARGET = -14;

/** Loudness integrada, faixa de loudness e pico real (o ebur128 escreve no stderr). */
function loud(file) {
  const r = spawnSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = String(r.stderr).slice(String(r.stderr).lastIndexOf('Summary:'));
  const num = (re) => Number(re.exec(s)?.[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

const before = loud(IN);
let gain = TARGET - before.I;
for (let pass = 1; pass <= 3; pass++) {
  // Ganho + limitador (teto de -1,6 dBFS de amostra: folga para o pico real entre amostras).
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', IN, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.83:attack=4:release=60:level=disabled,aresample=48000`, '-c:a', 'pcm_s24le', OUT], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg falhou');
  const after = loud(OUT);
  console.log(`passo ${pass}: ganho ${gain.toFixed(2)} dB → ${after.I} LUFS · pico real ${after.TP} dBTP · LRA ${after.LRA} LU`);
  if (Math.abs(after.I - TARGET) <= 0.3 && after.TP <= -1) break;
  gain += TARGET - after.I;
}
console.log(`antes: ${before.I} LUFS (pico real ${before.TP} dBTP) → ${path.relative(AD, OUT)}`);
