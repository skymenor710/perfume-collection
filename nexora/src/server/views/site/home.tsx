import type { SiteContent } from '../../lib/content';
import { BUDGETS, PROJECT_TYPES, TIMELINES, rows, whatsappHref } from '../../lib/content';
import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import { ArrowUpRight, ChevronLeft, ChevronRight, CloseIcon, ExpandIcon, ExternalIcon, MouseIcon, CheckIcon, AlertIcon, ZoomIcon } from '../icons';
import { BookingCta, Footer, Header, bookingLink } from '../layout';
import { DOOR, FAR, FRONT_L, FRONT_R, MID, RIDGE, TRAIL } from './landscape-paths';

export const FORM_TOKEN_PLACEHOLDER = '__NX_FORM_TOKEN__';

export interface HomeProps {
  content: SiteContent;
  projects: ProjectWithImages[];
  /** Emplacements « à compléter » visibles (hors production) pour la preuve sociale et les témoignages. */
  showPlaceholders?: boolean;
}

/**
 * Page d'accueil orientée acquisition : promesse → preuve → offre → méthode → études de cas → témoignages → FAQ →
 * contact. Tous les textes viennent de Admin › Contenus ; la preuve sociale et les témoignages n'affichent que des
 * données réelles (sections masquées tant qu'elles sont vides).
 */
export const HomePage = ({ content, projects, showPlaceholders = false }: HomeProps) => (
  <>
    <Header content={content} />
    <main id="contenu">
      <Hero content={content} />
      <ProofBand content={content} showPlaceholders={showPlaceholders} />
      <Services content={content} />
      <Method content={content} />
      <Projects content={content} projects={projects} />
      <Testimonials content={content} showPlaceholders={showPlaceholders} />
      <Faq content={content} />
      <Contact content={content} />
    </main>
    <Footer content={content} />
    {projects.some((p) => p.images.length > 0) ? <Lightbox /> : null}
  </>
);

