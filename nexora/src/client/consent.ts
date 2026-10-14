/**
 * Consentement à la mesure d'audience (RGPD / lignes directrices de la CNIL).
 *  - Le bandeau n'existe que si un outil est configuré côté serveur (ANALYTICS_PROVIDER).
 *  - « Accepter » et « Refuser » ont le même poids ; aucun script tiers n'est chargé avant « Accepter ».
 *  - Le choix (et lui seul) est mémorisé dans ce navigateur pendant 6 mois ; modifiable via « Mesure d'audience » en
 *    pied de page. Refus → aucun chargement, la file d'événements est vidée.
 */
import { setTrackSink } from './track';

const KEY = 'nexora-consent';
const MAX_AGE = 1000 * 60 * 60 * 24 * 182;

type Choice = 'granted' | 'denied';

function read(): Choice | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { c: Choice; t: number } | null;
    return v && Date.now() - v.t < MAX_AGE ? v.c : null;
  } catch {
    return null;
  }
}
function write(c: Choice) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ c, t: Date.now() }));
  } catch {
    /* navigation privée : le choix vaut pour la page en cours */
  }
}

declare global {
  interface Window {
    plausible?: ((name: string, opts?: { props?: Record<string, string>; u?: string }) => void) & { q?: unknown[] };
  }
}

let loaded = false;
function loadPlausible(domain: string, src: string) {
  if (loaded) return;
  loaded = true;
  window.plausible ??= Object.assign((...args: unknown[]) => void (window.plausible!.q ??= []).push(args), {}) as Window['plausible'];
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  s.dataset.domain = domain;
  document.head.append(s);
  window.plausible!('pageview');
  setTrackSink((name, props) => window.plausible?.(name, { props }));
}

export function initConsent() {
  const banner = document.querySelector<HTMLElement>('[data-consent]');
  if (!banner) return;
  const { provider, domain, script } = banner.dataset;
  const apply = (c: Choice) => {
    if (c === 'granted' && provider === 'plausible' && domain && script) loadPlausible(domain, script);
    if (c === 'denied') setTrackSink(null);
  };
  const choice = read();
  if (choice) apply(choice);
  else banner.hidden = false;

  banner.querySelectorAll<HTMLButtonElement>('[data-consent-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = b.dataset.consentChoice as Choice;
      write(c);
      banner.hidden = true;
      // Retrait d'un accord déjà donné : le script chargé ne peut pas être déchargé, on recharge la page sans lui.
      if (c === 'denied' && loaded) location.reload();
      else apply(c);
    }),
  );
  document.querySelector('[data-consent-open]')?.addEventListener('click', () => {
    banner.hidden = false;
    banner.querySelector<HTMLButtonElement>('[data-consent-choice="denied"]')?.focus();
  });
}
