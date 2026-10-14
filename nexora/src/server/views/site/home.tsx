import type { SiteContent } from '../../lib/content';
import { PROJECT_TYPES, defaultContent } from '../../lib/content';

// Le sur-titre par défaut annonce des démonstrations : il disparaît dès qu'un vrai projet est affiché.
const DEMO_EYEBROW = defaultContent.projects.eyebrow;
import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import { ArrowUpRight, ChevronLeft, ChevronRight, CloseIcon, ExpandIcon, ExternalIcon, MouseIcon, CheckIcon, AlertIcon, ZoomIcon } from '../icons';
import { Footer, Header } from '../layout';
import { DOOR, FAR, FRONT_L, FRONT_R, MID, RIDGE, TRAIL } from './landscape-paths';

export const FORM_TOKEN_PLACEHOLDER = '__NX_FORM_TOKEN__';

export interface HomeProps {
  content: SiteContent;
  projects: ProjectWithImages[];
}

export const HomePage = ({ content, projects }: HomeProps) => (
  <>
    <Header content={content} />
    <main id="contenu">
      <Hero content={content} />
      <Projects content={content} projects={projects} />
      <Contact content={content} />
    </main>
    <Footer content={content} />
    {projects.some((p) => p.images.length > 0) ? <Lightbox /> : null}
  </>
);

const Hero = ({ content }: { content: SiteContent }) => {
  const h = content.hero;
  return (
    <section class="hero" id="accueil" aria-labelledby="hero-title" data-hero>
      <div class="hero__bg" aria-hidden="true" data-parallax-bg>
        <span class="hero__glow hero__glow--a"></span>
        <span class="hero__glow hero__glow--b"></span>
        <span class="hero__beam"></span>
        <span class="hero__streak"></span>
      </div>
      <div class="container hero__grid">
        <div class="hero__copy">
          <h1 class="hero__title" id="hero-title">
            {h.titleBefore ? <span>{h.titleBefore} </span> : null}
            {h.titleHighlight ? <em class="accent">{h.titleHighlight}</em> : null}
            {h.titleAfter ? <span> {h.titleAfter}</span> : null}
          </h1>
          {h.subtitle ? <p class="hero__lead">{h.subtitle}</p> : null}
          <div class="hero__actions">
            <a class="btn btn--primary btn--lg hero__cta-primary" href="#realisations">
              <span>{h.primaryCta}</span>
              <ArrowUpRight />
            </a>
            <a class="btn btn--outline btn--lg hero__cta-secondary" href="#contact" data-open-contact>
              <span>{h.secondaryCta}</span>
              <ArrowUpRight />
            </a>
          </div>
        </div>
        <SymbolVisual />
      </div>
      <div class="container hero__foot" aria-hidden="false">
        <a class="scroll-cue" href="#realisations" aria-label={h.primaryCta}>
          <MouseIcon />
        </a>
        <div class="scroll-line" aria-hidden="true">
          <span class="scroll-line__fill" data-scroll-progress></span>
        </div>
      </div>
    </section>
  );
};

/** Symbole N reconstruit en 4K (assets-src/logo4k) : variantes AVIF + WebP de 320 à 1600 px. */
const SYMBOL_SIZES = '(max-width: 860px) min(64vw, 380px), min(36vw, 540px)';
const symbolSrcset = (fmt: 'avif' | 'webp') =>
  [320, 480, 640, 960, 1280, 1600].map((w) => `/brand/symbol-${w}.${fmt} ${w}w`).join(', ');

const SymbolPicture = ({ priority }: { priority?: boolean }) => (
  <picture>
    <source type="image/avif" srcset={symbolSrcset('avif')} sizes={SYMBOL_SIZES} />
    <img
      class={priority ? 'symbol__img' : undefined}
      src="/brand/symbol-960.webp"
      srcset={symbolSrcset('webp')}
      sizes={SYMBOL_SIZES}
      width="2805"
      height="2915"
      alt=""
      fetchpriority={priority ? 'high' : undefined}
      decoding="async"
    />
  </picture>
);

/**
 * Le symbole N : calques superposés —
 *  - l'image 4K (géométrie du fichier HD, rendu du bandeau),
 *  - un reflet néon fin qui parcourt la bande vin, découpé par son tracé vectoriel exact (aucun débordement),
 *  - un reflet au sol (mêmes fichiers, retournés et estompés : aucune requête supplémentaire).
 */