/** Titre de section en deux parties, la seconde en vin. */
const SectionTitle = ({ id, before, highlight }: { id: string; before: string; highlight: string }) => (
  <h2 class="section-title" id={id}>
    {before ? <>{before} </> : null}
    {highlight ? <em class="accent">{highlight}</em> : null}
  </h2>
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
            <BookingCta content={content} label={h.primaryCta} class="btn btn--primary btn--lg hero__cta-primary" />
            <a class="btn btn--outline btn--lg hero__cta-secondary" href="#realisations">
              <span>{h.secondaryCta}</span>
              <ArrowUpRight />
            </a>
          </div>
          {h.reassurance ? <p class="hero__reassurance">{h.reassurance}</p> : null}
        </div>
        <SymbolVisual />
      </div>
      <div class="container hero__foot">
        <a class="scroll-cue" href="#services" aria-label="Découvrir nos services">
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

/**
 * Preuve sociale : uniquement des chiffres RÉELS saisis dans l'admin. Vide → rien n'est affiché aux visiteurs ;
 * hors production, des emplacements « à compléter » signalent où mettre les données.
 */
const ProofBand = ({ content, showPlaceholders }: { content: SiteContent; showPlaceholders: boolean }) => {
  const items = rows(content.proof, 'item', 4, ['Value', 'Label'] as const).filter((r) => r.Value && r.Label);
  if (!items.length && !showPlaceholders) return null;
  return (
    <section class="proof" aria-labelledby="proof-title">
      <div class="container">
        <h2 class="sr-only" id="proof-title">
          {content.proof.title || 'En quelques chiffres'}
        </h2>
        {items.length ? (
          <ul class="proof__list" role="list">
            {items.map((r) => (
              <li class="proof__item">
                <span class="proof__value">{r.Value}</span>
                <span class="proof__label">{r.Label}</span>
              </li>
            ))}
          </ul>
        ) : (
          // EMPLACEMENT À COMPLÉTER (jamais affiché en production) : chiffres réels uniquement.
          <ul class="proof__list proof__list--placeholder" role="list" data-placeholder="proof">
            {[1, 2, 3, 4].map((n) => (
              <li class="proof__item placeholder">
                <span class="proof__value">—</span>
                <span class="proof__label">Chiffre réel n° {n} à compléter (Admin › Contenus › Preuve sociale)</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const SERVICE_TYPES = ['Site vitrine', 'Refonte de site', 'Site e-commerce', 'Automatisation et outils digitaux'] as const;

const Services = ({ content }: { content: SiteContent }) => {
  const sv = content.services;
  const items = rows(sv, 's', 4, ['Title', 'Text'] as const);
  return (
    <section class="services section" id="services" aria-labelledby="services-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <SectionTitle id="services-title" before={sv.title} highlight={sv.titleHighlight} />
          {sv.subtitle ? <p class="section-lead">{sv.subtitle}</p> : null}
        </header>
        <ul class="services__grid" role="list">
          {items.map((it, i) =>
            it.Title ? (
              <li class="service" data-reveal>
                <span class="service__index" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 class="service__title">{it.Title}</h3>
                {it.Text ? <p class="service__text">{it.Text}</p> : null}
                {sv.cta ? (
                  <a class="service__link" href="#contact" data-project-type={SERVICE_TYPES[i]}>
                    {sv.cta}
                    <span class="sr-only"> : {it.Title}</span>
                    <ArrowUpRight size={16} />
                  </a>
                ) : null}
              </li>
            ) : null,
          )}
        </ul>
      </div>
    </section>
  );
};

const Method = ({ content }: { content: SiteContent }) => {
  const m = content.method;
  const steps = rows(m, 'm', 3, ['Title', 'Text'] as const).filter((r) => r.Title);
  return (
    <section class="method section" id="methode" aria-labelledby="method-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <SectionTitle id="method-title" before={m.title} highlight={m.titleHighlight} />
          {m.subtitle ? <p class="section-lead">{m.subtitle}</p> : null}
        </header>
        <ol class="method__steps">
          {steps.map((st, i) => (
            <li class="step" data-reveal>
              <span class="step__num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 class="step__title">
                <span class="sr-only">Étape {i + 1} : </span>
                {st.Title}
              </h3>
              {st.Text ? <p class="step__text">{st.Text}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

const Projects = ({ content, projects }: HomeProps) => {
  const p = content.projects;
  return (
    <section class="projects section" id="realisations" aria-labelledby="projects-title">
      <div class="container">
        <header class="section-head" data-reveal>
          {p.eyebrow ? <p class="eyebrow">{p.eyebrow}</p> : null}
          <h2 class="section-title" id="projects-title">
            {p.titleLine1 ? <span class="section-title__line">{p.titleLine1}</span> : null}
            <span class="section-title__line">
              {p.titleLine2Before ? <>{p.titleLine2Before} </> : null}
              {p.titleLine2Highlight ? <em class="accent">{p.titleLine2Highlight}</em> : null}
            </span>
          </h2>
          {p.subtitle ? <p class="section-lead">{p.subtitle}</p> : null}
        </header>
        {projects.length ? (
          <ol class="cases" role="list">
            {projects.map((project, i) => (
              <li>
                <CaseStudy project={project} index={i} visitLabel={p.visitLabel} caseLabel={p.caseLabel} />
              </li>
            ))}
          </ol>
        ) : (
          <p class="projects__empty">{p.emptyText}</p>
        )}
      </div>
    </section>
  );
};

type Img = ProjectWithImages['images'][number];
const srcsets = (img: Img) => {
  const set = (fmt: 'avif' | 'webp') =>
    img.variants
      .filter((v) => v.format === fmt)
      .sort((a, b) => a.width - b.width)
      .map((v) => `/media/${img.id}/${v.width}.${fmt} ${v.width}w`)
      .join(', ');
  return { avif: set('avif'), webp: set('webp'), src: `/media/${img.id}/${pickVariant(img.variants, 'webp', 1200).width}.webp` };
};

/**
 * Étude de cas : visuel (clic = visionneuse plein écran) + contexte / solution / résultats. Les concepts portent la
 * mention « Concept / Démonstration » et n'affichent jamais de résultat chiffré. Un vrai projet se remplit dans
 * Admin › Projets, sans toucher au code.
 */
const CaseStudy = ({ project, index, visitLabel, caseLabel }: { project: ProjectWithImages; index: number; visitLabel: string; caseLabel: string }) => {
  const imgs = project.images;
  const id = `cas-${index + 1}`;
  const cover = imgs[0];
  const coverSet = cover ? srcsets(cover) : null;
  const coverSizes = '(max-width: 960px) calc(100vw - 40px), 56vw';
  const results = project.results.trim();
  return (
    <article class={`case${index % 2 ? ' case--flip' : ''}`} aria-labelledby={`${id}-title`} data-reveal>
      <div class="case__media" data-gallery={imgs.length ? project.name : undefined}>
        {cover && coverSet ? (
          <button
            class="case__cover"
            type="button"
            data-shot-open="0"
            aria-label={`Agrandir l’image 1 sur ${imgs.length} : ${cover.alt}`}
            {...(imgs.length === 1 ? { 'data-shot': '', 'data-avif': coverSet.avif, 'data-webp': coverSet.webp, 'data-src': coverSet.src, 'data-alt': cover.alt } : {})}
          >
            <picture>
              <source type="image/avif" srcset={coverSet.avif} sizes={coverSizes} />
              <img src={coverSet.src} srcset={coverSet.webp} sizes={coverSizes} width={cover.width} height={cover.height} alt="" loading="lazy" decoding="async" />
            </picture>
            <span class="case__zoom" aria-hidden="true">
              <ExpandIcon />
            </span>
          </button>
        ) : (
          <div class="case__empty">
            <img src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="" />
            <span>Visuel à venir</span>
          </div>
        )}
        {imgs.length > 1 ? (
          <ul class="case__thumbs" role="list" aria-label={`Captures du projet ${project.name}`}>
            {imgs.map((img, k) => {
              const set = srcsets(img);
              const thumb = pickVariant(img.variants, 'webp', 480);
              return (
                <li>
                  <button
                    class="case__thumb"
                    type="button"
                    data-shot
                    data-shot-open={String(k)}
                    data-avif={set.avif}
                    data-webp={set.webp}
                    data-src={set.src}
                    data-alt={img.alt}
                    aria-label={`Agrandir l’image ${k + 1} sur ${imgs.length} : ${img.alt}`}
                  >
                    <img src={`/media/${img.id}/${thumb.width}.webp`} width={thumb.width} height={thumb.height} alt="" loading="lazy" decoding="async" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div class="case__body">
        <p class="case__meta">
          {project.isDemo ? <span class="badge-demo">Concept / Démonstration</span> : <span class="badge-client">Projet client</span>}
          {project.category ? <span class="case__category">{project.category}</span> : null}
        </p>
        <h3 class="case__title" id={`${id}-title`}>
          {project.name}
        </h3>
        {project.description ? <p class="case__desc">{project.description}</p> : null}
        <dl class="case__facts">
          {project.challenge ? (
            <div>
              <dt>Contexte / défi</dt>
              <dd>{project.challenge}</dd>
            </div>
          ) : null}
          {project.solution ? (
            <div>
              <dt>Solution apportée</dt>
              <dd>{project.solution}</dd>
            </div>
          ) : null}
          {results ? (
            <div class="case__results">
              <dt>Résultats mesurables</dt>
              <dd>{results}</dd>
            </div>
          ) : project.isDemo ? (
            <div class="case__results case__results--none">
              <dt>Résultats mesurables</dt>
              <dd>Concept non mis en ligne : aucun résultat mesuré à ce jour.</dd>
            </div>
          ) : null}
        </dl>
        <div class="case__actions">
          {project.caseUrl ? (
            <a class="btn btn--primary btn--sm" href={project.caseUrl} target="_blank" rel="noopener noreferrer">
              <span>{caseLabel}</span>
              <span class="sr-only"> : {project.name} (nouvel onglet)</span>
              <ArrowUpRight size={16} />
            </a>
          ) : null}
          {project.url ? (
            <a class="btn btn--outline btn--sm" href={project.url} target="_blank" rel="noopener noreferrer nofollow">
              <span>{visitLabel}</span>
              <span class="sr-only"> : {project.name} (nouvel onglet)</span>
              <ExternalIcon />
            </a>
          ) : null}
          {imgs.length ? (
            <button class="btn btn--ghost btn--sm" type="button" data-lightbox-open aria-label={`Voir les ${imgs.length} captures du projet ${project.name} en plein écran`}>
              <span>{imgs.length > 1 ? `Voir les ${imgs.length} captures` : 'Voir la capture'}</span>
              <ExpandIcon />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
};

/** Témoignages : uniquement des citations RÉELLES saisies dans l'admin (accord écrit). Vide → masqué en production. */
const Testimonials = ({ content, showPlaceholders }: { content: SiteContent; showPlaceholders: boolean }) => {
  const t = content.testimonials;
  const items = rows(t, 't', 3, ['Quote', 'Author', 'Role'] as const).filter((r) => r.Quote && r.Author);
  if (!items.length && !showPlaceholders) return null;
  return (
    <section class="testimonials section" id="temoignages" aria-labelledby="testimonials-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <h2 class="section-title" id="testimonials-title">
            {t.title}
          </h2>
        </header>
        {items.length ? (
          <ul class="testimonials__grid" role="list">
            {items.map((r) => (
              <li data-reveal>
                <figure class="quote">
                  <blockquote>
                    <p>{r.Quote}</p>
                  </blockquote>
                  <figcaption>
                    <span class="quote__author">{r.Author}</span>
                    {r.Role ? <span class="quote__role">{r.Role}</span> : null}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        ) : (
          // EMPLACEMENT À COMPLÉTER (jamais affiché en production) : aucun nom, entreprise ni citation inventés.
          <ul class="testimonials__grid" role="list" data-placeholder="testimonials">
            {[1, 2, 3].map((n) => (
              <li>
                <figure class="quote placeholder">
                  <blockquote>
                    <p>Témoignage client réel n° {n} à compléter (citation exacte, avec l’accord écrit du client).</p>
                  </blockquote>
                  <figcaption>
                    <span class="quote__author">Nom du client</span>
                    <span class="quote__role">Fonction · Entreprise — Admin › Contenus › Témoignages</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const Faq = ({ content }: { content: SiteContent }) => {
  const f = content.faq;
  const items = rows(f, 'q', 6, ['Question', 'Answer'] as const).filter((r) => r.Question && r.Answer);
  if (!items.length) return null;
  return (
    <section class="faq section" id="faq" aria-labelledby="faq-title">
      <div class="container faq__inner">
        <header class="section-head" data-reveal>
          <SectionTitle id="faq-title" before={f.title} highlight={f.titleHighlight} />
        </header>
        <div class="faq__list">
          {items.map((r) => (
            <details class="faq__item">
              <summary>
                <h3 class="faq__q">{r.Question}</h3>
                <span class="faq__icon" aria-hidden="true"></span>
              </summary>
              <p class="faq__a">{r.Answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
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
  const wa = whatsappHref(c);
  const booking = bookingLink(content);
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
          {c.responsePromise ? (
            <p class="contact__promise">
              <CheckIcon />
              <span>{c.responsePromise}</span>
            </p>
          ) : null}
          {booking.external || wa || c.publicEmail || c.publicPhone ? (
            <div class="contact__alt">
              <p class="contact__alt-title">Vous préférez échanger directement ?</p>
              <div class="contact__alt-actions">
                {booking.external ? (
                  <a class="btn btn--light btn--sm" href={booking.href} target="_blank" rel="noopener">
                    <span>{c.bookingLabel}</span>
                    <span class="sr-only"> (nouvel onglet)</span>
                    <ArrowUpRight size={16} />
                  </a>
                ) : null}
                {wa ? (
                  <a class="btn btn--outline btn--sm" href={wa} target="_blank" rel="noopener">
                    <span>Écrire sur WhatsApp</span>
                    <span class="sr-only"> (nouvel onglet)</span>
                    <ArrowUpRight size={16} />
                  </a>
                ) : null}
              </div>
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
