/**
 * Galeries des réalisations — une par carte, indépendantes les unes des autres.
 *  - Défilement horizontal natif aimanté (scroll-snap) : glisser au doigt ou au pavé tactile, sans bibliothèque.
 *  - Flèches précédente / suivante (en boucle), points indicateurs (bouton par capture, aria-current sur la capture
 *    affichée), ← → Début Fin au clavier dès que le focus est dans la galerie.
 *  - Seule la capture affichée est exposée (les autres sont `inert`) ; son changement est annoncé poliment.
 *  - Hauteur fixe (16:10) : aucun décalage de mise en page ; mouvement réduit → déplacement instantané.
 * La capture courante est exposée dans data-index : la visionneuse s'ouvre sur elle (src/client/lightbox.ts).
 */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initGalleries() {
  document.querySelectorAll<HTMLElement>('[data-carousel]').forEach(setup);
}

function setup(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('[data-carousel-viewport]');
  const slides = Array.from(root.querySelectorAll<HTMLElement>('[data-slide]'));
  if (!viewport || slides.length < 2) return;
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-carousel-dot]'));
  const counter = root.querySelector<HTMLElement>('[data-carousel-index]');
  const status = root.querySelector<HTMLElement>('[data-carousel-status]');
  const n = slides.length;
  let index = 0;
  // Pendant un déplacement demandé (flèche, point, clavier), les positions intermédiaires ne changent pas l'index.
  let target: number | null = null;
  let targetTimer = 0;

  function render(announce: boolean) {
    root.dataset.index = String(index);
    slides.forEach((s, k) => s.toggleAttribute('inert', k !== index));
    dots.forEach((d, k) => {
      if (k === index) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    if (counter) counter.textContent = String(index + 1).padStart(2, '0');
    if (announce && status) {
      const alt = slides[index].querySelector<HTMLElement>('[data-shot]')?.dataset.alt ?? '';
      status.textContent = `Capture ${index + 1} sur ${n}${alt ? ` : ${alt}` : ''}`;
    }
  }

  function go(k: number, focus: 'slide' | 'dot' | null = null) {
    index = (k + n) % n;
    target = index;
    window.clearTimeout(targetTimer);
    targetTimer = window.setTimeout(() => (target = null), 900);
    viewport!.scrollTo({ left: index * viewport!.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
    render(true);
    if (focus === 'slide') slides[index].querySelector<HTMLElement>('[data-shot-open]')?.focus({ preventScroll: true });
    else if (focus === 'dot') dots[index]?.focus({ preventScroll: true });
  }

  // Glissement au doigt / pavé tactile : l'index suit la capture la plus visible.
  let ticking = false;
  viewport.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const k = Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth));
        if (target !== null) {
          if (k === target) target = null;
          return;
        }
        if (k !== index && k >= 0 && k < n) {
          index = k;
          render(true);
        }
      });
    },
    { passive: true },
  );

  root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => go(index - 1));
  root.querySelector('[data-carousel-next]')?.addEventListener('click', () => go(index + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => go(k)));

  root.addEventListener('keydown', (e) => {
    const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: n - 1 };
    if (!(e.key in keys) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const from = e.target as HTMLElement;
    go(keys[e.key], from.matches('[data-carousel-dot]') ? 'dot' : from.matches('[data-shot-open]') ? 'slide' : null);
  });

  // Redimensionnement : la capture courante reste alignée.
  new ResizeObserver(() => {
    viewport.scrollLeft = index * viewport.clientWidth;
  }).observe(viewport);

  render(false);
}
