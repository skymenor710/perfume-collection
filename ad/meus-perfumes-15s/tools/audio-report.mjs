// Relatório visual do áudio: nível RMS e pico a cada 50 ms, com os eventos da linha do tempo marcados.
// uso: node tools/audio-report.mjs <arquivo.wav float32 estéreo> <saida.png>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [file, out] = process.argv.slice(2);
const buf = readFileSync(file);
let o = 12, fmt = 0, sr = 48000, ch = 2, bits = 32, dataOff = 0, dataLen = 0;
while (o < buf.length) { const id = buf.toString('ascii', o, o + 4), len = buf.readUInt32LE(o + 4); if (id === 'fmt ') { fmt = buf.readUInt16LE(o + 8); ch = buf.readUInt16LE(o + 10); sr = buf.readUInt32LE(o + 12); bits = buf.readUInt16LE(o + 22); } if (id === 'data') { dataOff = o + 8; dataLen = len; break; } o += 8 + len; }
const n = dataLen / (ch * bits / 8);
const get = (i, c) => (fmt === 3 ? buf.readFloatLE(dataOff + (i * ch + c) * 4) : buf.readInt16LE(dataOff + (i * ch + c) * 2) / 32768);
const win = Math.round(sr * 0.05), rows = [];
for (let s = 0; s + win <= n; s += win) { let sum = 0, pk = 0; for (let i = s; i < s + win; i++) { const v = (get(i, 0) + get(i, ch - 1)) / 2; sum += v * v; pk = Math.max(pk, Math.abs(get(i, 0)), Math.abs(get(i, ch - 1))); } rows.push([s / sr, 10 * Math.log10(sum / win + 1e-12), 20 * Math.log10(pk + 1e-12)]); }
const tlSrc = readFileSync(path.resolve(import.meta.dirname, '../src/timeline.js'), 'utf8');
const TL = JSON.parse(tlSrc.slice(tlSrc.indexOf('{'), tlSrc.lastIndexOf('}') + 1));
const W = 1800, H = 520, x = (t) => 60 + (t / TL.duration) * (W - 80), y = (d) => 20 + ((0 - d) / 60) * (H - 60);
const ev = [['impacto', TL.impact], ['nome', TL.heroName], ...TL.tiers.map((t) => ['camada', t]), ['batida', TL.act3], ...TL.snaps.map((t) => ['', t]), ['pouso', TL.land], ['comprei', TL.comprei], ['aba', TL.tabPulse], ['carimbo', TL.stamp], ['final', TL.final], ['tampa', TL.capCycle[0]]];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#0b0b10"/>`;
for (let d = 0; d >= -60; d -= 6) svg += `<line x1="60" x2="${W - 20}" y1="${y(d)}" y2="${y(d)}" stroke="#222"/><text x="8" y="${y(d) + 4}" fill="#777" font-size="12" font-family="Segoe UI">${d} dB</text>`;
for (let s = 0; s <= TL.duration; s++) svg += `<line x1="${x(s)}" x2="${x(s)}" y1="20" y2="${H - 40}" stroke="#1c1c24"/><text x="${x(s) - 4}" y="${H - 22}" fill="#777" font-size="12" font-family="Segoe UI">${s}</text>`;
for (const [name, t] of ev) svg += `<line x1="${x(t)}" x2="${x(t)}" y1="20" y2="${H - 40}" stroke="#6d5a2a" stroke-dasharray="3 3"/>${name ? `<text x="${x(t) + 3}" y="34" fill="#c8a86a" font-size="11" font-family="Segoe UI" transform="rotate(0)">${name}</text>` : ''}`;
svg += `<polyline fill="none" stroke="#ff8c6b" stroke-width="1.2" points="${rows.map((r) => `${x(r[0]).toFixed(1)},${y(r[2]).toFixed(1)}`).join(' ')}"/>`;
svg += `<polyline fill="none" stroke="#8fb0ff" stroke-width="2" points="${rows.map((r) => `${x(r[0]).toFixed(1)},${y(r[1]).toFixed(1)}`).join(' ')}"/>`;
svg += `<text x="${W - 330}" y="${H - 6}" fill="#8fb0ff" font-size="13" font-family="Segoe UI">azul: RMS (50 ms)   laranja: pico</text></svg>`;
await sharp(Buffer.from(svg)).png().toFile(out);
const maxPk = Math.max(...rows.map((r) => r[2]));
console.log(out, `pico máx ${maxPk.toFixed(1)} dBFS`);
