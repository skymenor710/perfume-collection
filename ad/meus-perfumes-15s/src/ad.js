/**
 * Compositor determinístico do anúncio "Meus Perfumes — 15 s" (9:16, 1080 × 1920).
 *
 * window.renderAt(t) desenha o quadro do instante t (segundos). Nada anda sozinho: o Edge headless chama renderAt
 * para cada quadro e fotografa (tools/render.mjs). Qualquer quadro pode ser desenhado em qualquer ordem — tudo é
 * função do tempo (o que depende de história, como a mola do carrossel e a cor, é pré-calculado no início).
 *
 * Material REAL do app: o GLSL da galáxia (galaxy-shaders.js, extraído de apps/web/src/gl/galaxy.ts), os mestres
 * dos frascos, a fonte Archivo, os tokens, os textos da interface, as curvas e durações de animação do app e os
 * dados da coleção (data.js).
 */
const TL = window.AD_TL;
const DATA = window.AD_DATA;
const SH = window.GALAXY_SHADERS;
const R = DATA.roster;
const W = 1080;
const H = 1920;
const S = 2.7; // 1 px de CSS do app = 2,7 px do quadro (o tamanho da UI num celular)

/* ================================================================== matemática */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const TAU = Math.PI * 2;

/** cubic-bezier do CSS (mesmas curvas do app). */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      if (sx(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}
const eOut = bezier(0.16, 1, 0.3, 1); // --ease-out do app
const eInOut = bezier(0.65, 0, 0.35, 1); // --ease-in-out do app
const eExpoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eQuadIn = (x) => x * x;
const lin = (x) => x;

/** Interpolação por quadros-chave: [[t, v, easing-até-o-próximo], ...]. */
function kf(t, frames) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, v0, e = lin] = frames[i];
    const [t1, v1] = frames[i + 1];
    if (t <= t1) return lerp(v0, v1, e(seg(t, t0, t1)));
  }
  return frames[frames.length - 1][1];
}

/** Mesmo gerador do app (galaxy.ts): determinístico. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================================== cor (OKLab, como @perfumes/core/color) */

const hexRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const toLin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLin = (c) => Math.round(clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
function toLab({ r, g, b }) {
  const R_ = toLin(r), G_ = toLin(g), B_ = toLin(b);
  const l = Math.cbrt(0.4122214708 * R_ + 0.5363325363 * G_ + 0.0514459929 * B_);
  const m = Math.cbrt(0.2119034982 * R_ + 0.6806995451 * G_ + 0.1073969566 * B_);
  const s = Math.cbrt(0.0883024619 * R_ + 0.2817188376 * G_ + 0.6299787005 * B_);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}
function fromLab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}
const mixLab = (x, y, t) => ({ L: lerp(x.L, y.L, t), a: lerp(x.a, y.a, t), b: lerp(x.b, y.b, t) });
const LAB = R.map((r) => toLab(hexRgb(r.accent)));
const SILVER = toLab(hexRgb('#c7cad0')); // sotaque padrão do app (--accent-rgb: 199 202 208)

/* ================================================================== histórias pré-calculadas */

/** Carrossel: a mola do app (rigidez 180, amortecimento 25) perseguindo alvos marcados na batida. */
const POS = (() => {
  const dt = 1 / 1200;
  const t0 = TL.act3;
  const n = Math.ceil((TL.duration - t0) / dt) + 2;
  const arr = new Float32Array(n);
  let x = 0, v = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    let target = 0;
    for (let k = 0; k < TL.snaps.length; k++) if (t >= TL.snaps[k]) target = TL.snapTargets[k];
    arr[i] = x;
    v += ((target - x) * 180 - v * 25) * dt;
    x += v * dt;
  }
  return { t0, dt, arr };
})();
function posAt(t) {
  if (t <= POS.t0) return 0;
  const f = (t - POS.t0) / POS.dt;
  const i = Math.min(POS.arr.length - 2, Math.floor(f));
  return lerp(POS.arr[i], POS.arr[i + 1], f - i);
}

/** Troca da placa (nome) quando o frasco mais próximo muda — como o app (Math.round da posição). */
const PLATE = (() => {
  const out = [{ t: TL.act3, i: 0 }];
  for (let t = TL.act3; t < TL.comprei; t += 1 / 600) {
    const i = clamp(Math.round(posAt(t)), 0, R.length - 1);
    if (i !== out[out.length - 1].i) out.push({ t, i });
  }
  return out;
})();
function plateAt(t) {
  let k = 0;
  for (let j = 0; j < PLATE.length; j++) if (PLATE[j].t <= t) k = j;
  const next = PLATE[k + 1]?.t ?? Infinity;
  return { i: PLATE[k].i, since: t - PLATE[k].t, dur: clamp(next - PLATE[k].t, 0.16, 0.55) };
}

/**
 * Sotaque: perseguição exponencial em OKLab (τ 0,45 s, a do app), com alvos por ato. Na montagem o τ cai para 0,1 s:
 * com trocas a cada 0,5 → 0,125 s, o τ do app deixaria a cor sempre a meio caminho entre dois frascos (um cinza).
 */
function accentTarget(t) {
  if (t < TL.impact) return [SILVER, 0.45];
  if (t < TL.act3 - 0.2) return [LAB[0], t < TL.impact + 0.7 ? 0.12 : 0.45];
  if (t < TL.comprei - 0.3) {
    const p = clamp(posAt(t), 0, R.length - 1);
    const i0 = Math.floor(p), i1 = Math.min(R.length - 1, i0 + 1);
    return [mixLab(LAB[i0], LAB[i1], p - i0), t < TL.snaps[0] - 0.1 ? 0.45 : 0.1];
  }
  if (t < TL.capCycle[0]) return [LAB[0], 0.45];
  if (t < TL.capCycle[1]) {
    const step = (TL.capCycle[1] - TL.capCycle[0]) / TL.capColors.length;
    return [LAB[TL.capColors[Math.min(TL.capColors.length - 1, Math.floor((t - TL.capCycle[0]) / step))]], 0.07];
  }
  return [LAB[0], 0.3];
}
const ACC = (() => {
  const dt = 1 / 1200;
  const n = Math.ceil(TL.duration / dt) + 2;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  let cur = SILVER;
  for (let i = 0; i < n; i++) {
    L[i] = cur.L;
    A[i] = cur.a;
    B[i] = cur.b;
    const [target, tau] = accentTarget(i * dt);
    cur = mixLab(cur, target, 1 - Math.exp(-dt / tau));
  }
  return { dt, L, A, B };
})();
function accentAt(t) {
  const f = clamp(t, 0, TL.duration) / ACC.dt;
  const i = Math.min(ACC.L.length - 2, Math.floor(f)), u = f - i;
  const lab = { L: lerp(ACC.L[i], ACC.L[i + 1], u), a: lerp(ACC.A[i], ACC.A[i + 1], u), b: lerp(ACC.B[i], ACC.B[i + 1], u) };
  return { lab, rgb: fromLab(lab), sat: clamp(Math.hypot(lab.a, lab.b) / 0.14) };
}

/* ================================================================== galáxia (GLSL real do app) */

/** Mesma geração de estrelas do app (galaxy.ts, semente 20260926). */
function buildStars(count, dust) {
  const rand = mulberry32(20260926);
  const total = count + dust;
  const data = new Float32Array(total * 6);
  for (let i = 0; i < total; i++) {
    const isDust = i >= count;
    let x = rand();
    let y = rand();
    if (!isDust && rand() < 0.35) {
      const along = rand();
      const across = (rand() + rand() + rand() - 1.5) * 0.12;
      x = along;
      y = 0.62 - along * 0.34 + across;
    }
    const depth = isDust ? 1 : Math.pow(rand(), 1.8);
    const big = rand() < 0.04;
    const size = isDust ? 8 + rand() * 16 : big ? 2.4 + rand() * 1.4 : 1.1 + rand() * 0.9;
    const kind = isDust ? 2 : rand() < 0.11 ? 1 : 0;
    data.set([((x % 1) + 1) % 1, ((y % 1) + 1) % 1, depth, size, rand(), kind], i * 6);
  }
  return data;
}

function makeGalaxy(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL2 indisponível');
  // Única licença sobre o shader do app: um ganho (uBoost) na nebulosa e no halo, para o anúncio "acender".
  let bgFs = SH.BACKGROUND_FS;
  const patch = (a, b) => {
    if (!bgFs.includes(a)) throw new Error(`o shader do app mudou: ${a}`);
    bgFs = bgFs.replace(a, b);
  };
  patch('uniform int uOctaves;', 'uniform int uOctaves;\nuniform float uBoost;');
  patch('col += tint * neb * 0.6;', 'col += tint * neb * 0.6 * uBoost;');
  patch('col += uAccent * 0.075 * smoothstep', 'col += uAccent * 0.075 * uBoost * smoothstep');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const bg = program(SH.FULLSCREEN_VS, bgFs);
  const stars = program(SH.STARS_VS, SH.STARS_FS);
  const vao = gl.createVertexArray();
  const data = buildStars(1700, 44);
  const count = 1744;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [name, size, offset] of [['aPos', 3, 0], ['aSize', 1, 3], ['aSeed', 1, 4], ['aKind', 1, 5]]) {
    const loc = gl.getAttribLocation(stars, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, offset * 4);
  }
  gl.bindVertexArray(null);
  const U = (p, n) => gl.getUniformLocation(p, n);
  return (u) => {
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(bg);
    gl.uniform2f(U(bg, 'uRes'), W, H);
    gl.uniform1f(U(bg, 'uTime'), u.time);
    gl.uniform3f(U(bg, 'uAccent'), u.rgb.r / 255, u.rgb.g / 255, u.rgb.b / 255);
    gl.uniform1f(U(bg, 'uSat'), u.sat);
    gl.uniform2f(U(bg, 'uFocus'), u.focus[0], 1 - u.focus[1]);
    gl.uniform2f(U(bg, 'uPointer'), u.pointer[0], u.pointer[1]);
    gl.uniform1i(U(bg, 'uOctaves'), 5);
    gl.uniform1f(U(bg, 'uBoost'), u.boost);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(stars);
    gl.uniform1f(U(stars, 'uTime'), u.time);
    gl.uniform2f(U(stars, 'uPointer'), u.pointer[0], u.pointer[1]);
    gl.uniform1f(U(stars, 'uDpr'), 2.2);
    gl.uniform1f(U(stars, 'uScroll'), u.scroll);
    gl.uniform1f(U(stars, 'uAspect'), W / H);
    gl.uniform3f(U(stars, 'uAccent'), u.rgb.r / 255, u.rgb.g / 255, u.rgb.b / 255);
    gl.uniform1f(U(stars, 'uSat'), u.sat);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
  };
}