const SymbolVisual = () => (
  <div class="hero__visual" aria-hidden="true">
    <div class="symbol" data-parallax-symbol>
      <span class="symbol__halo"></span>
      <div class="symbol__stage">
        <SymbolPicture priority />
        <span class="symbol__neon" data-neon>
          <span class="symbol__neon-band"></span>
        </span>
      </div>
      <div class="symbol__reflection">
        <SymbolPicture />
      </div>
    </div>
  </div>
);

const Projects = ({ content, projects }: HomeProps) => {
  const p = content.projects;
  const allDemo = projects.length > 0 && projects.every((x) => x.isDemo);
  return (
    <section class="projects" id="realisations" aria-labelledby="projects-title">
      <div class="container">
        <header class="section-head" data-reveal>
          {p.eyebrow && (allDemo || p.eyebrow !== DEMO_EYEBROW) ? <p class="eyebrow">{p.eyebrow}</p> : null}
          <h2 class="section-title" id="projects-title">
            {p.titleLine1 ? <span class="section-title__line">{p.titleLine1}</span> : null}
            <span class="section-title__line">
              {p.titleLine2Before ? <>{p.titleLine2Before} </> : null}
              {p.titleLine2Highlight ? <em class="accent">{p.titleLine2Highlight}</em> : null}
            </span>
          </h2>
          {p.subtitle ? <p class="section-lead">{p.subtitle}</p> : null}
        </header>
      </div>
      <div class="container container--wide">
        {projects.length ? (
          <ul class={`project-grid project-grid--${projects.length}`} role="list">
            {projects.map((project, i) => (
              <li class="project-grid__item">
                <ProjectCard project={project} index={i} visitLabel={p.visitLabel} />
              </li>
            ))}
          </ul>
        ) : (
          <p class="projects__empty">{p.emptyText}</p>
        )}
      </div>
    </section>
  );
};

