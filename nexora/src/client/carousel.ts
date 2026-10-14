/**
 * Carrousel indépendant par carte de projet.
 * Base : défilement horizontal natif avec scroll-snap (glisser au doigt sans bibliothèque, inertie du système).
 * Les flèches, les points et le clavier pilotent ce même défilement : chaque carrousel ne connaît que ses propres
 * éléments, donc changer d'image dans un projet ne touche jamais aux autres.
 */
export function initCarousel(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('[data-carousel-viewport]');
  if (!viewport) return;
  const slides = Array.from(viewport.querySelectorAll<HTMLElement>('[data-slide]'));
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-carousel-dot]'));
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-next]');
  const status = root.querySelector<HTMLElement>('[data-carousel-status]');
  const count = slides.length;
  if (count < 2) return;
  let index = 0;
  let announced = false;
  let pending: number | null = null;
  let pendingTimer = 0;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function warm(i: number) {
    // Charge une image différée seulement quand le visiteur utilise CE carrousel (jamais tous d'un coup).
    const picture = slides[((i % count) + count) % count]?.querySelector<HTMLElement>('picture[data-deferred]');
    if (!picture) return;
    picture.removeAttribute('data-deferred');
    picture.querySelectorAll<HTMLSourceElement>('source[data-srcset]').forEach((s) => {
      s.srcset = s.dataset.srcset!;
      s.removeAttribute('data-srcset');
    });
    const img = picture.querySelector<HTMLImageElement>('img[data-src]');
    if (img) {
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.src = img.dataset.src!;
      img.removeAttribute('data-src');
      img.removeAttribute('data-srcset');
    }
  }

  function render(i: number) {
    index = i;
    dots.forEach((d, k) => {
      if (k === i) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    slides.forEach((s, k) => {
      s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });
    if (status && announced) status.textContent = `Image ${i + 1} sur ${count}`;
  }

  function goTo(i: number, user = true) {
    const target = ((i % count) + count) % count;
    warm(target);
    warm(target + 1);
    announced = user;
    // Défilement animé en cours : la synchronisation au défilement attend l'arrivée (pas de points qui clignotent).
    pending = target;
    clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => (pending = null), 1200);
    viewport!.scrollTo({ left: target * viewport!.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
    render(target);
  }

  // Synchronise l'index quand l'utilisateur glisse au doigt / au trackpad.
  let raf = 0;
  viewport.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth));
        if (pending !== null) {
          if (Math.abs(viewport.scrollLeft - pending * viewport.clientWidth) < 2) pending = null;
          return;
        }
        if (i !== index && i >= 0 && i < count) {
          announced = true;
          render(i);
          warm(i);
          warm(i + 1);
        }
      });
    },
    { passive: true },
  );

  // La visionneuse plein écran renvoie l'image vue en dernier.
  root.addEventListener('nx:goto', (e) => goTo((e as CustomEvent<number>).detail, false));

  prev?.addEventListener('click', () => goTo(index - 1));
  next?.addEventListener('click', () => goTo(index + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => goTo(k)));

  viewport.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goTo(index + 1);
    else if (e.key === 'ArrowLeft') goTo(index - 1);
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(count - 1);
    else return;
    e.preventDefault();
  });

  const warmOnce = () => {
    warm(1);
    warm(count - 1);
  };
  root.addEventListener('pointerenter', warmOnce, { once: true });
  root.addEventListener('focusin', warmOnce, { once: true });
  root.addEventListener('touchstart', warmOnce, { once: true, passive: true });

  // Garde l'image courante alignée si la largeur change (rotation, redimensionnement).
  new ResizeObserver(() => {
    viewport.scrollTo({ left: index * viewport.clientWidth, behavior: 'auto' });
  }).observe(viewport);

  render(0);
}
