/**
 * A galáxia de fundo, em WebGL2 puro (sem three.js: ~10 KB em vez de ~600 KB no caminho crítico).
 *
 * Duas passadas por quadro:
 *  1. um triângulo de tela cheia: preto quase puro, nebulosa de ruído fractal bem fraca atrás do frasco,
 *     halo com a cor do perfume e vinheta;
 *  2. pontos: estrelas em três profundidades (paralaxe com o ponteiro e com o carrossel), ~7% delas com a cor
 *     do perfume, e um punhado de "poeira" desfocada subindo devagar.
 * A cor entra como uniforme e é dosada pela saturação: frasco neutro = galáxia prateada.
 * Qualidade se adapta: menos estrelas e resolução no celular, e cai mais um degrau se o quadro passar de ~24 ms.
 */

export type GalaxyQuality = 'high' | 'medium' | 'low';

const QUALITY: Record<GalaxyQuality, { stars: number; dust: number; dpr: number; octaves: number }> = {
  high: { stars: 1700, dust: 44, dpr: 1.5, octaves: 5 },
  medium: { stars: 950, dust: 28, dpr: 1.25, octaves: 4 },
  low: { stars: 480, dust: 14, dpr: 1, octaves: 3 },
};

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BACKGROUND_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uAccent;
uniform float uSat;
uniform vec2 uFocus;
uniform vec2 uPointer;
uniform int uOctaves;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { if (i >= uOctaves) break; v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}

