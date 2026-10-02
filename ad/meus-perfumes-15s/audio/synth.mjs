/**
 * Trilha e sound design do anúncio "Meus Perfumes — 15 s", sintetizados do zero (nenhum sample de terceiros).
 * Lê a MESMA linha do tempo do vídeo (src/timeline.js): cada som nasce no instante do movimento que ele acompanha.
 *
 * Identidade sonora "vidro e espaço": notas de vidro (síntese modal) como instrumento principal — cada frasco que
 * entra em foco toca uma nota —, pulso eletrônico mínimo a 120 BPM em lá menor, impactos graves com harmônicos (para
 * aparecerem até em alto-falante de celular) e um reverb longo de "espaço".
 *
 * Saída (audio/out): musica.wav (pad, baixo, bateria e melodia de vidro), efeitos.wav (sound design),
 * mix-pre-master.wav (tudo junto, antes da normalização). A normalização final (-14 LUFS, -1 dBTP) é feita pelo
 * ffmpeg em tools/master.mjs.
 *   node audio/synth.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AD = path.resolve(import.meta.dirname, '..');
const tlSrc = readFileSync(path.join(AD, 'src', 'timeline.js'), 'utf8');
const TL = JSON.parse(tlSrc.slice(tlSrc.indexOf('{'), tlSrc.lastIndexOf('}') + 1));

const SR = 48000;
const N = Math.round(SR * TL.duration);
const TAU = Math.PI * 2;
const sec = (s) => Math.max(0, Math.round(s * SR));
const db = (d) => Math.pow(10, d / 20);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);

/* ------------------------------------------------------------------ barramentos */

const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const MUSIC = bus();
const SFX = bus();
const SEND_M = bus(); // reverb da música
const SEND_S = bus(); // reverb dos efeitos

/**
 * Coloca um sinal mono num barramento, com pan de potência constante (fixo ou função do tempo local) e envio de
 * reverb. `pan` em -1..1.
 */
function put(target, t0, x, gainDb, pan = 0, send = 0) {
  const g = db(gainDb);
  const start = sec(t0);
  for (let i = 0; i < x.length; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const p = typeof pan === 'function' ? pan(i / SR) : pan;
    const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4;
    const v = x[i] * g;
    const l = v * Math.cos(a) * Math.SQRT2;
    const r = v * Math.sin(a) * Math.SQRT2;
    target.L[j] += l;
    target.R[j] += r;
    if (send) {
      const s = target === MUSIC ? SEND_M : SEND_S;
      s.L[j] += l * send;
      s.R[j] += r * send;
    }
  }
}

/* ------------------------------------------------------------------ blocos de síntese */

