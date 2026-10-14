import '../styles/site.css';
import { initMotion } from './motion';
import { initContactForm } from './contact-form';
import { initLightbox } from './lightbox';

document.documentElement.classList.add('js');

function initHeader() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Lien actif selon la section visible.
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.site-nav__link'));
  const sections = links
    .map((l) => document.getElementById(l.hash.slice(1)))
    .filter((s): s is HTMLElement => !!s);
  if (sections.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          for (const l of links) {
            if (l.hash === `#${e.target.id}`) l.setAttribute('aria-current', 'true');
            else l.removeAttribute('aria-current');
          }
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((s) => io.observe(s));
  }
}

function initMobileMenu() {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
  const label = document.querySelector<HTMLElement>('[data-menu-label]');
  if (!toggle || !menu) return;
  const focusables = () => [toggle, ...Array.from(menu.querySelectorAll<HTMLElement>('a[href], button'))];

  function open() {
    menu!.hidden = false;
    requestAnimationFrame(() => menu!.classList.add('is-open'));
    toggle!.setAttribute('aria-expanded', 'true');
    if (label) label.textContent = 'Fermer le menu';
    document.documentElement.classList.add('menu-open');
    menu!.querySelector<HTMLElement>('a')?.focus();
    document.addEventListener('keydown', onKey);
  }
  function close(returnFocus = true) {
    menu!.classList.remove('is-open');
    menu!.hidden = true;
    toggle!.setAttribute('aria-expanded', 'false');
    if (label) label.textContent = 'Ouvrir le menu';
    document.documentElement.classList.remove('menu-open');
    document.removeEventListener('keydown', onKey);
    if (returnFocus) toggle!.focus();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Piège de focus dans le menu ouvert.
      const f = focusables();
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  toggle.addEventListener('click', () => (toggle.getAttribute('aria-expanded') === 'true' ? close() : open()));
  menu.querySelectorAll('[data-menu-link]').forEach((a) => a.addEventListener('click', () => close(false)));
  window.matchMedia('(min-width: 861px)').addEventListener('change', (m) => {
    if (m.matches && !menu.hidden) close(false);
  });
}

function boot() {
  initHeader();
  initMobileMenu();
  initMotion();
  initLightbox();
  initContactForm();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
