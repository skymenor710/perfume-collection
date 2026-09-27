import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Oklab } from '../core/color';
import { effectiveColor, type Perfume } from '../core/perfume';
import { accent, accentFor } from '../design/accent';
import { prefersReducedMotion, scene } from '../gl/scene';
import { Bottle } from './Bottle';

/**
 * O palco de seleção. A fila é uma posição contínua (`pos`, em "frascos"): arrastar, deslizar o dedo,
 * rolar o trackpad ou apertar ← → só move essa posição; uma mola a leva ao frasco inteiro mais próximo.
 * Cada quadro, todo frasco se posiciona pela distância `d = índice − pos`: o selecionado no centro, os
 * anteriores subindo à esquerda, os próximos descendo à direita, menores e mais escuros — e a cor da
 * atmosfera é a mistura OKLab dos dois frascos mais próximos de `pos`. Nada disso passa pelo React:
 * as transformações são escritas direto no DOM, e o React só re-renderiza quando o frasco em foco muda.
 */

interface Props {
  perfumes: Perfume[];
  index: number;
  onIndexChange: (index: number) => void;
  inspect: boolean;
  onInspectChange: (value: boolean) => void;
  departingId: string | null;
  arrivingId: string | null;
  label: string;
  /** Some da vista quando um diálogo está aberto (o teclado passa a ser dele). */
  paused: boolean;
  /** Contador de pedidos de navegação vindos de fora: cada incremento leva o palco até `index`. */
  request: number;
}

interface Geometry {
  w: number;
  h: number;
  mobile: boolean;
  spacingX: number;
  spacingY: number;
}

const STIFFNESS = 180;
const DAMPING = 25;