function noise(n, r = rand) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = r() * 2 - 1;
  return y;
}
function pink(n, r = rand) {
  const y = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return y;
}
function coeffs(type, f, q) {
  const w = (TAU * clamp(f, 10, SR * 0.45)) / SR;
  const cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + a, a1 = -2 * cs, a2 = 1 - a;
  if (type === 'lp') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
  else if (type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  else [b0, b1, b2] = [a, 0, -a]; // passa-banda, ganho de pico 0 dB
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** Biquad RBJ; `f` pode ser número ou função do tempo local (varredura). */
function filt(x, type, f, q = 0.707) {
  const y = new Float32Array(x.length);
  const dyn = typeof f === 'function';
  let c = coeffs(type, dyn ? f(0) : f, q);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (dyn && (i & 31) === 0) c = coeffs(type, f(i / SR), q);
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
const expGlide = (a, b, dur) => (t) => a * Math.pow(b / a, clamp(t / dur));
function mulEnv(x, env) {
  for (let i = 0; i < x.length; i++) x[i] *= env(i / SR);
  return x;
}
function fadeEdges(x, inMs = 2, outMs = 8) {
  const a = Math.max(1, sec(inMs / 1000)), b = Math.max(1, sec(outMs / 1000));
  for (let i = 0; i < Math.min(a, x.length); i++) x[i] *= i / a;
  for (let i = 0; i < Math.min(b, x.length); i++) x[x.length - 1 - i] *= i / b;
  return x;
}
/** Oscilador com frequência variável (fase acumulada). */
function osc(n, freq, shape = 'sin', phase = 0) {
  const y = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const f = typeof freq === 'function' ? freq(i / SR) : freq;
    const inc = f / SR;
    ph += inc;
    ph -= Math.floor(ph);
    if (shape === 'sin') y[i] = Math.sin(TAU * ph);
    else if (shape === 'tri') y[i] = 1 - 4 * Math.abs(ph - 0.5);
    else {
      // dente de serra com polyBLEP (sem aliasing audível)
      let v = 2 * ph - 1;
      if (ph < inc) {
        const t = ph / inc;
        v -= t + t - t * t - 1;
      } else if (ph > 1 - inc) {
        const t = (ph - 1) / inc;
        v -= t * t + t + t + 1;
      }
      y[i] = v;
    }
  }
  return y;
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const NOTE = { A1: 33, C2: 36, F1: 29, G1: 31, A2: 45, C3: 48, E3: 52, F2: 41, G2: 43, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, G5: 79, A5: 81, B5: 83, C6: 84, D6: 86, E6: 88, G6: 91, A6: 93, E7: 100, D3: 50 };

/* ------------------------------------------------------------------ instrumentos */

/** Vidro (síntese modal): parciais inarmônicas de uma taça, cada uma com seu decaimento e um par levemente
 *  desafinado (batimento = brilho). O golpe é um estalo curto de ruído agudo. */
function glass(freq, dur = 2.4, bright = 1, seed = 1) {
  const r = mulberry32(seed * 977 + Math.round(freq));
  const n = sec(dur);
  const y = new Float32Array(n);
  const partials = [
    [1, 1, 1],
    [2.32, 0.5 * bright, 0.55],
    [4.25, 0.26 * bright, 0.32],
    [6.63, 0.12 * bright, 0.2],
    [9.38, 0.06 * bright, 0.12],
  ];
  for (const [ratio, amp, dec] of partials) {
    const f = freq * ratio;
    if (f > 16000) continue;
    const tau = dur * 0.36 * dec;
    const det = 0.4 + r() * 1.4;
    const p1 = r(), p2 = r();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      y[i] += amp * Math.exp(-t / tau) * 0.5 * (Math.sin(TAU * (f * t + p1)) + Math.sin(TAU * ((f + det) * t + p2)));
    }
  }
  const strike = filt(noise(sec(0.006), r), 'hp', 5000);
  for (let i = 0; i < strike.length; i++) y[i] += strike[i] * 0.35 * (1 - i / strike.length) * bright;
  return fadeEdges(y, 1.2, 30);
}
/** Bumbo: seno com queda de afinação + estalo, saturado (harmônicos que o celular reproduz). */
function kick(vel = 1, len = 0.45) {
  const n = sec(len);
  const f = (t) => 44 + 128 * Math.exp(-t / 0.03);
  const y = osc(n, f);
  mulEnv(y, (t) => Math.exp(-t / 0.23) * Math.min(1, t / 0.0015));
  const click = filt(noise(sec(0.004)), 'hp', 2500);
  for (let i = 0; i < click.length; i++) y[i] += click[i] * 0.3 * (1 - i / click.length);
  for (let i = 0; i < n; i++) y[i] = (Math.tanh(y[i] * 1.8 * vel) / Math.tanh(1.8)) * vel;
  return fadeEdges(y, 0.5, 20);
}
/** Estrondo grave do impacto: sub descendo + oitava + saturação (presença em alto-falante pequeno). */
function boom(dur = 2.4, drive = 2) {
  const n = sec(dur);
  const f = (t) => 32 + 34 * Math.exp(-t / 0.22);
  const base = osc(n, f);
  const oct = osc(n, (t) => f(t) * 2);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.exp(-t / 0.75) * Math.min(1, t / 0.004);
    y[i] = Math.tanh((base[i] + 0.35 * oct[i]) * drive) * e;
  }
  return fadeEdges(y, 0.5, 60);
}
function whoosh(dur, f0, f1, q = 0.9, shape = 0.55) {
  const n = sec(dur);
  const y = filt(pink(n), 'bp', expGlide(f0, f1, dur), q);
  mulEnv(y, (t) => {
    const u = t / dur;
    return u < shape ? Math.pow(Math.sin((Math.PI / 2) * (u / shape)), 2) : Math.pow(Math.cos((Math.PI / 2) * ((u - shape) / (1 - shape))), 1.6);
  });
  return fadeEdges(y, 2, 20);
}
function riser(dur, f0 = 300, f1 = 7000) {
  const n = sec(dur);
  const air = filt(noise(n), 'hp', expGlide(f0, f1, dur), 0.8);
  const tone = osc(n, expGlide(220, 880, dur), 'saw');
  const toneF = filt(tone, 'lp', expGlide(600, 4000, dur), 0.9);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const trem = 0.75 + 0.25 * Math.sin(TAU * (4 * u + 10 * u * u) * dur);
    y[i] = (air[i] * 0.8 + toneF[i] * 0.18) * Math.pow(u, 2.2) * trem;
  }
  return fadeEdges(y, 5, 6);
}
function reverseCymbal(dur) {
  const n = sec(dur);
  const y = filt(filt(noise(n), 'hp', 3200, 0.7), 'lp', 12000);
  mulEnv(y, (t) => Math.pow(t / dur, 3.2));
  return fadeEdges(y, 5, 4);
}
function click(bright = 1) {
  const n = sec(0.05);
  const y = osc(n, 2300 * bright);
  mulEnv(y, (t) => Math.exp(-t / 0.012));
  const imp = filt(noise(sec(0.003)), 'bp', 3200, 1.5);
  for (let i = 0; i < imp.length; i++) y[i] += imp[i] * 2.2;
  return fadeEdges(y, 0.3, 5);
}
function tick(freq = 2800, len = 0.03) {
  const y = osc(sec(len), freq);
  mulEnv(y, (t) => Math.exp(-t / (len / 3)));
  return fadeEdges(y, 0.3, 3);
}
/** "Colar": um plop curto descendo + estalo. */
function pop() {
  const n = sec(0.12);
  const y = osc(n, (t) => 260 + 900 * Math.exp(-t / 0.018));
  mulEnv(y, (t) => Math.exp(-t / 0.045) * Math.min(1, t / 0.001));
  const c = filt(noise(sec(0.004)), 'hp', 3000);
  for (let i = 0; i < c.length; i++) y[i] += c[i] * 0.4;
  return fadeEdges(y, 0.3, 10);
}
function hat(len = 0.045, bright = 1) {
  const y = filt(noise(sec(len)), 'hp', 7200 * bright, 0.8);
  mulEnv(y, (t) => Math.exp(-t / (len / 3.5)));
  const ting = osc(sec(len), 9400 * bright);
  mulEnv(ting, (t) => Math.exp(-t / 0.006));
  for (let i = 0; i < y.length; i++) y[i] += ting[i] * 0.25;
  return fadeEdges(y, 0.3, 4);
}
function snap() {
  const n = sec(0.18);
  const y = filt(noise(n), 'bp', 1700, 0.9);
  mulEnv(y, (t) => (Math.exp(-t / 0.035) + 0.6 * Math.exp(-Math.max(0, t - 0.011) / 0.03) * (t > 0.011 ? 1 : 0)) * Math.min(1, t / 0.0008));
  const body = osc(n, (t) => 190 + 60 * Math.exp(-t / 0.02));
  mulEnv(body, (t) => Math.exp(-t / 0.03));
  for (let i = 0; i < n; i++) y[i] += body[i] * 0.3;
  return fadeEdges(y, 0.3, 10);
}
/** Carimbo: baque grave + corpo de papel + um "ping" metálico. */
function stampSound() {
  const n = sec(0.5);
  const thud = osc(n, (t) => 70 + 80 * Math.exp(-t / 0.025));
  mulEnv(thud, (t) => Math.exp(-t / 0.09) * Math.min(1, t / 0.001));
  const body = filt(noise(n), 'bp', 1100, 1.1);
  mulEnv(body, (t) => Math.exp(-t / 0.028));
  const ping = glass(2093, 0.5, 0.5, 9);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.tanh(thud[i] * 1.6) * 0.9 + body[i] * 0.55 + (ping[i] ?? 0) * 0.22;
  return fadeEdges(y, 0.3, 20);
}
function whomp(f0 = 190, f1 = 85, dur = 0.45) {
  const y = osc(sec(dur), expGlide(f0, f1, dur * 0.7));
  mulEnv(y, (t) => Math.sin(Math.PI * clamp(t / dur)) ** 1.2 * Math.exp(-t / (dur * 0.6)));
  return fadeEdges(y, 2, 20);
}
/** Pad: dentes de serra desafinados, filtro passa-baixa com LFO lento, ataque e soltura longos. */
function pad(notes, dur, cutoff = 1100, attack = 0.8, release = 0.8, seed = 3) {
  const r = mulberry32(seed);
  const n = sec(dur + release);
  const y = new Float32Array(n);
  for (const m of notes) {
    for (const det of [-0.06, 0, 0.07]) {
      const f = hz(m) * Math.pow(2, det / 12);
      const v = osc(n, f, 'saw', r());
      for (let i = 0; i < n; i++) y[i] += v[i] / (notes.length * 3);
    }
  }
  const lfo = (t) => cutoff * (0.8 + 0.2 * Math.sin(TAU * 0.22 * t));
  const out = filt(filt(y, 'lp', lfo, 0.6), 'hp', 110);
  mulEnv(out, (t) => Math.min(1, t / attack) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1));
  return out;
}
/** Baixo "pluck" com harmônicos (o fundamental some no celular; os harmônicos seguram a nota). */
function bassPluck(freq, len = 0.22) {
  const n = sec(len);
  const saw = osc(n, freq, 'saw');
  const sin = osc(n, freq);
  const y = filt(saw, 'lp', (t) => 180 + 900 * Math.exp(-t / 0.05), 1.1);
  for (let i = 0; i < n; i++) y[i] = Math.tanh((y[i] * 0.8 + sin[i] * 0.7) * 1.5) * Math.exp(-(i / SR) / (len * 0.55));
  return fadeEdges(y, 1, 15);
}