const ProjectCard = ({ project, index, visitLabel }: { project: ProjectWithImages; index: number; visitLabel: string }) => {
  const imgs = project.images;
  const id = `carousel-${index + 1}`;
  const multi = imgs.length > 1;
  return (
    <article class="project-card" data-reveal aria-labelledby={`${id}-title`}>
      <div
        class={`carousel${multi ? ' carousel--multi' : ''}`}
        id={id}
        role="region"
        aria-roledescription="carrousel"
        aria-label={`Images du projet ${project.name}`}
        data-carousel={multi ? '' : undefined}
        data-gallery={imgs.length > 0 ? project.name : undefined}
      >
        {imgs.length === 0 ? (
          <div class="carousel__empty">
            <img src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="" />
            <span>Visuel à venir</span>
          </div>
        ) : (
          <div class="carousel__viewport" tabindex={multi ? 0 : undefined} aria-label={multi ? 'Utilisez les flèches du clavier pour changer d’image' : undefined} data-carousel-viewport>
            <div class="carousel__track">
              {imgs.map((img, i) => {
                const avif = img.variants.filter((v) => v.format === 'avif').sort((a, b) => a.width - b.width);
                const webp = img.variants.filter((v) => v.format === 'webp').sort((a, b) => a.width - b.width);
                const fallback = pickVariant(img.variants, 'webp', 800);
                const sizes = '(max-width: 640px) calc(100vw - 40px), (max-width: 1024px) 46vw, 430px';
                const src = `/media/${img.id}/${fallback.width}.webp`;
                const avifSet = avif.map((v) => `/media/${img.id}/${v.width}.avif ${v.width}w`).join(', ');
                const webpSet = webp.map((v) => `/media/${img.id}/${v.width}.webp ${v.width}w`).join(', ');
                return (
                  <div
                    class="carousel__slide"
                    role="group"
                    aria-roledescription="diapositive"
                    aria-label={`${i + 1} sur ${imgs.length}`}
                    data-slide={i}
                  >
                    {i === 0 ? (
                      <picture>
                        <source type="image/avif" srcset={avifSet} sizes={sizes} />
                        <img src={src} srcset={webpSet} sizes={sizes} width={img.width} height={img.height} alt={img.alt} loading="lazy" decoding="async" />
                      </picture>
                    ) : (
                      // Images suivantes : chargées seulement quand le visiteur utilise CE carrousel (voir carousel.ts).
                      <picture data-deferred>
                        <source type="image/avif" data-srcset={avifSet} sizes={sizes} />
                        <img data-src={src} data-srcset={webpSet} sizes={sizes} width={img.width} height={img.height} alt={img.alt} decoding="async" />
                        <noscript>
                          <img src={src} width={img.width} height={img.height} alt={img.alt} loading="lazy" />
                        </noscript>
                      </picture>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {project.isDemo ? <span class="badge-demo">Démonstration</span> : null}
        {imgs.length > 0 ? (
          <button class="carousel__expand" type="button" data-lightbox-open aria-label={`Agrandir les images du projet ${project.name}`}>
            <ExpandIcon />
          </button>
        ) : null}
        {multi ? (
          <>
            <button class="carousel__btn carousel__btn--prev" type="button" aria-controls={id} aria-label="Image précédente" data-carousel-prev>
              <ChevronLeft />
            </button>
            <button class="carousel__btn carousel__btn--next" type="button" aria-controls={id} aria-label="Image suivante" data-carousel-next>
              <ChevronRight />
            </button>
            <div class="carousel__dots" role="group" aria-label="Choisir une image">
              {imgs.map((_, i) => (
                <button class="carousel__dot" type="button" aria-label={`Image ${i + 1} sur ${imgs.length}`} aria-current={i === 0 ? 'true' : undefined} data-carousel-dot={i}>
                  <span></span>
                </button>
              ))}
            </div>
            <p class="sr-only" aria-live="polite" aria-atomic="true" data-carousel-status></p>
          </>
        ) : null}
      </div>
      <div class="project-card__body">
        <h3 class="project-card__title" id={`${id}-title`}>
          {project.name}
        </h3>
        {project.category ? <p class="project-card__meta">{project.category}</p> : null}
        {project.description ? <p class="project-card__desc">{project.description}</p> : null}
        {project.url ? (
          <a class="project-card__link" href={project.url} target="_blank" rel="noopener noreferrer nofollow">
            {visitLabel}
            <span class="sr-only"> : {project.name} (nouvel onglet)</span>
            <ExternalIcon />
          </a>
        ) : null}
      </div>
    </article>
  );
};

/**
 * Visionneuse plein écran des captures (une seule pour la page) : <dialog> natif — fond inerte, piège du focus et
 * touche Échap fournis par le navigateur. Remplie par src/client/lightbox.ts à partir du carrousel cliqué.
 */
const Lightbox = () => (
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

const Contact = ({ content }: { content: SiteContent }) => {
  const c = content.contact;
  return (
    <section class="contact" id="contact" aria-labelledby="contact-title">
      <Landscape />
      <div class="container contact__inner">
        <div class="contact__intro" data-reveal>
          <h2 class="contact__title" id="contact-title">
            {c.titleLine1 ? <span class="section-title__line">{c.titleLine1}</span> : null}
            {c.titleHighlight ? <em class="accent section-title__line">{c.titleHighlight}</em> : null}
          </h2>
          {c.text ? <p class="contact__lead">{c.text}</p> : null}
          <button class="btn btn--light btn--xl contact__toggle" type="button" aria-controls="formulaire-contact" aria-expanded="false" data-contact-toggle>
            <span>{c.cta}</span>
            <ArrowUpRight size={20} />
          </button>
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
        <ContactForm successMessage={c.successMessage} />
      </div>
    </section>
  );
};

const ContactForm = ({ successMessage }: { successMessage: string }) => (
  <div class="contact-panel" id="formulaire-contact" data-contact-panel>
    <form class="contact-form" method="post" action="/contact" novalidate data-contact-form data-success={successMessage}>
      <h3 class="contact-form__title">Votre projet</h3>
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
          <label for="cf-company">Entreprise <span class="field__opt">(facultatif)</span></label>
          <input id="cf-company" name="company" type="text" maxlength={160} autocomplete="organization" />
        </div>
        <div class="field">
          <label for="cf-email">E-mail *</label>
          <input id="cf-email" name="email" type="email" required maxlength={160} autocomplete="email" inputmode="email" aria-describedby="cf-email-err" />
          <p class="field__error" id="cf-email-err" data-error-for="email"></p>
        </div>
        <div class="field">
          <label for="cf-phone">Téléphone <span class="field__opt">(facultatif)</span></label>
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
        <div class="field field--full">
          <label for="cf-message">Message *</label>
          <textarea id="cf-message" name="message" required minlength={10} maxlength={4000} rows={5} aria-describedby="cf-message-err"></textarea>
          <p class="field__error" id="cf-message-err" data-error-for="message"></p>
        </div>
      </div>
      <p class="contact-form__privacy">
        Vos informations sont utilisées uniquement pour répondre à votre demande et ne sont jamais cédées à des tiers. Aucune
        inscription à une liste de diffusion. Pour en savoir plus et exercer vos droits, consultez notre{' '}
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