export function Stage({ perfumes, index, onIndexChange, inspect, onInspectChange, departingId, arrivingId, label, paused, request }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const pos = useRef(index);
  const vel = useRef(0);
  const target = useRef(index);
  const emitted = useRef(index);
  const geometry = useRef<Geometry>({ w: 1, h: 1, mobile: false, spacingX: 300, spacingY: 50 });
  const drag = useRef<{ id: number; x: number; y: number; startPos: number; moved: boolean; lastX: number; lastT: number; v: number; slot: number | null } | null>(null);
  const pinch = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
  const tilt = useRef({ x: 0, y: 0, tx: 0, ty: 0, zoom: 1, tzoom: 1, ix: 0, iy: 0 });
  const inspectAmount = useRef(0);
  const inspectRef = useRef(inspect);
  const wheelSnap = useRef<number | null>(null);
  const colors = useRef<Oklab[]>([]);
  const reduced = useRef(prefersReducedMotion());
  const lastAccentPos = useRef(Number.NaN);
  const [focusIndex, setFocusIndex] = useState(index);

  const count = perfumes.length;
  const clampIndex = useCallback((i: number) => Math.max(0, Math.min(count - 1, i)), [count]);

  colors.current = useMemo(() => perfumes.map((p) => accentFor(effectiveColor(p))), [perfumes]);
  inspectRef.current = inspect;

  // O `index` que volta do App é, na maior parte do tempo, o eco do próprio carrossel — e pode chegar atrasado
  // (um re-render no meio da animação traz o frasco de dois quadros atrás). Por isso o alvo só muda por
  // pedido explícito (`request` incrementado pelo App: setas, perfume novo, "Ver") ou quando a lista muda.
  const indexRef = useRef(index);
  indexRef.current = index;
  const syncTo = useCallback((i: number, snap: boolean) => {
    target.current = i;
    emitted.current = i;
    if (snap) {
      pos.current = i;
      vel.current = 0;
    }
    lastAccentPos.current = Number.NaN;
    setFocusIndex(i);
  }, []);

  useEffect(() => {
    if (request > 0) syncTo(indexRef.current, false);
  }, [request, syncTo]);

  // Outra lista (outro universo, filtro, remoção, chegada): o palco se reposiciona no frasco escolhido, sem viagem.
  const idsKey = perfumes.map((p) => p.id).join('|');
  const lastIds = useRef(idsKey);
  useEffect(() => {
    if (lastIds.current === idsKey) return;
    lastIds.current = idsKey;
    if (drag.current?.moved) return;
    syncTo(Math.max(0, Math.min(perfumes.length - 1, indexRef.current)), true);
  }, [idsKey, perfumes.length, syncTo]);

  const emit = useCallback(
    (i: number) => {
      if (i === emitted.current) return;
      emitted.current = i;
      setFocusIndex(i);
      onIndexChange(i);
    },
    [onIndexChange],
  );

  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const mobile = w < 720;
    geometry.current = {
      w,
      h,
      mobile,
      spacingX: mobile ? w * 0.46 : Math.min(w * 0.235, 400),
      spacingY: mobile ? h * 0.075 : h * 0.085,
    };
    const rect = el.getBoundingClientRect();
    const cy = parseFloat(getComputedStyle(el).getPropertyValue('--stage-cy')) || 46;
    scene.focus((rect.left + w / 2) / window.innerWidth, (rect.top + (h * cy) / 100) / window.innerHeight);
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [measure]);

  // O laço de animação: mola, posição de cada frasco, cor da atmosfera, paralaxe das estrelas.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastIa = 0;
    const start = last;
    const frame = (now: number) => {
      // Tempo real (até 1/4 s), integrado em passos de 1/120 s: se o navegador pular quadros,
      // a mola chega na mesma hora — não fica em câmera lenta nem explode.
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const g = geometry.current;
      const d0 = drag.current;
      if (!(d0 && d0.moved) && wheelSnap.current === null) {
        if (reduced.current) {
          pos.current = target.current;
          vel.current = 0;
        } else {
          const steps = Math.max(1, Math.ceil(dt * 120));
          const h = dt / steps;
          for (let s = 0; s < steps; s++) {
            const force = (target.current - pos.current) * STIFFNESS - vel.current * DAMPING;
            vel.current += force * h;
            pos.current += vel.current * h;
          }
          if (Math.abs(target.current - pos.current) < 0.0005 && Math.abs(vel.current) < 0.001) {
            pos.current = target.current;
            vel.current = 0;
          }
        }
      }

      const rounded = Math.max(0, Math.min(count - 1, Math.round(pos.current)));
      if (count > 0) emit(rounded);

      // Inspeção: o frasco cresce, a interface recua, o arrasto inclina.
      const t = tilt.current;
      const inspecting = inspectRef.current;
      inspectAmount.current += ((inspecting ? 1 : 0) - inspectAmount.current) * (reduced.current ? 1 : Math.min(1, dt * 7));
      if (!inspecting) {
        t.tx = 0;
        t.ty = 0;
        t.tzoom = 1;
      }
      const ease = reduced.current ? 1 : Math.min(1, dt * 9);
      t.x += (t.tx - t.x) * ease;
      t.y += (t.ty - t.y) * ease;
      t.zoom += (t.tzoom - t.zoom) * ease;

      const floatY = reduced.current ? 0 : Math.sin((now - start) / 1000 * 0.9) * 4;
      // Close-up: o frasco abre espaço para o perfil olfativo — à esquerda no desktop, para cima no celular.
      const ia = inspectAmount.current;
      const shiftX = g.mobile ? 0 : -g.w * 0.17 * ia;
      const shiftY = g.mobile ? -g.h * 0.12 * ia : 0;
      for (let i = 0; i < count; i++) {
        const el = slots.current.get(perfumes[i].id);
        if (!el) continue;
        const d = i - pos.current;
        const ad = Math.abs(d);
        if (ad > 4.6) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = 'visible';
        const sign = Math.sign(d);
        const x = sign * g.spacingX * Math.pow(ad, 0.78) + sign * ia * g.spacingX * 1.4 * Math.min(1, ad) + shiftX;
        const y = d * g.spacingY - (ad < 1 ? (1 - ad) * floatY : 0) + shiftY;
        const scaleBase = 1 / (1 + Math.pow(ad, 0.9) * (g.mobile ? 0.7 : 0.62));
        const focusWeight = Math.max(0, 1 - ad);
        const scale = scaleBase * (1 + focusWeight * ia * (g.mobile ? -0.3 : 0.12) * t.zoom + focusWeight * (t.zoom - 1) * 0.6);
        const rot = Math.max(-22, Math.min(22, -d * 9));
        const opacity = Math.min(1, Math.exp(-ad * (g.mobile ? 1.45 : 0.78)) * 1.05) * (1 - ia * Math.min(1, ad));
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        el.style.opacity = opacity.toFixed(3);
        el.style.zIndex = String(100 - Math.round(ad * 10));
        const art = el.firstElementChild as HTMLElement | null;
        if (art) {
          const tx = focusWeight * t.x;
          const ty = focusWeight * t.y;
          art.style.transform = tx || ty ? `rotateX(${ty.toFixed(2)}deg) rotateY(${tx.toFixed(2)}deg)` : '';
          art.style.setProperty('--sheen', `${(50 + tx * 2.2).toFixed(1)}%`);
        }
      }

      // Cor contínua: entre o frasco 3 e o 4, a atmosfera é a mistura dos dois.
      if (count > 0 && !(Math.abs(pos.current - lastAccentPos.current) <= 0.002)) {
        lastAccentPos.current = pos.current;
        const p = Math.max(0, Math.min(count - 1, pos.current));
        const i0 = Math.floor(p);
        const i1 = Math.min(count - 1, i0 + 1);
        accent.blend(colors.current[i0], colors.current[i1], p - i0);
        scene.scroll(pos.current);
      }
      const r = root.current;
      if (r) {
        r.style.setProperty('--inspect', ia.toFixed(3));
        r.style.setProperty('--shift-x', `${shiftX.toFixed(1)}px`);
        r.style.setProperty('--shift-y', `${shiftY.toFixed(1)}px`);
        // A luz de fundo da galáxia acompanha o frasco quando ele muda de lugar.
        if (Math.abs(ia - lastIa) > 0.01) {
          lastIa = ia;
          const rect = r.getBoundingClientRect();
          const cy = parseFloat(getComputedStyle(r).getPropertyValue('--stage-cy')) || 46;
          scene.focus((rect.left + g.w / 2 + shiftX) / window.innerWidth, (rect.top + (g.h * cy) / 100 + shiftY) / window.innerHeight);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [count, perfumes, emit]);

  const go = useCallback(
    (i: number) => {
      target.current = clampIndex(i);
    },
    [clampIndex],
  );

  /* ------------------------------------------------------------ ponteiro */

  const slotIndexAt = (event: React.PointerEvent) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    return el ? Number(el.dataset.slot) : null;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || count === 0) return;
    pinch.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current.size === 2 && inspectRef.current) {
      const [a, b] = [...pinch.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: tilt.current.tzoom };
      drag.current = null;
      return;
    }
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startPos: pos.current, moved: false, lastX: event.clientX, lastT: performance.now(), v: 0, slot: slotIndexAt(event) };
    const t = tilt.current;
    t.ix = t.tx;
    t.iy = t.ty;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!inspectRef.current && event.pointerType === 'mouse' && !drag.current) {
      const g = geometry.current;
      scene.pointer((event.clientX / g.w) * 2 - 1, (event.clientY / g.h) * 2 - 1);
    }
    if (pinch.current.has(event.pointerId)) pinch.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchStart.current && pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      tilt.current.tzoom = Math.max(0.85, Math.min(1.6, pinchStart.current.zoom * (dist / pinchStart.current.dist)));
      return;
    }
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 6) {
      d.moved = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (!d.moved) return;
    if (inspectRef.current) {
      tilt.current.tx = Math.max(-28, Math.min(28, tilt.current.ix + dx * 0.18));
      tilt.current.ty = Math.max(-14, Math.min(14, tilt.current.iy - dy * 0.1));
      return;
    }
    const g = geometry.current;
    const perItem = g.spacingX * (g.mobile ? 1.1 : 1.25);
    let next = d.startPos - dx / perItem;
    // Borracha nas pontas: dá para puxar além do primeiro/último, mas resiste.
    if (next < 0) next = next * 0.3;
    if (next > count - 1) next = count - 1 + (next - (count - 1)) * 0.3;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    const inst = -(event.clientX - d.lastX) / perItem / dt;
    d.v = d.v * 0.7 + inst * 0.3;
    d.lastX = event.clientX;
    d.lastT = now;
    pos.current = next;
    vel.current = 0;
  };

  const endPointer = (event: React.PointerEvent) => {
    pinch.current.delete(event.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.moved) {
      if (inspectRef.current) return;
      const projected = pos.current + d.v * 0.22;
      vel.current = d.v;
      target.current = clampIndex(Math.round(projected));
      return;
    }
    if (event.type === 'pointercancel') return;
    // Toque sem arrasto: num vizinho, seleciona; no selecionado, entra (ou sai) da inspeção.
    if (d.slot === null) {
      if (inspectRef.current) onInspectChange(false);
      return;
    }
    if (d.slot === Math.round(target.current)) onInspectChange(!inspectRef.current);
    else {
      if (inspectRef.current) onInspectChange(false);
      go(d.slot);
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    if (count === 0) return;
    if (inspectRef.current) {
      tilt.current.tzoom = Math.max(0.85, Math.min(1.6, tilt.current.tzoom - event.deltaY * 0.0012));
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 1) return;
    const g = geometry.current;
    const unit = event.deltaMode === 1 ? 40 : 1;
    pos.current = Math.max(-0.25, Math.min(count - 0.75, pos.current + (delta * unit) / (g.spacingX * 2.2)));
    vel.current = 0;
    if (wheelSnap.current !== null) window.clearTimeout(wheelSnap.current);
    wheelSnap.current = window.setTimeout(() => {
      wheelSnap.current = null;
      target.current = clampIndex(Math.round(pos.current));
    }, 140);
  };

  /* ------------------------------------------------------------ teclado */

  useEffect(() => {
    if (paused) return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"], dialog') || el.getAttribute('role') === 'radio')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const cur = Math.round(target.current);
      if (event.key === 'ArrowRight') go(cur + 1);
      else if (event.key === 'ArrowLeft') go(cur - 1);
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(count - 1);
      else if (event.key === 'Escape' && inspectRef.current) onInspectChange(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paused, go, count, onInspectChange]);

  const onStageKey = (event: React.KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && count > 0) {
      event.preventDefault();
      onInspectChange(!inspectRef.current);
    }
  };

  const active = perfumes[focusIndex];

  return (
    <div
      ref={root}
      className={`stage${inspect ? ' is-inspecting' : ''}`}
      role="listbox"
      aria-label={label}
      aria-activedescendant={active ? `bottle-${active.id}` : undefined}
      aria-roledescription="seletor de perfumes"
      tabIndex={0}
      onKeyDown={onStageKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
      onPointerLeave={() => scene.pointer(0, 0)}
    >
      <div className="stage__beam" aria-hidden="true" />
      <div className="stage__pool" aria-hidden="true" />
      <div className="stage__track">
        {perfumes.map((p, i) => {
          const near = Math.abs(i - focusIndex) <= 1;
          return (
            <div
              key={p.id}
              id={`bottle-${p.id}`}
              role="option"
              aria-selected={i === focusIndex}
              aria-label={`${p.name}${p.brand ? `, ${p.brand}` : ''}`}
              data-slot={i}
              className={`slot${i === focusIndex ? ' is-focus' : ''}${p.id === departingId ? ' is-departing' : ''}${p.id === arrivingId ? ' is-arriving' : ''}`}
              ref={(el) => {
                if (el) slots.current.set(p.id, el);
                else slots.current.delete(p.id);
              }}
            >
              <Bottle perfume={p} detail={near ? 'lg' : 'sm'} active={i === focusIndex && inspect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