/* ------------------------------------------------------------------ partitura (tempos da linha do tempo) */

const beat = 60 / TL.bpm;

// ── Ato 1: o link ────────────────────────────────────────────────────────────
put(SFX, TL.paste[0] + 0.005, pop(), -9, 0, 0.15);
{
  // Drone do hook: quinta grave (lá-mi) filtrada, crescendo até o impacto.
  const d = TL.impact + 0.05;
  const n = sec(d);
  const a = osc(n, hz(NOTE.A2), 'saw'), e = osc(n, hz(NOTE.E3) * 1.003, 'saw');
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (a[i] + 0.7 * e[i]) * 0.5;
  const out = filt(y, 'lp', (u) => 260 + 900 * Math.pow(u / d, 2), 0.9);
  mulEnv(out, (u) => (0.35 + 0.65 * Math.pow(u / d, 1.6)) * Math.min(1, u / 0.02));
  put(MUSIC, 0, fadeEdges(out, 5, 30), -12, 0, 0.3);
}
// Varredura de luz: grãos de vidro agudos andando da esquerda para a direita.
{
  const r = mulberry32(11);
  const scale = [NOTE.A6, NOTE.C6 + 12, NOTE.E6, NOTE.G6, NOTE.E7, NOTE.A6];
  for (let k = 0; k < 18; k++) {
    const u = k / 17;
    const t = TL.paste[0] + 0.01 + u * (TL.paste[1] - 0.02) + (r() - 0.5) * 0.008;
    put(SFX, t, glass(hz(scale[k % scale.length]), 0.35, 0.6, 20 + k), -20 + r() * 3, lerp(-0.7, 0.7, u), 0.35);
  }
}
put(SFX, TL.zoomOut[0] - 0.02, whoosh(0.5, 2600, 420, 0.8, 0.35), -5, (t) => lerp(0.3, -0.1, t / 0.5), 0.2);
put(SFX, 0.42, tick(1760, 0.05), -18, 0.1, 0.2); // o botão acende
put(SFX, TL.tap, click(1), -11, 0, 0.15);
put(SFX, TL.tap, whomp(160, 90, 0.25), -20, 0, 0);
// Redemoinho: ruído rosa girando no estéreo, filtro subindo, tremolo acelerando + um tom sugado para cima.
{
  const [a, b] = TL.dissolve;
  const dur = b - a + 0.1;
  const n = sec(dur);
  const swirl = filt(pink(n), 'bp', expGlide(380, 2600, dur), 1.3);
  const tone = filt(osc(n, expGlide(hz(NOTE.A3), hz(NOTE.A5), dur), 'saw'), 'lp', 2400);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const trem = 0.65 + 0.35 * Math.sin(TAU * (5 * u + 16 * u * u) * dur);
    y[i] = (swirl[i] * 1.0 + tone[i] * 0.09) * (0.3 + 0.7 * Math.pow(u, 1.3)) * trem;
  }
  fadeEdges(y, 20, 12);
  put(SFX, a, y, -2, (t) => 0.6 * Math.sin(TAU * (0.9 * t + 1.6 * t * t)), 0.3);
}
// As sete etapas da análise: ticks subindo de afinação.
for (let k = 0; k < 7; k++) put(SFX, TL.steps[0] + k * ((TL.steps[1] - TL.steps[0]) / 7), tick(1900 + k * 180, 0.025), -18, 0, 0.2);
// Linha de varredura: um sopro descendo (acompanha a linha que desce).
{
  const d = TL.scan[1] - TL.scan[0];
  const s = filt(filt(noise(sec(d)), 'bp', expGlide(6500, 1600, d), 2.2), 'hp', 900);
  mulEnv(s, (u) => Math.pow(Math.sin(Math.PI * clamp(u / d)), 1.2));
  put(SFX, TL.scan[0], fadeEdges(s, 5, 10), -19, 0, 0.3);
}
put(SFX, TL.impact - 0.42, reverseCymbal(0.42), -12, 0, 0.25);
put(SFX, TL.impact - 0.5, riser(0.5, 400, 8000), -15, 0, 0.2);

