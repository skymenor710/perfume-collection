import { ChevronLeft, ChevronRight, CloseIcon, ZoomIcon } from '../icons';

/**
 * Visionneuse plein écran des captures (une seule pour la page) : <dialog> natif — fond inerte, piège du focus et
 * touche Échap fournis par le navigateur. Remplie par src/client/lightbox.ts à partir du carrousel cliqué.
 */
export const Lightbox = () => (
  <dialog class="lightbox" aria-labelledby="lightbox-title" data-lightbox>
    <div class="lightbox__bar">
      <p class="lightbox__title" id="lightbox-title" data-lightbox-title></p>
      <p class="lightbox__count" data-lightbox-count></p>
      <div class="lightbox__tools">
        <button class="lightbox__tool" type="button" aria-pressed="false" aria-label="Zoomer" data-lightbox-zoom>
          <ZoomIcon />
        </button>
        <button class="lightbox__tool" type="button" aria-label="Fermer la visionneuse" data-lightbox-close>
          <CloseIcon />
        </button>
      </div>
    </div>
    <div class="lightbox__stage" data-lightbox-stage>
      <div class="lightbox__frame" data-lightbox-frame></div>
    </div>
    <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Image précédente" data-lightbox-prev>
      <ChevronLeft />
    </button>
    <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Image suivante" data-lightbox-next>
      <ChevronRight />
    </button>
    <p class="lightbox__caption" data-lightbox-caption></p>
    <p class="sr-only" aria-live="polite" aria-atomic="true" data-lightbox-status></p>
  </dialog>
);

/**
 * Fenêtre de réservation (Cal.com / Calendly) : ouverte par les boutons « Réserver… » quand le lien de rendez-vous
 * appartient à l'un de ces services (src/client/booking.ts) ; sinon le lien s'ouvre dans un nouvel onglet. L'iframe
 * n'est chargée qu'à l'ouverture. Réservation confirmée → événement « booking_completed ».
 */
export const BookingDialog = ({ label }: { label: string }) => (
  <dialog class="booking" aria-labelledby="booking-title" data-booking-dialog>
    <div class="booking__bar">
      <p class="booking__title" id="booking-title">
        {label}
      </p>
      <a class="booking__external" href="#" target="_blank" rel="noopener" data-booking-external>
        Ouvrir dans un nouvel onglet
      </a>
      <button class="lightbox__tool" type="button" aria-label="Fermer la réservation" data-booking-close>
        <CloseIcon />
      </button>
    </div>
    <div class="booking__frame" data-booking-frame></div>
  </dialog>
);

/**
 * Consentement à la mesure d'audience (RGPD / CNIL) : affiché seulement si un outil est configuré ; rien n'est chargé
 * avant « Accepter ». Le choix est mémorisé dans le navigateur et modifiable depuis le pied de page.
 */
export const ConsentBanner = ({ provider, domain, script }: { provider: string; domain: string; script: string }) => (
  <div class="consent" role="region" aria-label="Mesure d’audience" hidden data-consent data-provider={provider} data-domain={domain} data-script={script}>
    <p class="consent__text">
      Nous aimerions mesurer l’audience de ce site (pages vues, clics sur les boutons) pour l’améliorer. Aucune donnée
      n’est collectée sans votre accord. <a href="/politique-de-confidentialite">En savoir plus</a>
    </p>
    <div class="consent__actions">
      <button class="btn btn--outline btn--sm" type="button" data-consent-choice="denied">
        Refuser
      </button>
      <button class="btn btn--light btn--sm" type="button" data-consent-choice="granted">
        Accepter
      </button>
    </div>
  </div>
);