void main(){
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  vec2 f = (uFocus - 0.5) * vec2(aspect, 1.0);

  vec3 col = vec3(0.014, 0.014, 0.019);
  col += vec3(0.010, 0.011, 0.016) * smoothstep(1.3, -0.1, length(p - vec2(0.0, 0.62)));

  float t = uTime * 0.011;
  vec2 q = p * 1.3 + uPointer * 0.02;
  vec2 w = vec2(fbm(q + vec2(t, -t * 0.6)), fbm(q + vec2(5.2, 1.3) - t * 0.4));
  float n = fbm(q + 1.8 * w + vec2(-t * 0.3, t * 0.2));

  float d = length((p - f) * vec2(0.78, 1.05));
  float focusMask = smoothstep(0.9, 0.0, d);
  // Faixa diagonal, na mesma inclinação do carrossel (o "rastro" da fila de frascos).
  float band = smoothstep(0.5, 0.0, abs((p.y - f.y) + (p.x - f.x) * 0.32)) * smoothstep(1.6, 0.2, abs(p.x - f.x));
  float neb = smoothstep(0.42, 0.95, n) * (focusMask * 0.95 + band * 0.22);
  // A cor fica perto do frasco: nas bordas da tela o espaço volta ao preto neutro.
  float keep = smoothstep(1.25, 0.35, length((p - f) * vec2(0.85, 1.0)));

  vec3 neutralNeb = vec3(0.055, 0.058, 0.068);
  vec3 tint = mix(neutralNeb, uAccent * 0.3, (0.3 + 0.7 * uSat) * keep);
  col += tint * neb * 0.6;
  col += uAccent * 0.075 * smoothstep(0.75, 0.0, d) * (0.3 + 0.7 * uSat);

  col *= smoothstep(1.45, 0.3, length(p * vec2(0.82, 1.0)));
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

const STARS_VS = `#version 300 es
in vec3 aPos;
in float aSize;
in float aSeed;
in float aKind;
uniform float uTime;
uniform vec2 uPointer;
uniform float uDpr;
uniform float uScroll;
uniform float uAspect;
out float vAlpha;
out float vKind;
void main(){
  float depth = aPos.z;
  vec2 uv = aPos.xy;
  uv.x += uTime * (0.0005 + depth * 0.0014);
  if (aKind > 1.5) uv.y += uTime * 0.0035 * (0.4 + aSeed);
  uv += uPointer * vec2(1.0, -1.0) * (0.003 + depth * 0.016);
  uv.x -= uScroll * (0.004 + depth * 0.022) / uAspect;
  uv = fract(uv);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  float tw = 0.62 + 0.38 * sin(uTime * (0.5 + aSeed * 1.6) + aSeed * 40.0);
  vAlpha = aKind > 1.5 ? (0.035 + 0.03 * tw) : (0.22 + 0.78 * depth) * tw;
  gl_PointSize = aSize * uDpr * (aKind > 1.5 ? 1.0 : (0.55 + depth * 0.8));
  vKind = aKind;
}`;

const STARS_FS = `#version 300 es
precision mediump float;
in float vAlpha;
in float vKind;
out vec4 o;
uniform vec3 uAccent;
uniform float uSat;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  float a = vKind > 1.5 ? smoothstep(0.25, 0.0, r2) : exp(-r2 * 30.0);
  vec3 white = vec3(0.85, 0.87, 0.93);
  float tintAmount = vKind > 1.5 ? 0.9 : (vKind > 0.5 ? 1.0 : 0.0);
  vec3 col = mix(white, uAccent, tintAmount * (0.25 + 0.75 * uSat));
  float alpha = a * vAlpha;
  o = vec4(col * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/** Gerador determinístico: a mesma galáxia a cada visita (nada de estrelas "pulando" ao recarregar). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStars(count: number, dust: number) {
  const rand = mulberry32(20260926);
  const total = count + dust;
  const data = new Float32Array(total * 6);
  for (let i = 0; i < total; i++) {
    const isDust = i >= count;
    let x = rand();
    let y = rand();
    // 35% das estrelas se concentram numa faixa diagonal suave (uma "via láctea" discreta).
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

export class Galaxy {
  private gl: WebGL2RenderingContext;
  private bg: WebGLProgram;
  private stars: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private starCount = 0;
  private quality: GalaxyQuality;
  private raf = 0;
  private start = performance.now();
  private frozenTime = 40;
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  private accentRgb: [number, number, number] = [0.8, 0.81, 0.84];
  private sat = 0;
  private scroll = 0;
  private focus = { x: 0.5, y: 0.55 };
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private running = false;
  private dirty = true;
  private resizeObserver: ResizeObserver;

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2'));
    } catch {
      return false;
    }
  }

  constructor(
    private canvas: HTMLCanvasElement,
    options: { quality: GalaxyQuality; reducedMotion: boolean },
    private onFailure: () => void = () => {},
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power', depth: false, stencil: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.bg = program(gl, FULLSCREEN_VS, BACKGROUND_FS);
    this.stars = program(gl, STARS_VS, STARS_FS);
    this.vao = gl.createVertexArray()!;
    this.upload();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    canvas.addEventListener('webglcontextlost', this.onLost);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  reducedMotion: boolean;

  private onLost = (event: Event) => {
    event.preventDefault();
    this.stop();
    this.onFailure();
  };

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.running) this.loop();
  };

  private upload() {
    const gl = this.gl;
    const q = QUALITY[this.quality];
    const data = buildStars(q.stars, q.dust);
    this.starCount = q.stars + q.dust;
    gl.bindVertexArray(this.vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 6 * 4;
    const attrs: [string, number, number][] = [
      ['aPos', 3, 0],
      ['aSize', 1, 3],
      ['aSeed', 1, 4],
      ['aKind', 1, 5],
    ];
    for (const [name, size, offset] of attrs) {
      const loc = gl.getAttribLocation(this.stars, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    }
    gl.bindVertexArray(null);
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dirty = true;
    if (!this.raf && this.running) this.loop();
  }

  setAccent(rgb: { r: number; g: number; b: number }, saturation: number) {
    this.accentRgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    this.sat = saturation;
    this.dirty = true;
    if (this.reducedMotion && this.running && !this.raf) this.loop();
  }

  setPointer(x: number, y: number) {
    if (this.reducedMotion) return;
    this.pointer.tx = x;
    this.pointer.ty = y;
  }

  /** Posição contínua do carrossel: as estrelas deslizam um pouco quando a fila anda. */
  setScroll(position: number) {
    if (this.reducedMotion) return;
    this.scroll = position;
    this.dirty = true;
  }

  setFocus(x: number, y: number) {
    this.focus = { x, y };
    this.dirty = true;
  }

  play() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (!this.running || document.hidden) return;
      this.render(now);
      // Com movimento reduzido, a galáxia é um quadro parado: só redesenha quando algo muda.
      if (!this.reducedMotion || this.dirty) this.loop();
    });
  };

  private adapt(now: number) {
    if (this.lastFrame) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length >= 90) {
        const sorted = [...this.frameTimes].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        this.frameTimes = [];
        if (median > 24 && this.quality !== 'low') {
          this.quality = this.quality === 'high' ? 'medium' : 'low';
          this.upload();
          this.resize();
        }
      }
    }
    this.lastFrame = now;
  }

  private render(now: number) {
    const gl = this.gl;
    if (!this.reducedMotion) this.adapt(now);
    const time = this.reducedMotion ? this.frozenTime : (now - this.start) / 1000 + this.frozenTime;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.04;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.04;
    this.dirty = false;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
    gl.uniform2f(u(this.bg, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(u(this.bg, 'uTime'), time);
    gl.uniform3f(u(this.bg, 'uAccent'), ...this.accentRgb);
    gl.uniform1f(u(this.bg, 'uSat'), this.sat);
    gl.uniform2f(u(this.bg, 'uFocus'), this.focus.x, 1 - this.focus.y);
    gl.uniform2f(u(this.bg, 'uPointer'), this.pointer.x, this.pointer.y);
    gl.uniform1i(u(this.bg, 'uOctaves'), QUALITY[this.quality].octaves);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.stars);
    gl.uniform1f(u(this.stars, 'uTime'), time);
    gl.uniform2f(u(this.stars, 'uPointer'), this.pointer.x, this.pointer.y);
    gl.uniform1f(u(this.stars, 'uDpr'), Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr));
    gl.uniform1f(u(this.stars, 'uScroll'), this.scroll);
    gl.uniform1f(u(this.stars, 'uAspect'), this.canvas.width / this.canvas.height);
    gl.uniform3f(u(this.stars, 'uAccent'), ...this.accentRgb);
    gl.uniform1f(u(this.stars, 'uSat'), this.sat);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.starCount);
    gl.bindVertexArray(null);
  }
}