// ── Impacto: o frasco se materializa ────────────────────────────────────────
put(SFX, TL.impact, boom(2.6, 2.2), -6, 0, 0.1);
{
  const burst = filt(noise(sec(1.2)), 'bp', expGlide(3600, 500, 0.9), 0.7);
  mulEnv(burst, (t) => Math.exp(-t / 0.22) * Math.min(1, t / 0.002));
  put(SFX, TL.impact, burst, -12, 0, 0.35);
  const crash = filt(noise(sec(2.2)), 'hp', 2400, 0.6);
  mulEnv(crash, (t) => Math.exp(-t / 0.55) * Math.min(1, t / 0.003));
  put(SFX, TL.impact, crash, -24, 0, 0.5);
}
for (const [m, pan, g] of [[NOTE.A3, -0.2, -14], [NOTE.E4, 0.25, -16], [NOTE.B4, -0.35, -18], [NOTE.C5, 0.35, -18], [NOTE.E5, 0, -19], [NOTE.A5, 0.1, -22]]) {
  put(SFX, TL.impact + 0.004, glass(hz(m), 4.2, 0.9, m), g, pan, 0.45);
}
// Brilho que cai (as faíscas se dispersando).
{
  const r = mulberry32(21);
  for (let k = 0; k < 26; k++) {
    const t = TL.impact + 0.05 + Math.pow(r(), 1.7) * 1.3;
    const m = [NOTE.A5, NOTE.C6, NOTE.E6, NOTE.G6, NOTE.A6][Math.floor(r() * 5)];
    put(SFX, t, glass(hz(m), 0.6, 0.5, 40 + k), -34 + r() * 4, r() * 1.6 - 0.8, 0.5);
  }
}

