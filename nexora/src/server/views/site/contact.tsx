import type { SiteContent } from '../../lib/content';
import { BUDGETS, PROJECT_TYPES, TIMELINES, whatsappHref } from '../../lib/content';
import { ArrowUpRight, CheckIcon, AlertIcon } from '../icons';
import { bookingLink } from '../layout';
import { DOOR, FAR, FRONT_L, FRONT_R, MID, RIDGE, TRAIL } from './landscape-paths';

export const FORM_TOKEN_PLACEHOLDER = '__NX_FORM_TOKEN__';

export const Contact = ({ content }: { content: SiteContent }) => {
  const c = content.contact;
  const wa = whatsappHref(c);
  const booking = bookingLink(content);
  return (
    <section class="contact" id="contact" aria-labelledby="contact-title">
      <Landscape />
      <div class="container contact__inner">
        <div class="contact__intro" data-reveal>
          <h2 class="contact__title" id="contact-title">
            {c.titleLine1 ? <span class="section-title__line">{c.titleLine1} </span> : null}
            {c.titleHighlight ? <em class="accent section-title__line">{c.titleHighlight}</em> : null}
          </h2>
          {c.text ? <p class="contact__lead">{c.text}</p> : null}
          {c.responsePromise ? (
            <p class="contact__promise">
              <CheckIcon />
              <span>{c.responsePromise}</span>
            </p>
          ) : null}
          {booking.external ? (
            <div class="contact__booking">
              <p class="contact__alt-title">Vous préférez échanger de vive voix ?</p>
              {c.bookingText ? <p class="contact__booking-text">{c.bookingText}</p> : null}
              <a class="btn btn--light btn--sm" href={booking.href} target="_blank" rel="noopener" data-booking data-track="booking_open">
                <span>{c.bookingLabel}</span>
                <span class="sr-only"> (nouvel onglet)</span>
                <ArrowUpRight size={16} />
              </a>
            </div>
          ) : null}
          {wa || c.publicEmail || c.publicPhone ? (
            <div class="contact__alt">
              {!booking.external ? <p class="contact__alt-title">Vous préférez échanger directement ?</p> : null}
              {wa ? (
                <div class="contact__alt-actions">
                  <a class="btn btn--outline btn--sm" href={wa} target="_blank" rel="noopener" data-track="whatsapp_click">
                    <span>Écrire sur WhatsApp</span>
                    <span class="sr-only"> (nouvel onglet)</span>
                    <ArrowUpRight size={16} />
                  </a>
                </div>
              ) : null}
              {c.publicEmail || c.publicPhone ? (
                <ul class="contact__direct">
                  {c.publicEmail ? (
                    <li>
                      <a href={`mailto:${c.publicEmail}`}>{c.publicEmail}</a>
                    </li>
                  ) : null}
                  {c.publicPhone ? (
                    <li>
                      <a href={`tel:${c.publicPhone.replace(/[^+0-9]/g, '')}`}>{c.publicPhone}</a>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <ContactForm title={c.formTitle} successMessage={c.successMessage} />
      </div>
    </section>
  );
};

const Opt = () => <span class="field__opt">(facultatif)</span>;

/** Formulaire affiché directement (aucun clic pour le révéler). Champs facultatifs de qualification : budget, délai. */
const ContactForm = ({ title, successMessage }: { title: string; successMessage: string }) => (
  <div class="contact-panel" id="formulaire-contact">
    <form class="contact-form" method="post" action="/contact" novalidate data-contact-form data-success={successMessage} aria-labelledby="cf-title">
      <h3 class="contact-form__title" id="cf-title">
        {title}
      </h3>
      <p class="contact-form__hint">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
      <input type="hidden" name="token" value={FORM_TOKEN_PLACEHOLDER} />
      <div class="field field--hp" aria-hidden="true">
        <label for="cf-website">Ne pas remplir ce champ</label>
        <input id="cf-website" name="website" type="text" tabindex={-1} autocomplete="off" />
      </div>
      <div class="contact-form__grid">
        <div class="field">
          <label for="cf-name">Nom *</label>
          <input id="cf-name" name="name" type="text" required maxlength={120} autocomplete="name" aria-describedby="cf-name-err" />
          <p class="field__error" id="cf-name-err" data-error-for="name"></p>
        </div>
        <div class="field">
          <label for="cf-company">
            Entreprise <Opt />
          </label>
          <input id="cf-company" name="company" type="text" maxlength={160} autocomplete="organization" />
        </div>
        <div class="field">
          <label for="cf-email">E-mail *</label>
          <input id="cf-email" name="email" type="email" required maxlength={160} autocomplete="email" inputmode="email" aria-describedby="cf-email-err" />
          <p class="field__error" id="cf-email-err" data-error-for="email"></p>
        </div>
        <div class="field">
          <label for="cf-phone">
            Téléphone <Opt />
          </label>
          <input id="cf-phone" name="phone" type="tel" maxlength={30} autocomplete="tel" inputmode="tel" aria-describedby="cf-phone-err" />
          <p class="field__error" id="cf-phone-err" data-error-for="phone"></p>
        </div>
        <div class="field field--full">
          <label for="cf-type">Type de projet *</label>
          <div class="select">
            <select id="cf-type" name="projectType" required aria-describedby="cf-type-err">
              <option value="">Choisissez une option</option>
              {PROJECT_TYPES.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p class="field__error" id="cf-type-err" data-error-for="projectType"></p>
        </div>
        <div class="field">
          <label for="cf-budget">
            Budget estimatif <Opt />
          </label>
          <div class="select">
            <select id="cf-budget" name="budget" aria-describedby="cf-budget-err">
              <option value="">Non précisé</option>
              {BUDGETS.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p class="field__error" id="cf-budget-err" data-error-for="budget"></p>
        </div>
        <div class="field">
          <label for="cf-timeline">
            Délai souhaité <Opt />
          </label>
          <div class="select">
            <select id="cf-timeline" name="timeline" aria-describedby="cf-timeline-err">
              <option value="">Non précisé</option>
              {TIMELINES.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </div>
          <p class="field__error" id="cf-timeline-err" data-error-for="timeline"></p>
        </div>
        <div class="field field--full">
          <label for="cf-message">Message *</label>
          <textarea id="cf-message" name="message" required minlength={10} maxlength={4000} rows={5} aria-describedby="cf-message-err"></textarea>
          <p class="field__error" id="cf-message-err" data-error-for="message"></p>
        </div>
      </div>
      <p class="contact-form__privacy">
        Vos informations servent uniquement à répondre à votre demande ; elles ne sont jamais cédées à des tiers ni utilisées
        pour de la prospection. Pour en savoir plus et exercer vos droits, consultez notre{' '}
        <a href="/politique-de-confidentialite">politique de confidentialité</a>.
      </p>
      <div class="contact-form__actions">
        <button class="btn btn--primary btn--lg" type="submit" data-submit>
          <span data-submit-label>Envoyer ma demande</span>
          <ArrowUpRight />
        </button>
        <div class="form-status" role="status" aria-live="polite" data-form-status>
          <span class="form-status__icon form-status__icon--ok" hidden data-status-ok>
            <CheckIcon />
          </span>
          <span class="form-status__icon form-status__icon--err" hidden data-status-err>
            <AlertIcon />
          </span>
          <span data-status-text></span>
        </div>
      </div>
    </form>
  </div>
);

/** Illustration décorative de la section Contact : montagne, chemin lumineux vers une porte ouverte. */
const Landscape = () => (
  <div class="contact__art" aria-hidden="true">
    <span class="contact__sweep"></span>
    <svg class="landscape" viewBox="0 0 1000 460" preserveAspectRatio="xMaxYMax slice" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <defs>
        <radialGradient id="ls-sky" cx="0.86" cy="0.12" r="0.75">
          <stop offset="0" stop-color="#b2304f" stop-opacity="0.55" />
          <stop offset="0.35" stop-color="#751B35" stop-opacity="0.32" />
          <stop offset="1" stop-color="#09090C" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="ls-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a1220" />
          <stop offset="1" stop-color="#140a0e" />
        </linearGradient>
        <linearGradient id="ls-mid" x1="0.7" y1="0" x2="0.4" y2="1">
          <stop offset="0" stop-color="#4a1424" />
          <stop offset="0.45" stop-color="#241016" />
          <stop offset="1" stop-color="#0d080a" />
        </linearGradient>
        <linearGradient id="ls-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d0e13" />
          <stop offset="1" stop-color="#09090C" />
        </linearGradient>
        <linearGradient id="ls-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#982B49" stop-opacity="0" />
          <stop offset="0.7" stop-color="#d0506f" stop-opacity="0.75" />
          <stop offset="1" stop-color="#982B49" stop-opacity="0.2" />
        </linearGradient>
        <linearGradient id="ls-door" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd9e1" />
          <stop offset="1" stop-color="#ff8aa4" />
        </linearGradient>
        <filter id="ls-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="ls-glow-lg" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter id="ls-haze" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <rect width="1000" height="460" fill="url(#ls-sky)" />
      <path d={FAR} fill="url(#ls-far)" opacity="0.55" filter="url(#ls-haze)" />
      <path d={MID} fill="url(#ls-mid)" />
      <path d={RIDGE} fill="none" stroke="url(#ls-rim)" stroke-width="1.4" opacity="0.8" />
      <path d={FRONT_L} fill="url(#ls-front)" opacity="0.92" />
      <path d={FRONT_R} fill="url(#ls-front)" opacity="0.85" />
      <g class="landscape__trail">
        <path d={TRAIL} fill="none" stroke="#e0466e" stroke-width="7" stroke-linecap="round" opacity="0.55" filter="url(#ls-glow)" />
        <path class="landscape__trail-line" d={TRAIL} fill="none" stroke="#ffb3c4" stroke-width="1.8" stroke-linecap="round" pathLength="1" />
      </g>
      <g class="landscape__door">
        <rect x={DOOR.x - 14} y={DOOR.y - 10} width={DOOR.w + 28} height={DOOR.h + 20} rx="6" fill="#e0466e" opacity="0.5" filter="url(#ls-glow-lg)" />
        <path
          d={`M${DOOR.x} ${DOOR.y + 6} L${DOOR.x + DOOR.w} ${DOOR.y} L${DOOR.x + DOOR.w} ${DOOR.y + DOOR.h} L${DOOR.x} ${DOOR.y + DOOR.h + 2} Z`}
          fill="url(#ls-door)"
          opacity="0.9"
        />
        <path
          d={`M${DOOR.x} ${DOOR.y + 6} L${DOOR.x + DOOR.w} ${DOOR.y} L${DOOR.x + DOOR.w} ${DOOR.y + DOOR.h} L${DOOR.x} ${DOOR.y + DOOR.h + 2} Z`}
          fill="none"
          stroke="#ff5f84"
          stroke-width="2"
        />
      </g>
    </svg>
  </div>
);
