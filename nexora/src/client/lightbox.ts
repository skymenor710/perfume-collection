/**
 * Visionneuse plein écran des captures de projets.
 *  - Ouverture : clic / toucher sur une image du carrousel, bouton « Agrandir », ou Entrée sur le carrousel.
 *  - <dialog> natif (showModal) : fond inerte, focus piégé, Échap pour fermer ; le focus revient au carrousel.
 *  - Navigation : flèches à l'écran, ← → au clavier, glisser horizontal au doigt ; compteur « 2 / 4 ».
 *  - Zoom ×2 : clic sur l'image (au point cliqué) ou bouton loupe ; image agrandie déplaçable à la souris / au doigt.
 *  - Images haute définition (jusqu'à 1600 px) chargées à la demande, voisines préchargées.
 */
interface Shot {
  avif: string;
  webp: string;
  src: string;
  alt: string;
  width: number;
  height: number;
}

const ZOOM = 2;
// En dessous de ce gain réel (pixels de l'image ÷ pixels affichés), zoomer ne montrerait rien de plus net.
const MIN_ZOOM_GAIN = 1.2;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readShots(gallery: HTMLElement): Shot[] {
  return Array.from(gallery.querySelectorAll<HTMLElement>('[data-slide]')).map((slide) => {
    const source = slide.querySelector<HTMLSourceElement>('source[type="image/avif"]');
    const img = slide.querySelector<HTMLImageElement>('img[src], img[data-src]')!;
    return {
      avif: source?.getAttribute('srcset') || source?.dataset.srcset || '',
      webp: img.getAttribute('srcset') || img.dataset.srcset || '',
      src: img.getAttribute('src') || img.dataset.src || '',
      alt: img.alt,
      width: Number(img.getAttribute('width')) || 1,
      height: Number(img.getAttribute('height')) || 1,
    };
  });
}

function currentIndex(gallery: HTMLElement) {
  const viewport = gallery.querySelector<HTMLElement>('[data-carousel-viewport]');
  if (!viewport) return 0;
  return Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth));
}