// ── Ato 2: o perfume completo ───────────────────────────────────────────────
put(MUSIC, TL.impact + 0.05, pad([NOTE.A2, NOTE.E3, NOTE.C4, NOTE.G4, NOTE.B4], TL.act3 - TL.impact - 0.05, 1000, 1.0, 0.6, 7), -21, 0, 0.35);
for (const t of [2.0, 3.0, 4.0]) put(MUSIC, t, kick(0.55, 0.5), -19, 0, 0.05); // batimento de meio tempo
put(SFX, TL.heroName - 0.08, whoosh(0.45, 900, 5200, 1.1, 0.55), -24, 0, 0.2);
put(SFX, TL.heroName + 0.2, tick(3100, 0.03), -30, 0, 0.3);
put(SFX, TL.heroMeta, tick(2600, 0.03), -31, 0, 0.3);
const TIER_NOTES = [NOTE.A4, NOTE.C5, NOTE.E5];
TL.tiers.forEach((t, i) => {
  // Fio de luz: um "zip" de ar abrindo do centro para as bordas, e a nota de vidro da camada.
  const zip = filt(noise(sec(0.55)), 'bp', expGlide(1800, 7000, 0.55), 1.8);
  mulEnv(zip, (u) => Math.pow(Math.sin(Math.PI * clamp(u / 0.55)), 1.5) * Math.exp(-u / 0.35));
  put(SFX, t, zip, -25, 0, 0.3);
  put(SFX, t + 0.06, glass(hz(TIER_NOTES[i]), 2.6, 0.8, 70 + i), -15, [-0.3, 0.3, 0][i], 0.45);
});
put(SFX, TL.act2Out[0] - 0.05, riser(TL.act3 - TL.act2Out[0] + 0.05, 250, 6000), -13, 0, 0.2);
put(SFX, TL.act3 - 0.2, reverseCymbal(0.2), -16, 0, 0.2);
put(SFX, TL.act2Out[0] + 0.12, whoosh(0.55, 3000, 350, 0.9, 0.7), -13, (t) => lerp(-0.2, 0.2, t / 0.55), 0.2);