/* ================================================================== DOM */

const $ = (id) => {
  const e = document.getElementById(id);
  e._c ??= {};
  return e;
};
function el(tag, cls, parent, css) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (css) Object.assign(e.style, css);
  parent.appendChild(e);
  e._c = {};
  return e;
}
function set(e, prop, v) {
  if (e._c[prop] !== v) {
    e._c[prop] = v;
    e.style[prop] = v;
  }
}
function place(e, x, y, w, h) {
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  if (w != null) e.style.width = `${w}px`;
  if (h != null) e.style.height = `${h}px`;
}
function vis(e, o) {
  const on = o > 0.002;
  set(e, 'display', on ? '' : 'none');
  if (on) set(e, 'opacity', Math.min(1, o).toFixed(3));
}
const px = (v) => `${v.toFixed(2)}px`;
const SVGNS = 'http://www.w3.org/2000/svg';
const icon = (paths, size, stroke, width) =>
  `<svg xmlns="${SVGNS}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const LUCIDE = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
};

const frame = $('frame');
const world = $('world');
const hud = $('hud');
const endcard = $('endcard');
const fx = $('fx').getContext('2d');
const overlayCanvas = $('overlay');
const ov = overlayCanvas.getContext('2d');
overlayCanvas.style.mixBlendMode = 'screen';
const grainCanvas = el('canvas', '', frame, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, mixBlendMode: 'overlay', pointerEvents: 'none' });
grainCanvas.width = W / 2;
grainCanvas.height = H / 2;
const grain = grainCanvas.getContext('2d');

/* ---------------- geometria (px do quadro) ---------------- */

const SHEET = { x: 48, y: 600, w: 984, h: 656 };
const FIELD = { x: 118, y: 862, w: 844, h: 146, cy: 935, textX: 214, textR: 926 };
const BUTTON = { x: 118, y: 1062, w: 844, h: 124 };
const SIL = { ox: 270, oy: 316, k: 4.5 }; // silhueta do app (viewBox 120×200) em 540×900, base na linha y 1180
const C_SIL = { x: 540, y: 766 };
const F3 = 700 / 0.84; // lado do quadro quadrado no palco (frasco de 700 px)
const CY3 = 1070 - 0.42 * F3; // base do frasco no palco em y 1070
const HERO = { cy: 730, scale: 900 / 700 }; // frasco de 900 px, base em y 1180
const TIER_Y = [355, 760, 1115];
const TIER_W = [560, 800, 1000];
const HUDY = { tabs: 252, counter: 372, name: 1150, meta: 1262, price: 1318, action: 1392 };

/* ---------------- mundo (sob a câmera) ---------------- */

const beam = el('div', 'abs beam', world);
const pool = el('div', 'abs pool', world);
const horizon = el('div', 'abs horizon', world);
const rings = [0, 1, 2].map(() => el('div', 'abs ring', world));
const rules = TIER_W.map((w, i) => {
  const r = el('div', 'abs rule', world);
  place(r, 540 - w / 2, TIER_Y[i] - 1.5, w, 3);
  return r;
});
const slotWrap = el('div', 'abs', world);
const slots = R.map((r) => {
  const s = el('div', 'abs slot', slotWrap);
  const refl = el('div', 'refl', s);
  el('img', '', refl).src = r.img;
  const img = el('img', 'bottle', s);
  img.src = r.img;
  const sheen = el('div', 'sheen', s);
  sheen.style.webkitMaskImage = `url(${r.img})`;
  return { s, img, refl, sheen };
});

const hero = R[0];
const TIER_TXT = [
  { name: 'Saída', cap: 'a primeira impressão', notes: hero.notes.top.filter((n) => n !== 'Passion fruit').slice(0, 2) },
  { name: 'Coração', cap: 'o corpo do perfume', notes: hero.notes.heart.slice(0, 2) },
  { name: 'Fundo', cap: 'o que fica na pele', notes: hero.notes.base.filter((n) => n !== 'Esteva').slice(0, 3) },
];
const tiers = TIER_TXT.map((tx, i) => {
  const name = el('div', 'abs tier-name', world);
  name.textContent = tx.name;
  place(name, 84, TIER_Y[i] - 100);
  const cap = el('div', 'abs tier-cap', world);
  cap.textContent = tx.cap;
  place(cap, 84, TIER_Y[i] - 58);
  const notes = el('div', 'abs tier-notes', world);
  notes.innerHTML = tx.notes.join('<br>');
  place(notes, 540, TIER_Y[i] - 18 - tx.notes.length * 48, 410);
  return { name, cap, notes };
});

const heroName = el('div', 'abs display', world, { width: `${W}px`, textAlign: 'center', left: '0' });
const heroLetters = [...hero.name.toUpperCase()].map((ch) => {
  const s = el('span', '', heroName, { display: 'inline-block', whiteSpace: 'pre' });
  s.textContent = ch;
  return s;
});
const heroMeta = el('div', 'abs meta', world, { width: `${W}px`, justifyContent: 'center', left: '0' });
const metaHtml = (items) => items.map((m, i) => `${i ? '<span class="dot"></span>' : ''}<span>${m}</span>`).join('');
heroMeta.innerHTML = metaHtml(hero.meta.filter((m) => !/Masculino|Unissex|Feminino/.test(m)));

// Folha "Adicionar perfume" (ato 1)
const sheetGroup = el('div', 'abs', world, { width: `${W}px`, height: `${H}px` });
const sheetBox = el('div', 'abs sheet', sheetGroup);
place(sheetBox, SHEET.x, SHEET.y, SHEET.w, SHEET.h);
const sheetTitle = el('div', 'abs label', sheetGroup);
sheetTitle.textContent = 'Adicionar perfume';
place(sheetTitle, 118, 684);
const sheetClose = el('div', 'abs round', sheetGroup);
place(sheetClose, 843, 640, 119, 119);
sheetClose.innerHTML = icon(LUCIDE.x, 50, '#c9ccd2', 1.6);
const fieldLabel = el('div', 'abs label', sheetGroup, { color: 'var(--text-3)' });
fieldLabel.textContent = 'Cole o link do perfume';
place(fieldLabel, 118, 806);
const fieldBox = el('div', 'abs field', sheetGroup);
place(fieldBox, FIELD.x, FIELD.y, FIELD.w, FIELD.h);
const linkIcon = el('div', 'abs', sheetGroup);
place(linkIcon, 141, 910, 50, 50);
linkIcon.innerHTML = icon(LUCIDE.link, 50, '#80858f', 1.8);
const button = el('div', 'abs primary', sheetGroup);
place(button, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h);
button.textContent = 'Adicionar perfume';
const tapRipple = el('div', 'abs ripple', world);

// Etapas da análise (textos reais do app)
const STEPS = ['Identificando perfume', 'Analisando o link', 'Pesquisando o produto', 'Encontrando a melhor imagem', 'Preparando o frasco', 'Analisando o perfil olfativo', 'Finalizando'];
const stepsText = el('div', 'abs steps-text', world, { width: `${W}px`, left: '0' });
place(stepsText, 0, 1252);
const marks = el('div', 'abs marks', world);
place(marks, 540 - (7 * 49 + 6 * 22) / 2, 1318);
const markEls = STEPS.map(() => el('i', '', marks));

/* ---------------- HUD (tela) ---------------- */

const tabW = el('div', 'abs tab', hud);
tabW.innerHTML = 'Wishlist <span class="n">15</span>';
const tabC = el('div', 'abs tab', hud);
tabC.innerHTML = 'Coleção <span class="n">0</span>';
const tabWn = tabW.querySelector('.n');
const tabCn = tabC.querySelector('.n');
tabWn._c = {};
tabCn._c = {};
const underline = el('div', 'abs underline', hud);
const plus = el('div', 'abs round', hud);
place(plus, 888, 198, 108, 108);
plus.innerHTML = icon(LUCIDE.plus, 46, '#c9ccd2', 1.5);
const counter = el('div', 'abs counter', hud, { width: '912px', textAlign: 'right' });
place(counter, 84, HUDY.counter - 18);
const plateName = el('div', 'abs display', hud);
place(plateName, 84, HUDY.name);
const plateMeta = el('div', 'abs meta', hud);
place(plateMeta, 84, HUDY.meta);
const platePrice = el('div', 'abs price', hud);
place(platePrice, 84, HUDY.price);
const action = el('div', 'abs action', hud);
place(action, 84, HUDY.action, 912, 119);
action.innerHTML = '<span class="diamond"></span><span>Comprei</span>';
const diamond = action.querySelector('.diamond');
diamond._c = {};
const actionRipple = el('div', 'abs ripple', hud);
const tabRipple = el('div', 'abs ripple', hud);
const filters = el('div', 'abs filters', hud, { width: '996px' });
place(filters, 84, HUDY.counter - 22);
filters.innerHTML = '<span class="on">Todos <small>1</small></span><span data-v>Comprar novamente <small>0</small></span><span>Muito bom <small>0</small></span><span>Bom <small>0</small></span><span>Não comprar novamente <small>0</small></span>';
const filterRebuy = filters.querySelector('[data-v] small');
filterRebuy._c = {};
const verdictLabel = el('div', 'abs label', hud, { color: 'var(--text-3)' });
verdictLabel.textContent = 'Seu veredito';
place(verdictLabel, 84, 1330);
const stamp = el('div', 'abs stamp', hud);
place(stamp, 84, 1386);
stamp.innerHTML = '<span class="corner tl"></span><span class="mark"></span><span class="word">Comprar novamente</span><span class="corner br"></span>';

/* ---------------- cartela final ---------------- */

const GLYPH = { capX: 475, capY: 570, capW: 130, capH: 104, bodyX: 423, bodyY: 700, bodyW: 234, bodyH: 338 };
const endPool = el('div', 'abs pool', endcard);
place(endPool, 540 - 300, 1038 - 46, 600, 92);
const endHorizon = el('div', 'abs horizon', endcard);
place(endHorizon, 540 - 700, 1037, 1400, 2);
const endRefl = el('div', 'abs', endcard, { borderLeft: '5px solid #c9ccd2', borderRight: '5px solid #c9ccd2', WebkitMaskImage: 'linear-gradient(to bottom, rgb(0 0 0 / 0.32), transparent 88%)', maskImage: 'linear-gradient(to bottom, rgb(0 0 0 / 0.32), transparent 88%)', filter: 'blur(1.5px)' });
place(endRefl, 423, 1038, 234, 110);
const flood = el('div', 'abs flood', endcard);
const glyph = document.createElementNS(SVGNS, 'svg');
glyph.setAttribute('width', W);
glyph.setAttribute('height', H);
glyph.style.position = 'absolute';
glyph.style.left = '0';
glyph.style.top = '0';
glyph.innerHTML = `<rect x="${GLYPH.bodyX}" y="${GLYPH.bodyY}" width="${GLYPH.bodyW}" height="${GLYPH.bodyH}" rx="7" fill="none" stroke="#c9ccd2" stroke-width="5" pathLength="1" stroke-dasharray="1 1"/>`;
endcard.appendChild(glyph);
const glyphBody = glyph.querySelector('rect');
const wordmark = el('div', 'abs wordmark', endcard, { width: `${W}px`, left: '0', textAlign: 'center' });
place(wordmark, 0, 1118);
const wordLetters = [...'Meus perfumes'.toUpperCase()].map((ch) => {
  const s = el('span', '', wordmark, { display: 'inline-block', whiteSpace: 'pre' });
  s.textContent = ch;
  return s;
});
const tagline = el('div', 'abs tagline', endcard, { width: `${W}px`, left: '0', textAlign: 'center' });
place(tagline, 0, 1218);
tagline.textContent = 'Toda coleção merece um universo.';

/* ================================================================== medidas (depois da fonte) */

const measure = el('span', '', frame, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden' });
function textWidth(cls, text, style = {}) {
  measure.className = cls;
  Object.assign(measure.style, style);
  measure.textContent = text;
  const w = measure.getBoundingClientRect().width;
  measure.removeAttribute('style');
  Object.assign(measure.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden' });
  return w;
}
let PLATE_FONT = [];
let TAB_X = [];
let TAB_W = [0, 0];

/* ================================================================== partículas do ato 1 */

const URL_TEXT = hero.sourceUrl;
const URL_FONT = '400 43px "Archivo Variable"';
let PREFIX = [];
let S_STAR = 0;
let S_END = 0;
const INNER = FIELD.textR - FIELD.textX;
let P = null; // partículas (arrays)
let SIL_SEGS = [];
let SIL_LEN = 0;

function prefixW(n) {
  return PREFIX[clamp(n, 0, URL_TEXT.length)];
}
/** Frente da varredura de luz da colagem (x no mundo): do começo do "azzure-aoud" até o fim do campo. */
function sweepX(t) {
  return lerp(SLUG_X - 40, FIELD.textR + 160, eOut(seg(t, TL.paste[0], TL.paste[1])));
}
let SLUG_X = 0;

function buildSilhouette() {
  const k = SIL.k, ox = SIL.ox, oy = SIL.oy;
  const segs = [];
  const rect = (x, y, w, h, a = 1) => segs.push([x, y, x + w, y, a], [x + w, y, x + w, y + h, a], [x + w, y + h, x, y + h, a], [x, y + h, x, y, a]);
  rect(44, 8, 32, 30);
  segs.push([50, 38, 50, 48, 1], [70, 38, 70, 48, 1]);
  rect(16, 48, 88, 144);
  segs.push([30, 70, 90, 70, 0.5]);
  SIL_SEGS = segs.map(([x1, y1, x2, y2, a]) => {
    const s = [ox + x1 * k, oy + y1 * k, ox + x2 * k, oy + y2 * k, a];
    s.push(Math.hypot(s[2] - s[0], s[3] - s[1]));
    return s;
  });
  SIL_LEN = SIL_SEGS.reduce((n, s) => n + s[5], 0);
}
function silPoint(d) {
  for (const s of SIL_SEGS) {
    if (d <= s[5]) return [lerp(s[0], s[2], d / s[5]), lerp(s[1], s[3], d / s[5])];
    d -= s[5];
  }
  const l = SIL_SEGS[SIL_SEGS.length - 1];
  return [l[2], l[3]];
}

function sample(draw, step, test) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  draw(ctx);
  const px_ = ctx.getImageData(0, 0, W, H).data;
  const out = [];
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step) {
      const o = (y * W + x) * 4;
      if (test(px_[o], px_[o + 1], px_[o + 2], px_[o + 3])) out.push([x, y]);
    }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawUrl(ctx, t, final) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD.textX - 4, FIELD.y + 4, INNER + 8, FIELD.h - 8);
  ctx.clip();
  ctx.font = URL_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eceef2';
  if (!final) {
    ctx.shadowColor = 'rgba(220,228,255,0.55)';
    ctx.shadowBlur = 26 * (1 - seg(t, 0.3, 0.6));
  }
  const n = URL_TEXT.length;
  const scroll = S_STAR;
  const pop = final ? 1 : lerp(1.07, 1, eOut(seg(t, 0, 0.16)));
  for (let c = 0; c < n; c++) {
    const x = FIELD.textX - scroll + prefixW(c);
    if (x > FIELD.textR + 40 || x < FIELD.textX - 60) continue;
    const sc = pop;
    ctx.globalAlpha = 1;
    const w = prefixW(c + 1) - prefixW(c);
    ctx.save();
    ctx.translate(x + w / 2, FIELD.cy);
    ctx.scale(sc, sc);
    ctx.fillText(URL_TEXT[c], -w / 2, 0);
    ctx.restore();
  }
  // Varredura de luz da colagem: as letras acendem quando ela passa.
  if (!final && t < TL.paste[1] + 0.1) {
    const sx = sweepX(t);
    const a = 1 - seg(t, TL.paste[1] - 0.04, TL.paste[1] + 0.1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = 0;
    for (const [half, al] of [[110, 0.22], [34, 0.55]]) {
      const g = ctx.createLinearGradient(sx - half, 0, sx + half, 0);
      g.addColorStop(0, 'rgba(210,222,255,0)');
      g.addColorStop(0.5, `rgba(235,240,255,${(al * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(210,222,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - half, FIELD.cy - 44, half * 2, 88);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function buildParticles() {
  const rand = mulberry32(151);
  // Fontes: o link (pixels do texto), o botão claro (a pílula inteira), as bordas da folha e do campo.
  const urlPts = sample((ctx) => drawUrl(ctx, 0, true), 2, (r, g, b, a) => a > 150);
  const btnPts = sample(
    (ctx) => {
      ctx.fillStyle = '#eceef2';
      roundRect(ctx, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, BUTTON.h / 2);
      ctx.fill();
    },
    9,
    (r, g, b, a) => a > 200,
  );
  const edgePts = [];
  const perimeter = (x, y, w, h, step) => {
    for (let u = 0; u < w; u += step) edgePts.push([x + u, y], [x + u, y + h]);
    for (let v = 0; v < h; v += step) edgePts.push([x, y + v], [x + w, y + v]);
  };
  perimeter(SHEET.x, SHEET.y, SHEET.w, SHEET.h, 9);
  perimeter(FIELD.x, FIELD.y, FIELD.w, FIELD.h, 9);
  const src = [
    ...urlPts.map((p) => ({ x: p[0], y: p[1], kind: 0 })),
    ...btnPts.map((p) => ({ x: p[0], y: p[1], kind: 1 })),
    ...edgePts.map((p) => ({ x: p[0], y: p[1], kind: 2 })),
  ];
  const N = src.length;
  // Alvos: o contorno da silhueta do app, distribuídos pelo comprimento.
  const tgt = [];
  for (let i = 0; i < N; i++) {
    const [x, y] = silPoint(((i + rand()) / N) * SIL_LEN);
    tgt.push({ x: x + (rand() - 0.5) * 3, y: y + (rand() - 0.5) * 3 });
  }
  // Redemoinho coerente: origem e destino ordenados pelo ângulo em volta do centro, com giro de ~130°.
  const ang = (p) => Math.atan2(p.y - C_SIL.y, p.x - C_SIL.x);
  const srcOrder = src.map((p, i) => [ang(p), i]).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
  const tgtOrder = tgt.map((p, i) => [ang(p), i]).sort((a, b) => a[0] - b[0]).map((a) => a[1]);
  const shift = Math.floor(N * 0.36);
  P = { N, sx: new Float32Array(N), sy: new Float32Array(N), gx: new Float32Array(N), gy: new Float32Array(N), rs: new Float32Array(N), ths: new Float32Array(N), rg: new Float32Array(N), dth: new Float32Array(N), bulge: new Float32Array(N), d: new Float32Array(N), dur: new Float32Array(N), kind: new Uint8Array(N), size: new Float32Array(N), boom: new Float32Array(N), jit: new Float32Array(N), seed: new Float32Array(N) };
  for (let r = 0; r < N; r++) {
    const i = srcOrder[r];
    const g = tgt[tgtOrder[(r + shift) % N]];
    const s = src[i];
    P.sx[i] = s.x;
    P.sy[i] = s.y;
    P.gx[i] = g.x;
    P.gy[i] = g.y;
    P.kind[i] = s.kind;
    P.rs[i] = Math.hypot(s.x - C_SIL.x, s.y - C_SIL.y);
    P.ths[i] = Math.atan2(s.y - C_SIL.y, s.x - C_SIL.x);
    P.rg[i] = Math.hypot(g.x - C_SIL.x, g.y - C_SIL.y);
    let dth = (((Math.atan2(g.y - C_SIL.y, g.x - C_SIL.x) - P.ths[i]) % TAU) + TAU) % TAU;
    if (dth < Math.PI * 0.55) dth += TAU;
    P.dth[i] = dth;
    P.bulge[i] = -40 + rand() * 150;
    const q = rand();
    if (s.kind === 0) {
      P.d[i] = 0.66 + 0.2 * (1 - (s.x - FIELD.textX) / INNER) + q * 0.04;
      P.size[i] = 2.6;
    } else if (s.kind === 1) {
      P.d[i] = 0.7 + 0.1 * (Math.abs(s.x - 540) / 422) + q * 0.12;
      P.size[i] = 2.3;
    } else {
      P.d[i] = 0.72 + q * 0.2;
      P.size[i] = 1.9;
    }
    P.dur[i] = Math.min(0.42 + rand() * 0.24, 1.34 - P.d[i]);
    P.boom[i] = 70 + Math.pow(rand(), 1.6) * 520;
    P.jit[i] = (rand() - 0.5) * 0.9;
    P.seed[i] = rand() * TAU;
  }
}

function particlePos(i, t) {
  const u = clamp((t - P.d[i]) / P.dur[i]);
  if (u <= 0) return [P.sx[i], P.sy[i], 0];
  if (u < 1) {
    const e = eCubic(u);
    const th = P.ths[i] + P.dth[i] * e;
    const r = lerp(P.rs[i], P.rg[i], e) + P.bulge[i] * Math.sin(Math.PI * u);
    return [C_SIL.x + r * Math.cos(th), C_SIL.y + r * Math.sin(th), u];
  }
  let x = P.gx[i], y = P.gy[i];
  if (t > TL.impact) {
    const e2 = eOut(seg(t, TL.impact, TL.impact + 0.9));
    const a = Math.atan2(y - C_SIL.y, x - C_SIL.x) + P.jit[i];
    x += Math.cos(a) * P.boom[i] * e2;
    y += Math.sin(a) * P.boom[i] * e2 - 60 * e2 * e2;
  }
  return [x, y, 1];
}

/** Desenho em lotes (alfa quantizado): milhares de rastros em poucas chamadas. */
function drawParticles(ctx, t, acc) {
  if (t < 0.63 || t > TL.impact + 0.95) return;
  const buckets = new Map();
  const add = (key, x0, y0, x1, y1) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(x0, y0, x1, y1);
  };
  const shutter = t > TL.impact ? 0.7 / 60 : 1.7 / 60;
  const tint = seg(t, TL.impact, TL.impact + 0.2);
  for (let i = 0; i < P.N; i++) {
    const k = P.kind[i];
    let alpha;
    if (t < P.d[i]) {
      // Em repouso: o texto do link continua ali (já como partícula); botão e bordas acendem enquanto o DOM some.
      alpha = k === 0 ? 1 : k === 1 ? 0.75 * seg(t, 0.68, 0.74) : 0.5 * seg(t, 0.68, 0.76);
    } else if (t < TL.impact) {
      const u = clamp((t - P.d[i]) / P.dur[i]);
      alpha = u < 1 ? (k === 2 ? 0.5 : 0.72) : 0.7 + 0.2 * Math.sin(t * 22 + P.seed[i]);
    } else {
      alpha = Math.pow(1 - seg(t, TL.impact, TL.impact + 0.85), 1.6);
    }
    if (alpha < 0.02) continue;
    const rest = t < P.d[i] ? 1 : 0;
    const [x2, y2] = particlePos(i, t);
    if (rest) {
      add(`${k === 2 ? 1 : 0}|${Math.round(alpha * 10)}|1`, x2, y2, x2, y2);
      continue;
    }
    // Três pedaços do caminho: a cauda apaga, a cabeça brilha.
    const [x1, y1] = particlePos(i, t - shutter * 0.4);
    const [x0, y0] = particlePos(i, t - shutter);
    add(`${k === 2 ? 1 : 0}|${Math.round(alpha * 10)}|0`, x1, y1, x2, y2);
    add(`${k === 2 ? 1 : 0}|${Math.round(alpha * 3.5)}|0`, x0, y0, x1, y1);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const white = [236, 238, 242];
  for (const [key, arr] of buckets) {
    const [dim, level, rest] = key.split('|').map(Number);
    const a = level / 10;
    const c = white.map((v, j) => Math.round(lerp(v, [acc.r, acc.g, acc.b][j], tint * 0.85)));
    const path = new Path2D();
    for (let j = 0; j < arr.length; j += 4) {
      path.moveTo(arr[j], arr[j + 1]);
      path.lineTo(arr[j + 2] + 0.01, arr[j + 3]);
    }
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(a * (rest ? 0.03 : 0.09)).toFixed(3)})`;
    ctx.lineWidth = dim ? 4.5 : 6;
    ctx.stroke(path);
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(a * (dim ? 0.42 : rest ? 0.95 : 0.72)).toFixed(3)})`;
    ctx.lineWidth = dim ? 1.3 : rest ? 2.4 : 1.7;
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawSilhouette(ctx, t) {
  if (t < TL.silhouette[0] || t > TL.impact + 0.12) return;
  const p = eInOut(seg(t, TL.silhouette[0], TL.silhouette[1]));
  const fade = 1 - seg(t, TL.impact, TL.impact + 0.12);
  let left = p * SIL_LEN;
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of [
    [12, 0.12],
    [3, 0.9],
  ]) {
    ctx.lineWidth = pass[0];
    let rest = left;
    for (const s of SIL_SEGS) {
      if (rest <= 0) break;
      const f = Math.min(1, rest / s[5]);
      rest -= s[5];
      ctx.strokeStyle = `rgba(201,204,210,${(pass[1] * s[4] * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(lerp(s[0], s[2], f), lerp(s[1], s[3], f));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawScan(ctx, t, acc) {
  if (t < TL.scan[0] || t > TL.scan[1]) return;
  const u = seg(t, TL.scan[0], TL.scan[1]);
  const top = SIL.oy + 8 * SIL.k, bottom = SIL.oy + 192 * SIL.k;
  const y = lerp(top + (bottom - top) * 0.02, bottom, eInOut(u));
  const a = kf(u, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]]);
  const x0 = SIL.ox - 0.2 * 540, x1 = SIL.ox + 1.2 * 540;
  const c = `${acc.r},${acc.g},${acc.b}`;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [h, al] of [
    [60, 0.1],
    [18, 0.25],
    [3, 1],
  ]) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(0.5, `rgba(${c},${al * a})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - h / 2, x1 - x0, h);
  }
  ctx.restore();
}

/** Faíscas do "Comprei": do frasco até a aba Coleção. */
const SPARKS = (() => {
  const rand = mulberry32(777);
  return Array.from({ length: 64 }, () => ({ x: 430 + rand() * 220, y: 330 + rand() * 260, d: TL.depart[0] + 0.24 + rand() * 0.3, dur: 0.34 + rand() * 0.16, bend: -200 + rand() * 400, s: 0.9 + rand() * 1.1 }));
})();
function drawSparks(ctx, t, acc) {
  if (t < TL.depart[0] || t > TL.tabPulse + 0.3) return;
  const tx = TAB_X[1] + TAB_W[1] - 40, ty = HUDY.tabs;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const pos = (sp, u) => {
    const e = eCubic(u);
    const cx = (sp.x + tx) / 2 + sp.bend, cy = Math.min(sp.y, ty) - 140;
    const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
    return [a * sp.x + b * cx + c * tx, a * sp.y + b * cy + c * ty];
  };
  for (const sp of SPARKS) {
    const u = (t - sp.d) / sp.dur;
    if (u <= 0 || u > 1.05) continue;
    const [x1, y1] = pos(sp, clamp(u));
    const [x0, y0] = pos(sp, clamp(u - 0.07));
    const al = Math.sin(Math.PI * clamp(u)) * 0.9;
    const head = ctx.createRadialGradient(x1, y1, 0, x1, y1, sp.s * 7);
    head.addColorStop(0, `rgba(255,255,255,${(al * 0.9).toFixed(3)})`);
    head.addColorStop(0.35, `rgba(${acc.r},${acc.g},${acc.b},${(al * 0.45).toFixed(3)})`);
    head.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = head;
    ctx.fillRect(x1 - sp.s * 7, y1 - sp.s * 7, sp.s * 14, sp.s * 14);
    ctx.strokeStyle = `rgba(${acc.r},${acc.g},${acc.b},${(al * 0.22).toFixed(3)})`;
    ctx.lineWidth = sp.s * 4.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${Math.round(lerp(245, acc.r, 0.35))},${Math.round(lerp(247, acc.g, 0.35))},${Math.round(lerp(250, acc.b, 0.35))},${(al * 0.9).toFixed(3)})`;
    ctx.lineWidth = sp.s;
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================================================== câmera */

function camera(t) {
  // F: ponto do mundo que vai para Fs na tela, com zoom Z.
  if (t < TL.zoomOut[1]) {
    const k = eExpoOut(seg(t, TL.zoomOut[0], TL.zoomOut[1]));
    const z0 = lerp(3.75, 3.5, eOut(seg(t, 0, TL.zoomOut[0])));
    const cx = FIELD.textX + INNER / 2 + lerp(-26, 22, seg(t, 0, TL.zoomOut[0]));
    return { Z: lerp(z0, 1, k), F: [lerp(cx, 540, k), lerp(FIELD.cy, 960, k)], Fs: [540, 960] };
  }
  let Z = 1;
  let F = [540, 730];
  Z += t >= TL.impact ? kf(t, [[TL.impact, 0.075, eOut], [TL.impact + 0.55, 0]]) : 0;
  Z += kf(t, [[2.4, 0, eInOut], [4.4, 0.045], [4.55, 0.045, eInOut], [5.1, 0]]);
  if (t >= TL.outro[0]) {
    const k = eInOut(seg(t, TL.outro[0], TL.outro[1] + 0.05));
    Z *= lerp(1, 3.1, k);
    F = [540, lerp(730, 490, k)];
  }
  // Micro-tremores nos toques e no carimbo.
  const shake = (t0, amp) => (t >= t0 ? amp * Math.exp(-(t - t0) * 18) * Math.sin((t - t0) * 90) : 0);
  const dx = shake(TL.tap, 2) + shake(TL.impact, 5) + shake(TL.stamp + 0.03, 3.5);
  const dy = shake(TL.tap + 0.01, 1.5) + shake(TL.impact + 0.01, 4) + shake(TL.stamp + 0.04, 3);
  return { Z, F, Fs: [F[0] + dx, F[1] + dy] };
}

/* ================================================================== quadro */

let drawGalaxy = null;
let frameIndex = 0;
const NOISE = [];

function renderStage(t, acc) {
  // Frasco em foco: posição, escala e visibilidade por ato.
  const pos = posAt(t);
  const inAct2 = t >= TL.impact && t < 4.62;
  const toStage = eInOut(seg(t, 4.62, 5.15));
  const neighbors = t >= 4.7 && t < TL.depart[0] + 0.5 ? eInOut(seg(t, 4.72, 5.25)) * (1 - eInOut(seg(t, TL.depart[0] + 0.15, TL.depart[0] + 0.5))) : 0;
  const floatY = Math.sin((t - 1.5) * 0.9 * TAU * 0.25) * 4 * S;
  let focusCy = lerp(HERO.cy, CY3, toStage);
  let focusScale = lerp(HERO.scale, 1, toStage);
  if (t < 4.62) {
    focusCy = HERO.cy;
    focusScale = HERO.scale;
  }
  if (t >= TL.arrive) {
    focusCy = CY3 + 32;
    focusScale = 0.92;
  }
  const F = F3 * focusScale;
  const base = focusCy + 0.42 * F;
  const stageOn = t >= TL.impact && t < TL.outro[1] + 0.05;

  for (let i = 0; i < R.length; i++) {
    const sl = slots[i];
    let visible = false, x = 540, y = CY3, sc = 1, rot = 0, op = 1, blur = 0, bright = 1, z = 1;
    if (t >= TL.impact && t < TL.outro[1] + 0.05) {
      const d = i - (t < TL.act3 ? 0 : pos);
      const ad = Math.abs(d);
      if (i === 0 && t < 4.62) {
        // Ato 2: o herói (chegada do app, ampliada).
        visible = true;
        const a = seg(t, TL.impact, TL.impact + 0.95);
        y = HERO.cy + kf(a, [[0, 0.08 * 900, eOut], [1, 0]]) + (t > 2.4 ? floatY * seg(t, 2.4, 2.9) : 0);
        sc = HERO.scale * kf(a, [[0, 0.86, eOut], [1, 1]]);
        blur = kf(a, [[0, 16, eOut], [0.6, 0]]);
        bright = kf(a, [[0, 2.6, eOut], [0.6, 1.25, eOut], [1, 1]]);
        op = kf(a, [[0, 0, eOut], [0.45, 1]]);
        rot = kf(t, [[2.4, 0, eInOut], [3.4, -4.5, eInOut], [4.4, 3.5, eInOut], [5.0, 0]]);
        z = 200;
      } else if (ad < 4.6 && (i === 0 || neighbors > 0)) {
        visible = true;
        const sign = Math.sign(d);
        x = 540 + sign * 0.46 * W * Math.pow(ad, 0.78);
        y = focusCy + d * 0.075 * H - (ad < 1 ? (1 - ad) * floatY : 0);
        sc = focusScale / (1 + Math.pow(ad, 0.9) * 0.7);
        rot = clamp(-d * 9, -22, 22) + (i === 0 && t < TL.act3 ? kf(t, [[4.4, 3.5, eInOut], [5.0, 0]]) : 0);
        op = Math.min(1, Math.exp(-ad * 1.1) * 1.05) * (i === 0 && t < TL.act3 ? 1 : ad < 0.5 ? 1 : neighbors);
        if (i !== 0 && t < TL.act3) op *= neighbors;
        z = 100 - Math.round(ad * 10);
      }
      if (i === 0 && t >= TL.depart[0]) {
        // "Comprei": depart (720 ms) e, na Coleção, arrive (1 s).
        if (t < TL.arrive) {
          const u = seg(t, TL.depart[0], TL.depart[1]);
          const e = eInOut(u);
          y += kf(e, [[0, 0], [0.3, -0.02 * 700], [1, -0.26 * 700]]);
          sc *= kf(e, [[0, 1], [0.3, 1.03], [1, 0.72]]);
          bright = kf(e, [[0, 1], [0.3, 1.5], [1, 2.4]]);
          blur = kf(e, [[0, 0], [0.3, 0], [1, 8 * S]]);
          op = 1 - seg(e, 0.35, 1);
          visible = u < 1;
          x = 540;
        } else {
          const a = seg(t, TL.arrive, TL.arrive + 1.0);
          x = 540;
          y = CY3 + 32 + kf(a, [[0, 0.08 * 700, eOut], [1, 0]]) + floatY * seg(t, TL.arrive + 0.8, TL.arrive + 1.3);
          sc = 0.92 * kf(a, [[0, 0.88, eOut], [1, 1]]);
          blur = kf(a, [[0, 12 * 1.5, eOut], [0.6, 0]]);
          bright = kf(a, [[0, 2.2, eOut], [0.6, 1.25, eOut], [1, 1]]);
          op = kf(a, [[0, 0, eOut], [0.5, 1]]);
          visible = true;
        }
      }
    }
    if (!visible || op < 0.004) {
      set(sl.s, 'display', 'none');
      continue;
    }
    set(sl.s, 'display', '');
    set(sl.s, 'opacity', op.toFixed(3));
    set(sl.s, 'zIndex', String(z));
    set(sl.s, 'transform', `translate(${px(x - F3 / 2)}, ${px(y - F3 / 2)}) perspective(2400px) rotateY(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
    const shadow = 'drop-shadow(0 76px 92px rgb(0 0 0 / 0.55))';
    set(sl.img, 'filter', `${blur > 0.05 ? `blur(${blur.toFixed(2)}px) ` : ''}${bright !== 1 ? `brightness(${bright.toFixed(3)}) ` : ''}${shadow}`);
    set(sl.refl, 'filter', `blur(${(4 + blur).toFixed(2)}px)${bright !== 1 ? ` brightness(${bright.toFixed(3)})` : ''}`);
    // Brilho especular (sheen do app) acompanhando a inclinação do herói.
    const sheenOn = i === 0 && t > 2.2 && t < 5.1 ? seg(t, 2.3, 2.8) * (1 - seg(t, 4.5, 5.0)) * 0.9 : 0;
    set(sl.sheen, 'opacity', sheenOn.toFixed(3));
    if (sheenOn > 0) {
      const sh = 50 + rot * 7;
      set(sl.sheen, 'background', `linear-gradient(104deg, transparent ${sh - 22}%, rgb(255 255 255 / 0.22) ${sh}%, transparent ${sh + 22}%)`);
    }
  }

  // Cone, poça, horizonte e anéis de luz (o palco do app).
  const departFade = t >= TL.depart[0] && t < TL.arrive ? 1 - seg(t, TL.depart[0] + 0.2, TL.depart[1]) : 1;
  const arriveFade = t >= TL.arrive ? seg(t, TL.arrive, TL.arrive + 0.6) : 1;
  const stageAlpha = stageOn ? seg(t, TL.impact, TL.impact + 0.5) * departFade * arriveFade * (1 - seg(t, TL.outro[0] + 0.1, TL.outro[1])) : 0;
  const bw = 0.62 * F;
  vis(beam, stageAlpha);
  place(beam, 540 - bw * 1.05, 0, bw * 2.1, base);
  vis(pool, stageAlpha);
  place(pool, 540 - bw * 0.75, base - 0.07 * F * 0.84, bw * 1.5, 0.14 * F * 0.84);
  vis(horizon, stageAlpha * 0.9);
  place(horizon, 540 - 800, base - 1, 1600, 2);
  const ringTimes = [TL.impact, TL.depart[0], TL.arrive];
  rings.forEach((r, j) => {
    const u = seg(t, ringTimes[j], ringTimes[j] + 0.9);
    const on = t >= ringTimes[j] && u < 1;
    vis(r, on ? 0.9 * (1 - eOut(u)) : 0);
    if (!on) return;
    const rb = ringTimes[j] === TL.impact ? HERO.cy + 0.42 * F3 * HERO.scale : ringTimes[j] === TL.arrive ? base : 1070;
    const rw = 1.4 * bw * (ringTimes[j] === TL.impact ? 1.35 : 1.15), rh = 0.16 * 0.84 * F;
    place(r, 540 - rw / 2, rb - rh / 2, rw, rh);
    set(r, 'transform', `scale(${lerp(0.3, 1.4, eOut(u)).toFixed(4)})`);
  });
  return { pos };
}

function renderAct1(t) {
  // Folha: visível até se desfazer; o texto do link é desenhado no canvas (fx).
  const out = seg(t, 0.66, 0.9);
  vis(sheetGroup, 1 - out);
  const focusBlur = kf(t, [[0, 3.2], [0.3, 2.6, eInOut], [0.56, 0]]);
  const sb = focusBlur + out * 14;
  set(sheetGroup, 'filter', sb > 0.05 ? `blur(${sb.toFixed(2)}px)` : 'none');
  // O botão claro vira partículas: some mais cedo (as faíscas assumem).
  vis(button, 1 - seg(t, 0.7, 0.8));
  const enabled = kf(t, [[0, 0.34], [0.3, 0.34, eOut], [0.44, 1]]);
  set(button, 'background', `rgba(236,238,242,${enabled.toFixed(3)})`);
  const press = kf(t, [[TL.tap - 0.001, 1], [TL.tap, 1, eOut], [TL.tap + 0.05, 0.97, eOut], [TL.tap + 0.18, 1]]);
  set(button, 'transform', `scale(${press.toFixed(4)})`);
  set(button, 'boxShadow', t >= TL.tap && t < TL.tap + 0.3 ? `0 0 0 ${(4 * S).toFixed(1)}px rgb(var(--accent-rgb) / ${(0.14 * (1 - seg(t, TL.tap, TL.tap + 0.3))).toFixed(3)})` : 'none');
  // Ripple do toque.
  const ru = seg(t, TL.tap, TL.tap + 0.45);
  vis(tapRipple, t >= TL.tap && ru < 1 ? 0.9 * (1 - ru) : 0);
  const rr = lerp(40, 520, eOut(ru));
  place(tapRipple, 540 - rr, BUTTON.y + BUTTON.h / 2 - rr, rr * 2, rr * 2);
  // Etapas reais da análise, piscando.
  const st = seg(t, TL.steps[0], TL.steps[1]);
  const on = t >= TL.steps[0] && t < TL.steps[1] + 0.06;
  const k = clamp(Math.floor(st * 7), 0, 6);
  vis(stepsText, on ? seg(t, TL.steps[0], TL.steps[0] + 0.05) * (1 - seg(t, TL.steps[1], TL.steps[1] + 0.06)) : 0);
  vis(marks, on ? seg(t, TL.steps[0], TL.steps[0] + 0.05) * (1 - seg(t, TL.steps[1], TL.steps[1] + 0.06)) : 0);
  if (on) {
    if (stepsText._c.text !== k) {
      stepsText._c.text = k;
      stepsText.textContent = `${STEPS[k]}…`;
    }
    markEls.forEach((m, j) => {
      const lit = j <= k;
      if (m._lit !== lit) {
        m._lit = lit;
        m.className = lit ? 'on' : '';
      }
    });
  }
}

function renderAct2(t) {
  // Nome, ficha e pirâmide sobre o frasco.
  const outP = eInOut(seg(t, TL.act2Out[0], TL.act2Out[1]));
  const nameOn = t >= TL.heroName - 0.01 && t < TL.act2Out[1] + 0.05;
  vis(heroName, nameOn ? 1 - outP : 0);
  if (nameOn) {
    const tr = lerp(0.34, 0.015, eOut(seg(t, TL.heroName, TL.heroName + 0.75)));
    set(heroName, 'letterSpacing', `${tr.toFixed(4)}em`);
    set(heroName, 'transform', `translateY(${px(outP * 24)})`);
    heroLetters.forEach((s, j) => {
      const u = seg(t, TL.heroName + j * 0.028, TL.heroName + j * 0.028 + 0.5);
      const e = eOut(u);
      set(s, 'opacity', e.toFixed(3));
      set(s, 'transform', `translateY(${px((1 - e) * 22)})`);
      set(s, 'filter', u < 1 ? `blur(${((1 - e) * 8).toFixed(2)}px)` : 'none');
    });
  }
  const metaU = seg(t, TL.heroMeta, TL.heroMeta + 0.55);
  vis(heroMeta, t >= TL.heroMeta && t < TL.act2Out[1] + 0.05 ? eOut(metaU) * (1 - outP) : 0);
  set(heroMeta, 'transform', `translateY(${px((1 - eOut(metaU)) * 14 + outP * 24)})`);

  TIER_Y.forEach((_, i) => {
    const t0 = TL.tiers[i];
    const on = t >= t0 && t < TL.act2Out[1] + 0.05;
    const grow = eOut(seg(t, t0, t0 + 0.6)) * (1 - outP);
    vis(rules[i], on ? Math.min(1, grow * 1.4) : 0);
    set(rules[i], 'transform', `scaleX(${grow.toFixed(4)})`);
    const tx = tiers[i];
    for (const [node, delay] of [
      [tx.name, 0.1],
      [tx.cap, 0.16],
      [tx.notes, 0.18],
    ]) {
      const u = seg(t, t0 + delay, t0 + delay + 0.6);
      const e = eOut(u);
      vis(node, on ? e * (1 - outP) : 0);
      set(node, 'transform', `translateY(${px((1 - e) * 8 * S - outP * 18)})`);
      set(node, 'filter', u < 1 ? `blur(${((1 - e) * 2 * S).toFixed(2)}px)` : 'none');
    }
  });
}

function renderHud(t, stage) {
  const hudIn = t >= TL.act3 - 0.05 && t < TL.outro[1];
  const hudOut = 1 - seg(t, TL.outro[0], TL.outro[0] + 0.25);
  vis(hud, hudIn ? hudOut : 0);
  if (!hudIn) return;
  set(hud, 'filter', t > TL.outro[0] ? `blur(${(seg(t, TL.outro[0], TL.outro[0] + 0.25) * 10).toFixed(2)}px)` : 'none');
  const inU = (delay) => eOut(seg(t, TL.act3 + delay, TL.act3 + delay + 0.6));
  const owned = t >= TL.tabPulse;
  const collectionView = t >= TL.tabTap + 0.05;
  // Abas
  const a1 = inU(0.02);
  vis(tabW, a1);
  vis(tabC, a1);
  set(tabW, 'transform', `translateY(${px((1 - a1) * -18)})`);
  set(tabC, 'transform', `translateY(${px((1 - a1) * -18)})`);
  place(tabW, TAB_X[0], HUDY.tabs - 20);
  place(tabC, TAB_X[1], HUDY.tabs - 20);
  const wCount = owned ? DATA.counts.wishlist - 1 : DATA.counts.wishlist;
  const cCount = owned ? DATA.counts.owned + 1 : DATA.counts.owned;
  if (tabWn._c.n !== wCount) {
    tabWn._c.n = wCount;
    tabWn.textContent = String(wCount);
  }
  if (tabCn._c.n !== cCount) {
    tabCn._c.n = cCount;
    tabCn.textContent = String(cCount);
  }
  set(tabW, 'color', collectionView ? 'var(--text-3)' : 'var(--text)');
  set(tabC, 'color', collectionView ? 'var(--text)' : 'var(--text-3)');
  // Pulso do contador da Coleção (count-pulse do app, 1,1 s).
  const pu = seg(t, TL.tabPulse, TL.tabPulse + 1.1);
  if (t >= TL.tabPulse && pu < 1) {
    const sc = kf(pu, [[0, 1, eOut], [0.25, 1.5, eOut], [1, 1]]);
    set(tabCn, 'transform', `scale(${sc.toFixed(3)})`);
    set(tabCn, 'color', pu < 0.6 ? 'var(--accent)' : 'var(--text-3)');
    set(tabCn, 'textShadow', pu < 0.6 ? '0 0 32px var(--accent-glow)' : 'none');
  } else {
    set(tabCn, 'transform', 'none');
    set(tabCn, 'color', 'var(--text-3)');
    set(tabCn, 'textShadow', 'none');
  }
  // Sublinhado da aba ativa (cresce do centro e desliza para Coleção).
  const slide = eOut(seg(t, TL.tabTap, TL.tabTap + 0.32));
  const ux = lerp(TAB_X[0], TAB_X[1], slide), uw = lerp(TAB_W[0], TAB_W[1], slide);
  const grow = inU(0.12);
  place(underline, ux, HUDY.tabs + 34, uw, 3);
  set(underline, 'transform', `scaleX(${grow.toFixed(4)})`);
  vis(underline, grow);
  const tr = seg(t, TL.tabTap, TL.tabTap + 0.4);
  vis(tabRipple, t >= TL.tabTap && tr < 1 ? 0.7 * (1 - tr) : 0);
  const trr = lerp(20, 170, eOut(tr));
  place(tabRipple, TAB_X[1] + TAB_W[1] / 2 - trr, HUDY.tabs - trr, trr * 2, trr * 2);
  const a2 = inU(0.06);
  vis(plus, a2);
  // Contador / filtros
  const idx = clamp(Math.round(stage.pos), 0, R.length - 1);
  vis(counter, collectionView ? 0 : inU(0.1) * (1 - seg(t, TL.depart[0], TL.depart[0] + 0.3)));
  const ctext = `${String(idx + 1).padStart(2, '0')}|${R.length}`;
  if (counter._c.text !== ctext) {
    counter._c.text = ctext;
    counter.innerHTML = `<b>${String(idx + 1).padStart(2, '0')}</b>&nbsp;&nbsp;/&nbsp;&nbsp;${R.length}`;
  }
  const fu = eOut(seg(t, TL.arrive, TL.arrive + 0.6));
  vis(filters, collectionView ? fu : 0);
  set(filters, 'transform', `translateY(${px((1 - fu) * -14)})`);
  const rebuy = t >= TL.stamp + 0.05 ? '1' : '0';
  if (filterRebuy._c.v !== rebuy) {
    filterRebuy._c = { v: rebuy };
    filterRebuy.textContent = rebuy;
    filterRebuy.parentElement.style.color = rebuy === '1' ? 'var(--text)' : '';
  }
  // Placa (troca com plate-in do app)
  let pl;
  if (t < TL.depart[0] + 0.2) pl = plateAt(t);
  else pl = { i: 0, since: t - TL.arrive - 0.1, dur: 0.6 };
  const plateVisible = t < TL.depart[0] + 0.35 || t >= TL.arrive + 0.1;
  const plateOut = t >= TL.depart[0] && t < TL.arrive + 0.1 ? 1 - seg(t, TL.depart[0] + 0.25, TL.depart[0] + 0.5) : 1;
  const r = R[pl.i];
  if (plateName._c.i !== pl.i) {
    plateName._c.i = pl.i;
    plateName.textContent = r.name;
    plateName.style.fontSize = `${PLATE_FONT[pl.i]}px`;
    plateMeta.innerHTML = metaHtml(r.meta);
    platePrice.textContent = r.price ?? '';
  }
  const first = t < TL.act3 + 0.8 && pl.i === 0 && t < TL.snaps[0];
  [plateName, plateMeta, platePrice].forEach((node, j) => {
    const since = first ? t - TL.act3 - 0.12 : pl.since;
    const delay = [0, 0.05, 0.11][j];
    const u = seg(since - delay, 0, first ? 0.7 : pl.dur);
    const e = eOut(u);
    let o = plateVisible ? e * plateOut : 0;
    if (node === platePrice && collectionView) o = 0;
    vis(node, o);
    set(node, 'transform', `translateY(${px((1 - e) * 10 * S)})`);
    set(node, 'filter', u < 1 ? `blur(${((1 - e) * 3 * S).toFixed(2)}px)` : 'none');
  });
  // "Comprei": entra com a placa, estado ativo no toque, sai com a partida.
  const act = inU(0.2) * (1 - seg(t, TL.depart[0] + 0.25, TL.depart[0] + 0.55));
  vis(action, collectionView ? 0 : act);
  // Tocado, fica ativo até sumir com a partida (o item foi para a coleção; não "destoca").
  const pressed = t >= TL.comprei && t < TL.depart[0] + 0.55;
  set(action, 'borderColor', pressed ? 'var(--accent-line)' : 'var(--line-strong)');
  set(action, 'background', pressed ? 'var(--accent-soft)' : 'transparent');
  set(action, 'boxShadow', pressed ? `0 ${(10 * S).toFixed(0)}px ${(30 * S).toFixed(0)}px -${(12 * S).toFixed(0)}px var(--accent-glow)` : 'none');
  set(action, 'transform', `scale(${kf(t, [[TL.comprei, 1, eOut], [TL.comprei + 0.06, 0.975, eOut], [TL.comprei + 0.22, 1]]).toFixed(4)})`);
  set(diamond, 'background', pressed ? 'var(--accent)' : 'transparent');
  const ar = seg(t, TL.comprei, TL.comprei + 0.5);
  vis(actionRipple, t >= TL.comprei && ar < 1 ? 0.8 * (1 - ar) : 0);
  const arr = lerp(30, 380, eOut(ar));
  place(actionRipple, 540 - arr, HUDY.action + 60 - arr, arr * 2, arr * 2);
  // Veredito e carimbo (assinatura do app).
  const vl = eOut(seg(t, TL.verdictLabel, TL.verdictLabel + 0.5));
  vis(verdictLabel, collectionView ? vl : 0);
  set(verdictLabel, 'transform', `translateY(${px((1 - vl) * 10)})`);
  const su = seg(t, TL.stamp, TL.stamp + 0.62);
  const stampOn = t >= TL.stamp;
  vis(stamp, stampOn ? kf(su, [[0, 0, eOut], [0.55, 1]]) : 0);
  if (stampOn) {
    const sc = kf(su, [[0, 1.18, eOut], [0.55, 0.98, eOut], [1, 1]]);
    const rot = kf(su, [[0, -2, eOut], [0.55, 0]]);
    set(stamp, 'transform', `scale(${sc.toFixed(4)}) rotate(${rot.toFixed(3)}deg)`);
    set(stamp, 'filter', su < 0.55 ? `blur(${((1 - su / 0.55) * 2 * S).toFixed(2)}px)` : 'none');
    const ring = seg(su, 0.55, 1);
    set(stamp, 'boxShadow', su < 1 ? `0 0 0 ${(ring * 12 * S).toFixed(1)}px rgb(var(--accent-rgb) / ${(0.32 * (1 - ring)).toFixed(3)})` : 'none');
  }
}

function renderEndcard(t, acc) {
  const on = t >= TL.outro[0] + 0.15;
  vis(endcard, on ? 1 : 0);
  if (!on) return;
  // A luz azul enche a tela e se contrai até virar a tampa do glifo.
  const grow = eOut(seg(t, TL.outro[0] + 0.18, TL.final));
  const shrink = eInOut(seg(t, TL.final, TL.final + 0.34));
  const capCx = GLYPH.capX + GLYPH.capW / 2, capCy = GLYPH.capY + GLYPH.capH / 2;
  const size = lerp(300, 2700, grow);
  const cx = lerp(540, capCx, shrink), cy = lerp(lerp(470, 720, grow), capCy, shrink);
  const w = lerp(size, GLYPH.capW, shrink), h = lerp(size, GLYPH.capH, shrink);
  place(flood, cx - w / 2, cy - h / 2, w, h);
  // A luz (gradiente radial: uma elipse) vira a tampa (retângulo) sem salto. Na reta final da contração o raio da
  // borda desce de círculo a 4 px enquanto o gradiente se estende até os cantos (√2 ≈ 1,42 do raio inscrito); o
  // acabamento da tampa (brilho + degradê) entra por cima só no fim, quando a forma já é a da tampa.
  const u = seg(t, TL.final, TL.final + 0.34);
  const fill = eInOut(seg(u, 0.55, 1));
  set(flood, 'borderRadius', shrink >= 1 ? '4px' : `${lerp(Math.min(w, h) / 2, 4, fill).toFixed(2)}px`);
  const solid = Math.pow(shrink, 0.6);
  // O canto arredondado mais distante do centro fica a √2·f + (1 − f) do raio inscrito: o gradiente chega lá antes.
  const reach = lerp(1, 1.42, Math.min(1, fill * 1.8));
  const capStyle = (a) => `linear-gradient(180deg, rgb(255 255 255 / ${(0.28 * a).toFixed(3)}), rgb(255 255 255 / 0) 42%), linear-gradient(180deg, rgb(var(--accent-rgb) / ${a.toFixed(3)}), rgb(var(--accent-rgb) / ${(0.86 * a).toFixed(3)}))`;
  const capIn = eInOut(seg(u, 0.8, 1));
  const glowLeft = 1 - seg(u, 0.9, 1);
  const light = `radial-gradient(closest-side, rgb(var(--accent-rgb) / ${(0.95 * glowLeft).toFixed(3)}) ${((lerp(18, 100, solid) - 1) * reach).toFixed(1)}%, rgb(var(--accent-rgb) / ${(lerp(0.35, 0.95, solid) * glowLeft).toFixed(3)}) ${(lerp(55, 100, solid) * reach).toFixed(1)}%, rgb(var(--accent-rgb) / 0) ${(100 * reach).toFixed(1)}%)`;
  set(flood, 'background', shrink >= 1 ? capStyle(1) : capIn > 0 ? `${capStyle(capIn)}, ${light}` : light);
  set(flood, 'filter', shrink >= 1 ? 'none' : `blur(${lerp(46, 0, shrink).toFixed(2)}px)`);
  const floodAlpha = shrink > 0 ? lerp(0.72, 1, shrink) : grow * 0.72;
  vis(flood, floodAlpha);
  const breathe = t > 14.2 ? 0.5 + 0.5 * Math.sin((t - 14.2) * 3.2) : 0;
  set(flood, 'boxShadow', `0 0 ${(90 + 60 * breathe).toFixed(0)}px ${(10 + 12 * breathe).toFixed(0)}px var(--accent-glow)`);
  // Contorno do glifo se desenhando.
  const draw = eInOut(seg(t, TL.final + 0.3, TL.final + 0.78));
  glyphBody.setAttribute('stroke-dashoffset', (1 - draw).toFixed(4));
  glyph.style.opacity = draw > 0 ? '1' : '0';
  const floor = eOut(seg(t, TL.final + 0.5, TL.final + 1.1));
  vis(endPool, floor * 0.9);
  vis(endHorizon, floor);
  vis(endRefl, draw >= 1 ? floor : 0);
  // Wordmark, letra a letra, com o tracking de 0,55 → 0,3 em.
  const wm = seg(t, TL.wordmark, TL.wordmark + 0.8);
  set(wordmark, 'letterSpacing', `${lerp(0.55, 0.3, eOut(wm)).toFixed(4)}em`);
  wordLetters.forEach((s, j) => {
    const u = seg(t, TL.wordmark + j * 0.035, TL.wordmark + j * 0.035 + 0.5);
    const e = eOut(u);
    set(s, 'opacity', e.toFixed(3));
    set(s, 'filter', u < 1 ? `blur(${((1 - e) * 6).toFixed(2)}px)` : 'none');
    set(s, 'transform', `translateY(${px((1 - e) * 12)})`);
  });
  const tg = seg(t, TL.tagline, TL.tagline + 0.6);
  const te = eOut(tg);
  vis(tagline, te);
  set(tagline, 'transform', `translateY(${px((1 - te) * 20)})`);
  set(tagline, 'filter', tg < 1 ? `blur(${((1 - te) * 6).toFixed(2)}px)` : 'none');
}

function renderOverlay(t, acc) {
  ov.clearRect(0, 0, W, H);
  // Flash da materialização: radial branco → azul + um fio anamórfico.
  const fl = kf(t, [[TL.impact - 0.03, 0], [TL.impact, 1, eOut], [TL.impact + 0.06, 0.8, eOut], [TL.impact + 0.6, 0]]);
  if (fl > 0.002) {
    const g = ov.createRadialGradient(540, 760, 0, 540, 760, 1100);
    g.addColorStop(0, `rgba(255,255,255,${(0.95 * fl).toFixed(3)})`);
    g.addColorStop(0.18, `rgba(${acc.r},${acc.g},${acc.b},${(0.7 * fl).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ov.fillStyle = g;
    ov.fillRect(0, 0, W, H);
    ov.save();
    ov.translate(540, 760);
    ov.scale(1, 0.018);
    const s = ov.createRadialGradient(0, 0, 0, 0, 0, 1300);
    s.addColorStop(0, `rgba(210,225,255,${(0.9 * fl).toFixed(3)})`);
    s.addColorStop(1, 'rgba(0,0,0,0)');
    ov.fillStyle = s;
    ov.fillRect(-1300, -1300, 2600, 2600);
    ov.restore();
  }
  // Toque no botão: pequeno brilho.
  const tapFl = t >= TL.tap ? Math.exp(-(t - TL.tap) * 14) : 0;
  if (tapFl > 0.01) {
    const g = ov.createRadialGradient(540, BUTTON.y + 62, 0, 540, BUTTON.y + 62, 700);
    g.addColorStop(0, `rgba(255,255,255,${(0.25 * tapFl).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ov.fillStyle = g;
    ov.fillRect(0, 0, W, H);
  }
  // Faíscas chegando na aba Coleção: um clarão curto no sotaque.
  const tabFl = kf(t, [[TL.tabPulse - 0.08, 0], [TL.tabPulse, 1, eOut], [TL.tabPulse + 0.55, 0]]);
  if (tabFl > 0.01) {
    const x = TAB_X[1] + TAB_W[1] - 40;
    const g = ov.createRadialGradient(x, HUDY.tabs, 0, x, HUDY.tabs, 260);
    g.addColorStop(0, `rgba(${acc.r},${acc.g},${acc.b},${(0.55 * tabFl).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ov.fillStyle = g;
    ov.fillRect(0, 0, W, H);
  }
  // Acorde final: a luz da tampa respira sobre a marca.
  const fin = t >= TL.final ? Math.exp(-(t - TL.final) * 4) : 0;
  if (fin > 0.01) {
    const g = ov.createRadialGradient(540, 622, 0, 540, 622, 900);
    g.addColorStop(0, `rgba(${acc.r},${acc.g},${acc.b},${(0.35 * fin).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ov.fillStyle = g;
    ov.fillRect(0, 0, W, H);
  }
  // Granulação fina (película), também contra faixas nos degradês escuros do H.264.
  grain.clearRect(0, 0, W / 2, H / 2);
  grain.globalAlpha = 1;
  const n = NOISE[frameIndex % NOISE.length];
  grain.drawImage(n, -((frameIndex * 97) % 64), -((frameIndex * 53) % 64));
}

function render(t) {
  const acc = accentAt(t).rgb;
  const accFull = accentAt(t);
  document.documentElement.style.setProperty('--accent-rgb', `${acc.r} ${acc.g} ${acc.b}`);

  // Câmera no mundo (DOM) e no canvas de efeitos.
  const cam = camera(t);
  const tx = cam.Fs[0] - cam.F[0] * cam.Z, ty = cam.Fs[1] - cam.F[1] * cam.Z;
  set(world, 'transform', `matrix(${cam.Z.toFixed(5)},0,0,${cam.Z.toFixed(5)},${tx.toFixed(3)},${ty.toFixed(3)})`);
  const worldBlur = seg(t, TL.outro[0] + 0.1, TL.outro[1]) * 18;
  set(world, 'filter', worldBlur > 0.05 ? `blur(${worldBlur.toFixed(2)}px)` : 'none');
  vis(world, 1 - seg(t, TL.outro[1] - 0.1, TL.outro[1] + 0.08));

  const stage = renderStage(t, acc);
  renderAct1(t);
  renderAct2(t);
  renderHud(t, stage);
  renderEndcard(t, acc);

  // Galáxia real (uniformes por ato).
  const focusY = t < TL.impact ? 0.4 : t < TL.act3 ? 0.38 : t < TL.outro[1] ? 0.375 : 0.43;
  const pointer = t < TL.zoomOut[1] ? [(cam.F[0] - 540) / 540, 0.1 + (1 - seg(t, TL.zoomOut[0], TL.zoomOut[1])) * 0.3] : [Math.sin(t * 0.35) * 0.25, Math.cos(t * 0.27) * 0.18];
  drawGalaxy({
    time: 40 + t,
    rgb: acc,
    sat: accFull.sat,
    focus: [0.5, focusY],
    pointer,
    scroll: t >= TL.act3 ? stage.pos * 1.4 : 0,
    boost: kf(t, [[0, 1.25], [TL.impact - 0.02, 1.35], [TL.impact, 3.6, eOut], [TL.impact + 0.9, 1.7], [4.8, 1.7, eInOut], [5.4, 4.2], [TL.land, 4.2, eInOut], [TL.comprei, 1.9], [TL.outro[0], 1.8], [TL.final, 2.6, eOut], [TL.final + 0.8, 1.7], [15, 1.6]]),
  });

  // Efeitos no mundo (com a câmera).
  fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.clearRect(0, 0, W, H);
  fx.setTransform(cam.Z, 0, 0, cam.Z, tx, ty);
  if (t < TL.dissolve[0]) drawUrl(fx, t, false);
  drawParticles(fx, t, acc);
  drawSilhouette(fx, t);
  drawScan(fx, t, acc);
  fx.setTransform(1, 0, 0, 1, 0, 0);
  drawSparks(fx, t, acc);
  renderOverlay(t, acc);
}

/* ================================================================== inicialização */

async function init() {
  await document.fonts.load('400 43px "Archivo Variable"');
  await document.fonts.load('250 100px "Archivo Variable"');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));

  // Medidas de texto do link (mesma fonte do canvas).
  const m = document.createElement('canvas').getContext('2d');
  m.font = URL_FONT;
  PREFIX = [0];
  for (let i = 1; i <= URL_TEXT.length; i++) PREFIX.push(m.measureText(URL_TEXT.slice(0, i)).width);
  const i0 = URL_TEXT.indexOf('azzure-aoud');
  SLUG_X = FIELD.textX - 0;
  S_END = Math.max(0, prefixW(URL_TEXT.length) - INNER + 18);
  S_STAR = clamp(prefixW(i0) + (prefixW(i0 + 11) - prefixW(i0)) / 2 - INNER / 2, 0, S_END);
  SLUG_X = FIELD.textX - S_STAR + prefixW(i0);

  buildSilhouette();
  buildParticles();

  // Nomes da placa: maior tamanho (até 92 px) que cabe em uma linha de 912 px.
  PLATE_FONT = R.map((r) => {
    const w = textWidth('display', r.name, { fontSize: '100px' });
    return Math.min(92, Math.floor((912 / w) * 100));
  });
  const heroFont = Math.min(112, Math.floor((960 / textWidth('display', hero.name, { fontSize: '100px' })) * 100));
  heroName.style.fontSize = `${heroFont}px`;
  place(heroName, 0, 1240);
  place(heroMeta, 0, 1374);
  // Abas: posições reais medidas.
  const wW = textWidth('tab', 'Wishlist 15');
  const wC = textWidth('tab', 'Coleção 0');
  TAB_W = [wW, wC];
  TAB_X = [84, 84 + wW + 76];

  // Película (granulação) pré-calculada.
  const rand = mulberry32(99);
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas');
    c.width = W / 2 + 64;
    c.height = H / 2 + 64;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = 128 + (rand() + rand() + rand() - 1.5) * 34;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 34;
    }
    g.putImageData(img, 0, 0);
    NOISE.push(c);
  }

  drawGalaxy = makeGalaxy($('galaxy'));
  window.renderAt = (t, index = Math.round(t * 60)) => {
    frameIndex = index;
    render(t);
    return true;
  };
  window.AD_INFO = { particles: P.N, plateFont: PLATE_FONT, tabs: TAB_X, sStar: S_STAR };
  window.adReady = true;
}

init().catch((error) => {
  window.adError = String(error?.stack ?? error);
});
