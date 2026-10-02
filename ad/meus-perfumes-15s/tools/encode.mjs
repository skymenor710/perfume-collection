/**
 * Codificação final: a sequência a 30 qps já com desfoque de movimento (frames30/, de tools/motionblur.mjs) →
 * H.264 1080×1920, cor BT.709, com o áudio masterizado (AAC 320 kb/s, 48 kHz) e sem áudio.
 *   node tools/encode.mjs
 * Saída: out/meus-perfumes-ad-15s.mp4 · out/meus-perfumes-ad-15s-sem-audio.mp4 · out/capa.png
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';

const AD = path.resolve(import.meta.dirname, '..');
const FF = path.join(AD, 'tools', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe');
const frames = path.join(AD, 'frames30', 'o_%04d.png');
const audio = path.join(AD, 'audio', 'out', 'mix-master.wav');
const out = (f) => path.join(AD, 'out', f);
const run = (args) => {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${args.join(' ')}`);
};

const video = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-level', '4.2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-x264-params', 'aq-mode=3:aq-strength=0.9:deblock=-1,-1', '-r', '30'];

run(['-framerate', '30', '-i', frames, '-i', audio, '-filter_complex', `[0:v]${video}[v]`, '-map', '[v]', '-map', '1:a', ...x264, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', '-t', '15', out('meus-perfumes-ad-15s.mp4')]);
run(['-framerate', '30', '-i', frames, '-filter_complex', `[0:v]${video}[v]`, '-map', '[v]', ...x264, '-movflags', '+faststart', '-t', '15', out('meus-perfumes-ad-15s-sem-audio.mp4')]);
// Capa: o frasco com a pirâmide (4,0 s) — o quadro mais "produto" do filme.
copyFileSync(path.join(AD, 'frames30', `o_${String(Math.round(4.0 * 30)).padStart(4, '0')}.png`), out('capa.png'));
console.log('pronto: out/meus-perfumes-ad-15s.mp4, out/meus-perfumes-ad-15s-sem-audio.mp4, out/capa.png');