// ── Ato 3: o universo (a batida entra) ──────────────────────────────────────
const grooveEnd = TL.outro[0];
const kicks = [];
for (let t = TL.act3; t < grooveEnd - 0.01; t += beat) kicks.push(t);
const quiet = (t) => (t >= TL.land ? (t >= TL.comprei ? 0.72 : 0.6) : 1); // depois do pouso a batida recua
for (const t of kicks) put(MUSIC, t, kick(t === TL.land ? 1.25 : 1, t === TL.land ? 0.7 : 0.45), -9 - (1 - quiet(t)) * 8, 0, 0.04);
// Hats nos contratempos, dobrando para semicolcheias na aceleração.
for (let t = TL.act3 + beat / 2; t < grooveEnd - 0.01; t += beat / 2) {
  if (Math.abs(((t - TL.act3) / beat) % 1) < 0.01) continue;
  put(MUSIC, t, hat(0.05), -24 - (1 - quiet(t)) * 10, 0.25, 0.1);
}
for (let t = TL.snaps[4]; t < TL.snaps[11]; t += beat / 4) put(MUSIC, t + beat / 8, hat(0.03, 1.1), -30, -0.25, 0.1);
for (let t = TL.act3 + beat; t < grooveEnd - 0.01; t += beat * 2) put(MUSIC, t, snap(), -19 - (1 - quiet(t)) * 8, 0, 0.25);
// Harmonia da montagem: Am9 → Fmaj9 → Cmaj7 → Gadd9 → Am9 (baixo em colcheias + pad).
const CHORDS = [
  [TL.act3, TL.snaps[1], NOTE.A1, [NOTE.A2, NOTE.E3, NOTE.C4, NOTE.G4, NOTE.B4]],
  [TL.snaps[1], TL.snaps[3], NOTE.F1, [NOTE.F2, NOTE.C3, NOTE.A3, NOTE.E4, NOTE.G4]],
  [TL.snaps[3], TL.snaps[7], NOTE.C2, [NOTE.C3, NOTE.G3, NOTE.E4, NOTE.B4]],
  [TL.snaps[7], TL.land, NOTE.G1, [NOTE.G2, NOTE.D3, NOTE.B3, NOTE.A4]],
  [TL.land, grooveEnd, NOTE.A1, [NOTE.A2, NOTE.E3, NOTE.C4, NOTE.G4, NOTE.B4]],
];
CHORDS.forEach(([a, b, root, voicing], k) => {
  put(MUSIC, a, pad(voicing, b - a, k === 4 ? 800 : 1300, 0.12, 0.35, 30 + k), -23, 0, 0.3);
  for (let t = a; t < b - 0.01; t += beat / 2) put(MUSIC, t, bassPluck(hz(root + 12)), -15 - (1 - quiet(t)) * 8, 0, 0);
});
// Cada frasco que entra em foco toca uma nota de vidro (a melodia da montagem).
const SNAP_NOTES = [NOTE.A4, NOTE.C5, NOTE.E5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6, NOTE.E6, NOTE.D6, NOTE.C6, NOTE.A5];
TL.snaps.slice(0, 11).forEach((t, i) => {
  const fast = i >= 4;
  put(SFX, t - 0.03, whoosh(fast ? 0.2 : 0.34, 700, 3800, 1, 0.45), fast ? -27 : -22, (u) => lerp(0.55, -0.1, u / 0.3), 0.15);
  put(SFX, t + 0.035, glass(hz(SNAP_NOTES[i]), fast ? 1.4 : 2.2, 0.85, 90 + i), fast ? -17 : -14, lerp(0.35, -0.35, i / 10), 0.4);
});
// Rebobinada até o primeiro frasco: notas de vidro ao contrário crescendo até o pouso + sopro descendo.
{
  const t0 = TL.snaps[11];
  const len = TL.land - t0;
  put(SFX, t0, whoosh(len + 0.05, 5200, 380, 0.8, 0.7), -15, (u) => lerp(-0.6, 0.6, u / len), 0.25);
  for (const [m, g] of [[NOTE.A5, -20], [NOTE.E5, -21], [NOTE.C5, -22]]) {
    const rev = glass(hz(m), len, 0.8, m + 300).reverse();
    put(SFX, t0, fadeEdges(rev, 20, 2), g, 0, 0.3);
  }
  put(SFX, TL.land, boom(1.0, 1.6), -8, 0, 0.1);
  put(SFX, TL.land + 0.02, glass(hz(NOTE.A3), 2.4, 0.7, 333), -15, 0, 0.45);
}

