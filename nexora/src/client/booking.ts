/**
 * Prise de rendez-vous. Les boutons « Réserver… » [data-booking] pointent vers le lien configuré dans l'admin.
 *  - Cal.com / Calendly : la réservation s'ouvre dans une fenêtre intégrée (<dialog>, iframe chargée à l'ouverture) ;
 *    la confirmation envoyée par le service (postMessage, origine vérifiée) déclenche « booking_completed ».
 *  - Autre service, ou sans JavaScript : le lien s'ouvre normalement dans un nouvel onglet.
 */
import { track } from './track';

const EMBEDDABLE = ['https://cal.com', 'https://app.cal.com', 'https://calendly.com'];

/** Adresse de la version intégrable, selon le service. */
function embedUrl(raw: string) {
  const u = new URL(raw);
  if (u.origin === 'https://calendly.com') {
    u.searchParams.set('embed_domain', location.hostname);
    u.searchParams.set('embed_type', 'Inline');
  } else {
    u.searchParams.set('embed', 'nexora');
    u.searchParams.set('embedType', 'inline');
  }
  return u.toString();
}

/** Messages de confirmation des services (format documenté par Calendly et par l'intégration Cal.com). */
function isBookingConfirmation(origin: string, data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const d = data as { event?: string; type?: string; originator?: string };
  if (origin === 'https://calendly.com') return d.event === 'calendly.event_scheduled';
  return d.originator === 'CAL' && typeof d.type === 'string' && d.type.startsWith('bookingSuccessful');
}

export function initBooking() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-booking-dialog]');
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-booking]'));
  if (!dialog || !links.length || typeof dialog.showModal !== 'function') return;
  const frame = dialog.querySelector<HTMLElement>('[data-booking-frame]')!;
  const external = dialog.querySelector<HTMLAnchorElement>('[data-booking-external]')!;
  let opener: HTMLElement | null = null;
  let completed = false;

  for (const a of links) {
    let origin = '';
    try {
      origin = new URL(a.href).origin;
    } catch {
      continue;
    }
    if (!EMBEDDABLE.includes(origin)) continue; // autre service : nouvel onglet
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // ouverture volontaire dans un onglet
      e.preventDefault();
      opener = a;
      if (!frame.firstElementChild) {
        const iframe = document.createElement('iframe');
        iframe.title = 'Réservation d’un créneau';
        iframe.src = embedUrl(a.href);
        iframe.loading = 'eager';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.append(iframe);
      }
      external.href = a.href;
      document.documentElement.classList.add('lightbox-open');
      dialog.showModal();
      if (a.dataset.track !== 'booking_open') track('booking_open');
    });
  }

  window.addEventListener('message', (e) => {
    if (!EMBEDDABLE.includes(e.origin) || completed) return;
    if (isBookingConfirmation(e.origin, e.data)) {
      completed = true;
      track('booking_completed');
    }
  });

  dialog.querySelector('[data-booking-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('lightbox-open');
    opener?.focus({ preventScroll: true });
  });
}