export function initLightbox() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-lightbox]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const q = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
  const frame = q<HTMLElement>('[data-lightbox-frame]');
  const stage = q<HTMLElement>('[data-lightbox-stage]');
  const title = q<HTMLElement>('[data-lightbox-title]');
  const counter = q<HTMLElement>('[data-lightbox-count]');
  const caption = q<HTMLElement>('[data-lightbox-caption]');
  const status = q<HTMLElement>('[data-lightbox-status]');
  const zoomBtn = q<HTMLButtonElement>('[data-lightbox-zoom]');
  const prevBtn = q<HTMLButtonElement>('[data-lightbox-prev]');
  const nextBtn = q<HTMLButtonElement>('[data-lightbox-next]');

  let shots: Shot[] = [];
  let index = 0;
  let gallery: HTMLElement | null = null;
  let img: HTMLImageElement | null = null;
  let zoomed = false;
  let pan = { x: 0, y: 0 };

  function picture(shot: Shot, eager: boolean) {
    const pic = document.createElement('picture');
    if (shot.avif) {
      const s = document.createElement('source');
      s.type = 'image/avif';
      s.srcset = shot.avif;
      s.sizes = '(min-aspect-ratio: 1/1) 92vh, 96vw';
      pic.append(s);
    }
    const i = document.createElement('img');
    i.className = 'lightbox__img';
    i.alt = shot.alt;
    i.width = shot.width;
    i.height = shot.height;
    i.decoding = 'async';
    if (!eager) i.loading = 'lazy';
    i.sizes = '(min-aspect-ratio: 1/1) 92vh, 96vw';
    if (shot.webp) i.srcset = shot.webp;
    i.src = shot.src;
    pic.append(i);
    return { pic, img: i };
  }

  // Zoom proposé seulement si la plus grande variante apporte réellement du détail sur cet écran.
  function maxWidth(shot: Shot) {
    const ws = [...shot.webp.matchAll(/ (\d+)w/g)].map((m) => Number(m[1]));
    return ws.length ? Math.max(...ws) : shot.width;
  }
  function zoomable() {
    if (!img) return false;
    return maxWidth(shots[index]) / (img.clientWidth * window.devicePixelRatio) >= MIN_ZOOM_GAIN;
  }
  function updateZoomTool() {
    zoomBtn.hidden = !zoomable();
    img?.classList.toggle('is-zoomable', zoomable());
  }

  function preload(i: number) {
    const shot = shots[(i + shots.length) % shots.length];
    if (!shot) return;
    const { img: p } = picture(shot, true);
    p.loading = 'eager';
  }

  function applyTransform(animate = true) {
    if (!img) return;
    img.style.transition = animate && !reduced() ? '' : 'none';
    img.style.transform = zoomed ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${ZOOM})` : '';
    stage.classList.toggle('is-zoomed', zoomed);
    dialog!.classList.toggle('is-zoomed', zoomed);
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    zoomBtn.setAttribute('aria-label', zoomed ? 'Dézoomer' : 'Zoomer');
  }

  // Limite le déplacement : l'image agrandie couvre toujours son cadre.
  function clampPan() {
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    const maxX = ((ZOOM - 1) * w) / 2;
    const maxY = ((ZOOM - 1) * h) / 2;
    pan.x = Math.max(-maxX, Math.min(maxX, pan.x));
    pan.y = Math.max(-maxY, Math.min(maxY, pan.y));
  }

  function setZoom(on: boolean, at?: { x: number; y: number }) {
    if (on && !zoomable()) return;
    zoomed = on;
    // Agrandi : le navigateur choisit la plus grande variante disponible (détails nets).
    if (on && img) img.parentElement?.querySelectorAll<HTMLImageElement | HTMLSourceElement>('source, img').forEach((el) => (el.sizes = '(min-aspect-ratio: 1/1) 200vh, 200vw'));
    pan = { x: 0, y: 0 };
    if (on && at && img) {
      // Le point cliqué reste sous le pointeur.
      const r = img.getBoundingClientRect();
      const dx = at.x - (r.left + r.width / 2);
      const dy = at.y - (r.top + r.height / 2);
      pan = { x: -dx * (ZOOM - 1), y: -dy * (ZOOM - 1) };
      clampPan();
    }
    applyTransform();
  }

  function show(i: number, direction = 0) {
    index = (i + shots.length) % shots.length;
    const shot = shots[index];
    const { pic, img: next } = picture(shot, true);
    const old = frame.firstElementChild;
    if (old && !reduced() && direction !== 0) {
      pic.classList.add('is-entering');
      pic.style.setProperty('--from', direction > 0 ? '24px' : '-24px');
      old.classList.add('is-leaving');
      old.addEventListener('animationend', () => old.remove(), { once: true });
      setTimeout(() => old.remove(), 600);
    } else {
      old?.remove();
    }
    frame.append(pic);
    img = next;
    zoomed = false;
    pan = { x: 0, y: 0 };
    applyTransform(false);
    if (next.complete) updateZoomTool();
    else next.addEventListener('load', updateZoomTool, { once: true });
    counter.textContent = `${index + 1} / ${shots.length}`;
    caption.textContent = shot.alt;
    status.textContent = `Image ${index + 1} sur ${shots.length}`;
    const single = shots.length < 2;
    prevBtn.hidden = single;
    nextBtn.hidden = single;
    if (!single) {
      preload(index + 1);
      preload(index - 1);
    }
  }

  function open(g: HTMLElement, i: number) {
    gallery = g;
    shots = readShots(g);
    if (!shots.length) return;
    title.textContent = g.dataset.gallery || '';
    frame.replaceChildren();
    closedByKeyboard = false;
    show(i);
    document.documentElement.classList.add('lightbox-open');
    dialog!.showModal();
    // Ouverture douce (classe retirée à la fermeture).
    requestAnimationFrame(() => dialog!.classList.add('is-open'));
    zoomBtn.focus({ preventScroll: true });
  }

  function close() {
    dialog!.classList.remove('is-open');
    dialog!.close();
  }

  let closedByKeyboard = false;
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') closedByKeyboard = true;
  });
  dialog.addEventListener('pointerdown', () => (closedByKeyboard = false));
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('lightbox-open');
    frame.replaceChildren();
    img = null;
    // Le carrousel reprend l'image regardée en dernier, et le focus y revient.
    if (gallery) {
      gallery.dispatchEvent(new CustomEvent('nx:goto', { detail: index }));
      const back = gallery.querySelector<HTMLElement>('[data-carousel-viewport][tabindex]') ?? gallery.querySelector<HTMLElement>('[data-lightbox-open]');
      back?.focus({ preventScroll: true, focusVisible: closedByKeyboard } as FocusOptions);
    }
  });

  // ---------------------------------------------------------------- ouverture depuis les carrousels
  document.querySelectorAll<HTMLElement>('[data-gallery]').forEach((g) => {
    const viewport = g.querySelector<HTMLElement>('[data-carousel-viewport]');
    g.querySelector('[data-lightbox-open]')?.addEventListener('click', () => open(g, currentIndex(g)));
    if (!viewport) return;
    // Un glissement (changement d'image au doigt) ne doit pas ouvrir la visionneuse : seulement un vrai clic.
    let down: { x: number; y: number; left: number } | null = null;
    viewport.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft };
    });
    viewport.addEventListener('click', (e) => {
      const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      if (!slide) return;
      if (down && (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || Math.abs(viewport.scrollLeft - down.left) > 4)) return;
      open(g, Number(slide.dataset.slide) || 0);
    });
    viewport.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(g, currentIndex(g));
      }
    });
  });

  // ---------------------------------------------------------------- commandes de la visionneuse
  q<HTMLButtonElement>('[data-lightbox-close]').addEventListener('click', close);
  prevBtn.addEventListener('click', () => show(index - 1, -1));
  nextBtn.addEventListener('click', () => show(index + 1, 1));
  zoomBtn.addEventListener('click', () => setZoom(!zoomed));

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' && shots.length > 1) show(index + 1, 1);
    else if (e.key === 'ArrowLeft' && shots.length > 1) show(index - 1, -1);
    else if (e.key === '+' || e.key === '=') setZoom(true);
    else if (e.key === '-') setZoom(false);
    else return;
    e.preventDefault();
  });

  let start: { x: number; y: number; px: number; py: number } | null = null;
  let moved = false;

  // Clic sur l'image : zoom au point cliqué. Clic sur le fond (hors image et commandes) : fermeture.
  stage.addEventListener('click', (e) => {
    if (moved) return;
    const target = e.target as HTMLElement;
    if (target.classList.contains('lightbox__img')) {
      if (zoomed || zoomable()) setZoom(!zoomed, { x: e.clientX, y: e.clientY });
    } else if (!zoomed) {
      close();
    }
  });

  // Glisser : déplacement de l'image agrandie, ou image suivante / précédente sans zoom.
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    moved = false;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!start || !img) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 6) moved = true;
    if (zoomed && moved) {
      if (!stage.hasPointerCapture(e.pointerId)) stage.setPointerCapture(e.pointerId);
      pan = { x: start.px + dx, y: start.py + dy };
      clampPan();
      applyTransform(false);
      stage.classList.add('is-panning');
    } else if (!zoomed && moved) {
      img.style.transition = 'none';
      img.style.transform = `translate3d(${dx * 0.6}px, 0, 0)`;
    }
  });
  const end = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    stage.classList.remove('is-panning');
    if (!zoomed && img) {
      img.style.transition = '';
      img.style.transform = '';
      if (moved && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && shots.length > 1) show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }
    start = null;
    // Le clic qui suit un glissement est ignoré, puis l'état est remis à zéro.
    setTimeout(() => (moved = false), 0);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  window.addEventListener('resize', () => {
    if (dialog.open) updateZoomTool();
    if (zoomed) {
      clampPan();
      applyTransform(false);
    }
  });
}