// ── Ato 4: "Comprei" ────────────────────────────────────────────────────────
put(SFX, TL.comprei, click(1.15), -13, 0, 0.15);
put(SFX, TL.comprei + 0.02, glass(hz(NOTE.E5), 0.9, 0.7, 401), -21, 0, 0.3);
put(SFX, TL.comprei + 0.1, glass(hz(NOTE.A5), 1.2, 0.7, 402), -20, 0, 0.35);
// O frasco sobe e acende: arpejo de vidro subindo + sopro para cima.
[NOTE.A5, NOTE.C6, NOTE.E6, NOTE.A6].forEach((m, k) => put(SFX, TL.depart[0] + 0.08 + k * 0.09, glass(hz(m), 1.2, 0.7, 410 + k), -22 - k, -0.1 + k * 0.08, 0.45));
put(SFX, TL.depart[0], whoosh(TL.depart[1] - TL.depart[0] + 0.1, 500, 6500, 1.1, 0.75), -19, 0, 0.3);
put(SFX, TL.depart[0] + 0.02, whomp(180, 90, 0.5), -20, 0, 0.1);
{
  // Faíscas indo para a aba Coleção.
  const r = mulberry32(55);
  for (let k = 0; k < 16; k++) put(SFX, TL.depart[0] + 0.24 + r() * 0.42, tick(5200 + r() * 3200, 0.02), -32, r() * 0.6 - 0.3, 0.4);
}
put(SFX, TL.tabPulse, whomp(230, 120, 0.3), -21, -0.05, 0.1);
put(SFX, TL.tabPulse, glass(hz(NOTE.E6), 0.9, 0.6, 430), -22, -0.05, 0.4);
put(SFX, TL.tabTap, click(0.95), -18, -0.05, 0.1);
put(SFX, TL.arrive - 0.2, fadeEdges(glass(hz(NOTE.A5), 0.3, 0.6, 440).reverse(), 10, 2), -22, 0, 0.3);
put(SFX, TL.arrive, whomp(200, 95, 0.55), -20, 0, 0.15);
put(SFX, TL.arrive + 0.02, glass(hz(NOTE.C5), 1.6, 0.6, 441), -22, 0, 0.4);
put(SFX, TL.stamp, stampSound(), -8, 0, 0.18);
put(SFX, TL.stamp, kick(0.8, 0.3), -16, 0, 0);

// ── Ato 5: marca ────────────────────────────────────────────────────────────
{
  const len = TL.final - TL.outro[0];
  put(SFX, TL.outro[0], reverseCymbal(len), -14, 0, 0.3);
  put(SFX, TL.outro[0], riser(len, 350, 9000), -18, 0, 0.25);
  put(SFX, TL.outro[0] + 0.1, whoosh(len, 300, 4200, 0.8, 0.85), -16, 0, 0.2);
  // Acorde ao contrário crescendo até o acorde final.
  for (const m of [NOTE.A4, NOTE.C5, NOTE.E5]) put(SFX, TL.outro[0], fadeEdges(glass(hz(m), len, 0.7, m + 500).reverse(), 30, 2), -22, 0, 0.3);
}
put(SFX, TL.final, boom(2.8, 2.4), -6, 0, 0.12);
{
  const burst = filt(noise(sec(1.4)), 'bp', expGlide(3000, 400, 1.0), 0.7);
  mulEnv(burst, (t) => Math.exp(-t / 0.3) * Math.min(1, t / 0.002));
  put(SFX, TL.final, burst, -14, 0, 0.4);
}
for (const [m, pan, g] of [[NOTE.A2, 0, -15], [NOTE.E4, -0.3, -16], [NOTE.B4, 0.3, -17], [NOTE.C5, -0.2, -17], [NOTE.E5, 0.2, -18], [NOTE.A5, 0, -20]]) {
  put(SFX, TL.final + 0.004, glass(hz(m), 5.0, 0.9, m + 600), g, pan, 0.5);
}
put(MUSIC, TL.final, pad([NOTE.A2, NOTE.E3, NOTE.C4, NOTE.G4, NOTE.B4, NOTE.E5], TL.duration - TL.final - 0.9, 1400, 0.3, 1.2, 77), -20, 0, 0.45);
// A tampa do glifo percorrendo as cores: arpejo descendente que resolve no lá.
{
  const step = (TL.capCycle[1] - TL.capCycle[0]) / TL.capColors.length;
  [NOTE.E6, NOTE.D6, NOTE.C6, NOTE.A5, NOTE.G5, NOTE.A5].forEach((m, k) => put(SFX, TL.capCycle[0] + k * step, glass(hz(m), 1.6, 0.8, 700 + k), -18 - k * 0.5, lerp(0.3, -0.3, k / 5), 0.45));
}
put(SFX, TL.wordmark - 0.05, whoosh(0.9, 600, 3200, 0.9, 0.5), -27, 0, 0.3);
put(SFX, TL.tagline, glass(hz(NOTE.E6), 1.8, 0.5, 800), -28, 0.2, 0.5);

