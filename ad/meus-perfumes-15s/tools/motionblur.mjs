/**
 * Desfoque de movimento adaptativo. Obturador de 270°: cada quadro final (30 qps) é a média de N instantes dentro dos
 * seus primeiros 25 ms. O render a 120 qps já dá 3 amostras por quadro (0; 8,3; 16,7 ms), que bastam onde o movimento
 * é lento. Onde é rápido (o recuo da câmera, as trocas, a rebobinada, a partida), 3 amostras viram 3 cópias nítidas:
 * o quadro ganha então 6, 12, 24 ou 48 amostras, e as 3 existentes são reaproveitadas (N é múltiplo de 3).
 *
 *   node tools/motionblur.mjs plan    deslocamento entre o 1º e o 3º subquadro → frames-mb/plan.json e jobs.json
 *   node tools/render.mjs --jobs=frames-mb/jobs.json --workers=7
 *   node tools/motionblur.mjs blend   média de cada quadro → frames30/o_0000.png …
 *
 * Deslocamento estimado por blocos (luminância a 1/4 da resolução): em cada bloco com textura, Σ|I₂ − I₀| / Σ|∇I₀|.
 * Para uma borda de contraste c que anda d px, o numerador vale c·d e o denominador c: dá d mesmo quando d passa da
 * largura da borda. Vale o percentil 90 dos blocos, porque num zoom a borda do quadro anda muito mais que o centro.
 * Mudanças de brilho (flash, fade) também contam como movimento; o custo é só render a mais.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const sharp = createRequire(import.meta.url)('sharp');
const AD = path.resolve(import.meta.dirname, '..');
const window = {};
new Function('window', readFileSync(path.join(AD, 'src', 'timeline.js'), 'utf8'))(window);
const TL = window.AD_TL;

const FPS = 30, SUB = 4, SHUTTER = 0.75 / FPS, OUT = TL.duration * FPS;
const LEVELS = [3, 6, 12, 24, 48];
const MAX_STEP = 4; // px (resolução cheia) entre duas amostras vizinhas
const MB = path.join(AD, 'frames-mb');
const base = (i) => path.join(AD, 'frames', `f_${String(i).padStart(5, '0')}.png`);
const extra = (k, j) => path.join(MB, `k${String(k).padStart(4, '0')}_${String(j).padStart(2, '0')}.png`);

const SCALE = 4; // luminância a 1/4 da resolução
const TILE = 30;

async function luma(file) {
  const { data, info } = await sharp(file).resize(1080 / SCALE, 1920 / SCALE).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Deslocamento (px na resolução cheia) entre dois subquadros: percentil 90 dos blocos com textura. */
function displacement(a, b) {
  const { w, h } = a;
  const values = [];
  for (let ty = 0; ty + TILE <= h; ty += TILE) {
    for (let tx = 0; tx + TILE <= w; tx += TILE) {
      let num = 0, den = 0;
      for (let y = Math.max(1, ty); y < Math.min(h - 1, ty + TILE); y++) {
        for (let x = Math.max(1, tx); x < Math.min(w - 1, tx + TILE); x++) {
          const i = y * w + x;
          num += Math.abs(b.data[i] - a.data[i]);
          den += (Math.abs(a.data[i + 1] - a.data[i - 1]) + Math.abs(a.data[i + w] - a.data[i - w])) / 2;
        }
      }
      if (den / (TILE * TILE) > 1.5) values.push(num / den);
    }
  }
  if (!values.length) return 0;
  values.sort((x, y) => x - y);
  return values[Math.min(values.length - 1, Math.floor(0.9 * values.length))] * SCALE;
}

async function pool(n, count, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < count) await fn(next++);
  }));
}

async function plan() {
  // As partículas (dissolução → impacto) já desenham o próprio rastro, com obturador próprio: ficam com 3 amostras.
  const own = [TL.dissolve[0] - 0.02, TL.impact + 0.12];
  const rows = new Array(OUT);
  await pool(6, OUT, async (k) => {
    const d = displacement(await luma(base(k * SUB)), await luma(base(k * SUB + 2)));
    const speed = d / ((2 / (FPS * SUB)) * 1000); // px por ms, resolução cheia
    const t = k / FPS;
    const need = t >= own[0] && t <= own[1] ? 3 : (speed * SHUTTER * 1000) / MAX_STEP;
    rows[k] = { k, t: Number(t.toFixed(3)), d: Number(d.toFixed(1)), n: LEVELS.find((l) => l >= need) ?? LEVELS.at(-1) };
  });
  const jobs = [];
  for (const { k, n } of rows) {
    if (n === 3) continue;
    const step = n / 3;
    for (let j = 0; j < n; j++) {
      if (j % step === 0) continue;
      jobs.push({ t: k / FPS + (j * SHUTTER) / n, i: k * SUB + Math.floor(j / step), file: path.relative(AD, extra(k, j)).replaceAll('\\', '/') });
    }
  }
  rmSync(MB, { recursive: true, force: true });
  mkdirSync(MB, { recursive: true });
  writeFileSync(path.join(MB, 'plan.json'), JSON.stringify(rows));
  writeFileSync(path.join(MB, 'jobs.json'), JSON.stringify(jobs));
  const hist = Object.fromEntries(LEVELS.map((l) => [l, rows.filter((r) => r.n === l).length]));
  console.log(`quadros por nível de amostras: ${JSON.stringify(hist)} · subquadros extras: ${jobs.length}`);
  // Trechos contínuos com mais de 3 amostras, para conferência.
  let run = null;
  for (const r of [...rows, { k: OUT, n: 3 }]) {
    if (r.n > 3 && !run) run = { from: r.k, max: r.n, dmax: r.d };
    else if (r.n > 3) { run.max = Math.max(run.max, r.n); run.dmax = Math.max(run.dmax, r.d); }
    else if (run) {
      console.log(`  ${(run.from / FPS).toFixed(2)}–${(r.k / FPS).toFixed(2)} s · até ${run.max} amostras · deslocamento máx. ${run.dmax} px/16,7 ms`);
      run = null;
    }
  }
}

async function blend() {
  const rows = JSON.parse(readFileSync(path.join(MB, 'plan.json'), 'utf8'));
  const dir = path.join(AD, 'frames30');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let done = 0;
  await pool(4, rows.length, async (idx) => {
    const { k, n } = rows[idx];
    const step = n / 3;
    const files = Array.from({ length: n }, (_, j) => (j % step === 0 ? base(k * SUB + j / step) : extra(k, j)));
    let acc = null, info = null;
    for (const f of files) {
      const r = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      info ??= r.info;
      acc ??= new Uint32Array(r.data.length);
      for (let i = 0; i < r.data.length; i++) acc[i] += r.data[i];
    }
    const out = Buffer.alloc(acc.length);
    for (let i = 0; i < acc.length; i++) out[i] = Math.floor((acc[i] + n / 2) / n);
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
      .png({ compressionLevel: 1 })
      .toFile(path.join(dir, `o_${String(k).padStart(4, '0')}.png`));
    if (++done % 50 === 0) console.log(`${done}/${rows.length}`);
  });
  console.log(`pronto: ${rows.length} quadros em frames30/`);
}

const cmd = process.argv[2];
if (cmd === 'plan') await plan();
else if (cmd === 'blend') await blend();
else throw new Error('uso: node tools/motionblur.mjs plan|blend');
