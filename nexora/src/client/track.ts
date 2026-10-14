/**
 * Événements de conversion. Toujours émis LOCALEMENT (événement « nexora:track » sur window, sans réseau) ; transmis à
 * l'outil de mesure d'audience SEULEMENT s'il est configuré ET que le visiteur a accepté (voir consent.ts).
 *
 * Événements : cta_primary, cta_secondary, cta_header, service_click (service), form_start, form_submit_success,
 * booking_open, booking_completed, whatsapp_click.
 */
export type TrackProps = Record<string, string>;
type Sink = (name: string, props: TrackProps) => void;

let sink: Sink | null = null;
const queue: [string, TrackProps][] = [];

/** Branché par consent.ts une fois l'outil chargé (après accord). */
export function setTrackSink(fn: Sink | null) {
  sink = fn;
  if (fn) while (queue.length) fn(...queue.shift()!);
  else queue.length = 0;
}

export function track(name: string, props: TrackProps = {}) {
  window.dispatchEvent(new CustomEvent('nexora:track', { detail: { name, props } }));
  if (sink) sink(name, props);
  else if (queue.length < 20) queue.push([name, props]); // conservé le temps du choix de consentement uniquement
}

/** Clics sur les éléments [data-track] (boutons d'appel à l'action, services…). */
export function initTrackedClicks() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-track]');
    if (!el) return;
    const props: TrackProps = {};
    if (el.dataset.trackService) props.service = el.dataset.trackService;
    track(el.dataset.track!, props);
  });
}