/* ------------------------------------------------------------------ reverb (espaço) e master */

/** Freeverb (Jezar): 8 pentes + 4 passa-tudo por canal, espalhamento estéreo. Cauda longa, escura. */
function freeverb(inL, inR, { room = 0.88, damp = 0.3, predelay = 0.025 } = {}) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const make = (spread) => ({
    c: combs.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0, store: 0 })),
    a: alls.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0 })),
  });
  const chans = [make(0), make(23)];
  const pd = sec(predelay);
  const outL = new Float32Array(N), outR = new Float32Array(N);
  [inL, inR].forEach((input, ch) => {
    const st = chans[ch];
    const out = ch ? outR : outL;
    for (let n = 0; n < N; n++) {
      const x = (n - pd >= 0 ? input[n - pd] : 0) * 0.015;
      let acc = 0;
      for (const c of st.c) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of st.a) {
        const b = a.buf[a.i];
        a.buf[a.i] = acc + b * 0.5;
        acc = b - acc;
        a.i = (a.i + 1) % a.buf.length;
      }
      out[n] = acc;
    }
  });
  return { L: outL, R: outR };
}

const WET = db(-1.5);
const wetM = freeverb(SEND_M.L, SEND_M.R);
const wetS = freeverb(SEND_S.L, SEND_S.R);
for (let i = 0; i < N; i++) {
  MUSIC.L[i] += wetM.L[i] * WET;
  MUSIC.R[i] += wetM.R[i] * WET;
  SFX.L[i] += wetS.L[i] * WET;
  SFX.R[i] += wetS.R[i] * WET;
}
const master = bus();
for (let i = 0; i < N; i++) {
  master.L[i] = MUSIC.L[i] + SFX.L[i];
  master.R[i] = MUSIC.R[i] + SFX.R[i];
}
// Corte de subgrave inútil (< 28 Hz) e um compressor de barramento suave (cola a mixagem).
master.L = filt(master.L, 'hp', 28, 0.6);
master.R = filt(master.R, 'hp', 28, 0.6);
function glue(L, R, thresholdDb = -16, ratio = 2.2, attack = 0.008, release = 0.18) {
  const th = db(thresholdDb);
  const ka = Math.exp(-1 / (attack * SR)), kr = Math.exp(-1 / (release * SR));
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    env = x > env ? ka * env + (1 - ka) * x : kr * env + (1 - kr) * x;
    let g = 1;
    if (env > th) g = Math.pow(env / th, 1 / ratio - 1);
    L[i] *= g;
    R[i] *= g;
  }
}
glue(master.L, master.R);
// Fade final de segurança (o reverb termina dentro dos 15 s).
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const f = t > TL.duration - 0.35 ? Math.max(0, (TL.duration - 0.02 - t) / 0.33) : 1;
  master.L[i] *= f;
  master.R[i] *= f;
}

/* ------------------------------------------------------------------ arquivos */

function wav(file, L, R, gain = 1) {
  const bytes = 4;
  const buf = Buffer.alloc(44 + N * 2 * bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 2 * bytes, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2 * bytes, 28);
  buf.writeUInt16LE(2 * bytes, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 2 * bytes, 40);
  let o = 44;
  for (let i = 0; i < N; i++) {
    buf.writeFloatLE(L[i] * gain, o);
    buf.writeFloatLE(R[i] * gain, o + 4);
    o += 8;
  }
  writeFileSync(file, buf);
}
const OUT = path.join(AD, 'audio', 'out');
mkdirSync(OUT, { recursive: true });
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(master.L[i]), Math.abs(master.R[i]));
const norm = 0.5 / peak; // folga para a normalização por loudness no ffmpeg
wav(path.join(OUT, 'mix-pre-master.wav'), master.L, master.R, norm);
// Stems (mesma escala da mixagem, sem o compressor do barramento): música e efeitos, cada um com o seu reverb.
wav(path.join(OUT, 'musica.wav'), MUSIC.L, MUSIC.R, norm);
wav(path.join(OUT, 'efeitos.wav'), SFX.L, SFX.R, norm);
console.log(`pronto: ${TL.duration} s · pico antes da normalização ${(20 * Math.log10(peak)).toFixed(1)} dBFS · arquivos em audio/out`);
