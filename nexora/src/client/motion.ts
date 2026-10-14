/**
 * Mouvement lié au défilement — sans détourner le défilement natif :
 *  - parallaxe légère du halo de fond et du symbole N dans le hero (transform uniquement) ;
 *  - jauge de progression sous le hero ;
 *  - apparitions douces des sections suivantes ;
 *  - pause des animations (néon, tracé) quand elles sont hors écran.
 * Tout est désactivé si l'utilisateur préfère réduire les animations.
 */
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initMotion() {
  const root = document.documentElement;
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const bg = document.querySelector<HTMLElement>('[data-parallax-bg]');
  const symbol = document.querySelector<HTMLElement>('[data-parallax-symbol]');
  const progress = document.querySelector<HTMLElement>('[data-scroll-progress]');

  // Pause hors écran (économie de batterie / CPU).
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.target.classList.toggle('is-offscreen', !e.isIntersecting);
    },
    { rootMargin: '80px' },
  );
  if (hero) visibility.observe(hero);

  if (!prefersReduced()) {
    root.classList.add('js-motion');
    initReveal();
  } else {
    document.querySelector('.contact')?.classList.add('is-drawn');
  }

  let heroVisible = true;
  if (hero) {
    new IntersectionObserver((entries) => {
      heroVisible = entries[0].isIntersecting;
    }).observe(hero);
  }

  let ticking = false;
  function update() {
    ticking = false;
    const y = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (progress) progress.style.transform = `scaleX(${(0.125 + 0.875 * Math.min(1, y / max)).toFixed(4)})`;
    if (!hero || !heroVisible || prefersReduced()) return;
    const h = hero.offsetHeight || 1;
    const p = Math.min(1, Math.max(0, y / h));
    // Amplitudes volontairement faibles : profondeur sans gêner la lecture.
    if (bg) bg.style.transform = `translate3d(0, ${(p * 90).toFixed(2)}px, 0)`;
    if (symbol) symbol.style.transform = `translate3d(0, ${(p * 46).toFixed(2)}px, 0) scale(${(1 - p * 0.06).toFixed(4)})`;
  }
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

function initReveal() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  const contact = document.querySelector<HTMLElement>('.contact');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        if (el === contact) el.classList.add('is-drawn');
        else el.classList.remove('reveal-pending');
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
  );
  // Seuls les éléments encore SOUS la ligne de flottaison sont masqués : rien de déjà visible ne clignote.
  const vh = window.innerHeight;
  for (const el of items) {
    if (el.getBoundingClientRect().top > vh * 0.9) {
      el.classList.add('reveal-pending');
      io.observe(el);
    }
  }
  if (contact) {
    if (contact.getBoundingClientRect().top < vh * 0.75) contact.classList.add('is-drawn');
    else io.observe(contact);
  }
}
