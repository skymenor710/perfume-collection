import type { SiteContent } from '../../lib/content';
import { BUDGETS, PROJECT_TYPES, SERVICE_PROJECT_TYPES, TIMELINES, rows, whatsappHref } from '../../lib/content';
import type { ProjectWithImages, TeamPhoto } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import type { Config } from '../../config';
import { ArrowUpRight, ChevronLeft, ChevronRight, CloseIcon, ExpandIcon, ExternalIcon, MouseIcon, CheckIcon, AlertIcon, ZoomIcon } from '../icons';
import { Footer, Header, bookingLink } from '../layout';
import { DOOR, FAR, FRONT_L, FRONT_R, MID, RIDGE, TRAIL } from './landscape-paths';

export const FORM_TOKEN_PLACEHOLDER = '__NX_FORM_TOKEN__';

export interface HomeProps {
  content: SiteContent;
  /** Projets CLIENTS publiés (badge « Projet client », résultats vérifiables). */
  results: ProjectWithImages[];
  /** Concepts / démonstrations publiés (badge « Concept / Démonstration », jamais de résultats). */
  concepts: ProjectWithImages[];
  teamPhoto?: TeamPhoto | null;
  analytics?: Config['analytics'];
}

/**
 * Page d'accueil : promesse → (preuve) → réalisations → services → processus → (équipe) → (témoignages) → FAQ →
 * contact. Le travail est montré tôt, juste après la promesse. Tous les textes viennent de Admin › Contenus. Les
 * sections de preuve (chiffres, équipe, témoignages) n'existent QUE si des données réelles sont saisies : aucun texte
 * d'exemple, d'instruction ou d'emplacement « à compléter » n'est jamais montré aux visiteurs.
 */
export const HomePage = ({ content, results, concepts, teamPhoto = null, analytics = null }: HomeProps) => {
  // Projets clients d'abord, puis concepts : chaque carte affiche son statut.
  const works = [...results, ...concepts];
  return (
    <>
      <Header content={content} />
      <main id="contenu">
        <Hero content={content} />
        <ProofBand content={content} />
        <Realisations content={content} projects={works} />
        <Services content={content} />
        <Method content={content} />
        <Team content={content} photo={teamPhoto} />
        <Testimonials content={content} />
        <Faq content={content} />
        <Contact content={content} />
      </main>
      <Footer content={content} consent={!!analytics} />
      {works.some((p) => p.images.length > 0) ? <Lightbox /> : null}
      {content.contact.bookingUrl ? <BookingDialog label={content.contact.bookingLabel} /> : null}
      {analytics ? <ConsentBanner provider={analytics.provider} domain={analytics.domain} script={analytics.scriptUrl} /> : null}
    </>
  );
};

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
          {h.audience ? <p class="hero__audience">{h.audience}</p> : null}
          <div class="hero__actions">
            {/* Toujours le formulaire de devis : ce bouton ne promet jamais une réservation. */}
            <a class="btn btn--primary btn--lg hero__cta-primary" href="#contact" data-track="cta_primary">
              <span>{h.ctaQuote}</span>
              <ArrowUpRight />
            </a>
            <a class="btn btn--outline btn--lg hero__cta-secondary" href="#realisations" data-track="cta_secondary">
              <span>{h.ctaWork}</span>
              <ArrowUpRight />
            </a>
          </div>
          {h.reassurance ? <p class="hero__reassurance">{h.reassurance}</p> : null}
        </div>
        <SymbolVisual />
      </div>
      <div class="container hero__foot">
        <a class="scroll-cue" href="#realisations" aria-label="Voir nos réalisations">
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
 * « En quelques chiffres » : affichée UNIQUEMENT si au moins un chiffre réel (valeur + légende) est saisi dans
 * Admin › Contenus › Preuve sociale. Sinon la section n'existe pas dans la page (aucun texte de remplacement).
 */
const ProofBand = ({ content }: { content: SiteContent }) => {
  const items = rows(content.proof, 'item', 4, ['Value', 'Label'] as const).filter((r) => r.Value.trim() && r.Label.trim());
  if (!items.length) return null;
  return (
    <section class="proof" aria-labelledby="proof-title">
      <div class="container">
        <h2 class="sr-only" id="proof-title">
          {content.proof.title || 'En quelques chiffres'}
        </h2>
        <ul class={`proof__list proof__list--${items.length}`} role="list">
          {items.map((r) => (
            <li class="proof__item">
              <span class="proof__value">{r.Value}</span>
              <span class="proof__label">{r.Label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

const Services = ({ content }: { content: SiteContent }) => {
  const sv = content.services;
  const items = rows(sv, 's', 5, ['Title', 'Text'] as const);
  return (
    <section class="services section" id="services" aria-labelledby="services-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <SectionTitle id="services-title" before={sv.title} highlight={sv.titleHighlight} />
          {sv.subtitle ? <p class="section-lead">{sv.subtitle}</p> : null}
        </header>
        <ul class={`services__grid services__grid--${items.filter((it) => it.Title).length}`} role="list">
          {items.map((it, i) =>
            it.Title ? (
              <li class="service" data-reveal>
                <span class="service__index" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 class="service__title">{it.Title}</h3>
                {it.Text ? <p class="service__text">{it.Text}</p> : null}
                {sv.cta ? (
                  <a class="service__link" href="#formulaire-contact" data-project-type={SERVICE_PROJECT_TYPES[i]} data-track="service_click" data-track-service={SERVICE_PROJECT_TYPES[i]}>
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
  const steps = rows(m, 'm', 4, ['Title', 'Text'] as const).filter((r) => r.Title);
  return (
    <section class="method section" id="processus" aria-labelledby="method-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <SectionTitle id="method-title" before={m.title} highlight={m.titleHighlight} />
          {m.subtitle ? <p class="section-lead">{m.subtitle}</p> : null}
        </header>
        <ol class={`method__steps method__steps--${steps.length}`}>
          {steps.map((st, i) => (
            <li class="step" data-reveal>
              <span class="step__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
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

/**
 * « Derrière Nexora » : affichée UNIQUEMENT quand un nom et un texte réels sont saisis (Admin › Contenus › Derrière
 * Nexora) ; la photo est facultative (envoyée dans l'admin). Aucune personne, parcours ni photo n'est inventé.
 */
const Team = ({ content, photo }: { content: SiteContent; photo: TeamPhoto | null }) => {
  const t = content.team;
  if (!t.name.trim() || !t.text.trim()) return null;
  const webp = photo
    ? photo.variants
        .filter((v) => v.format === 'webp')
        .sort((a, b) => a.width - b.width)
        .map((v) => `/media/${photo.id}/${v.width}.webp ${v.width}w`)
        .join(', ')
    : '';
  const avif = photo
    ? photo.variants
        .filter((v) => v.format === 'avif')
        .sort((a, b) => a.width - b.width)
        .map((v) => `/media/${photo.id}/${v.width}.avif ${v.width}w`)
        .join(', ')
    : '';
  const sizes = '(max-width: 860px) calc(100vw - 40px), 420px';
  return (
    <section class="team section" id="equipe" aria-labelledby="team-title">
      <div class={`container team__inner${photo ? '' : ' team__inner--text'}`}>
        {photo ? (
          <picture class="team__photo" data-reveal>
            <source type="image/avif" srcset={avif} sizes={sizes} />
            <img
              src={`/media/${photo.id}/${pickVariant(photo.variants, 'webp', 800).width}.webp`}
              srcset={webp}
              sizes={sizes}
              width={photo.width}
              height={photo.height}
              alt={t.photoAlt || `Photo de ${t.name}`}
              loading="lazy"
              decoding="async"
            />
          </picture>
        ) : null}
        <div class="team__body" data-reveal>
          <h2 class="section-title" id="team-title">
            {t.title}
          </h2>
          <p class="team__text">{t.text}</p>
          <p class="team__person">
            <span class="team__name">{t.name}</span>
            {t.role ? <span class="team__role">{t.role}</span> : null}
          </p>
        </div>
      </div>
    </section>
  );
};

/**
 * « Nos réalisations » : projets clients (résultats vérifiables, témoignage autorisé) puis concepts (objectif de
 * conversion, jamais de résultats). Chaque carte affiche son statut ; le sous-titre explique la différence.
 */
const Realisations = ({ content, projects }: { content: SiteContent; projects: ProjectWithImages[] }) => {
  const p = content.projects;
  return (
    <section class="projects section" id="realisations" aria-labelledby="works-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <SectionTitle id="works-title" before={p.title} highlight={p.titleHighlight} />
          {p.subtitle ? <p class="section-lead">{p.subtitle}</p> : null}
        </header>
        {projects.length ? (
          <ol class="works" role="list">
            {projects.map((project, i) => (
              <li>
                <WorkCard project={project} index={i} labels={p} />
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

// Largeur affichée de la galerie (marges latérales de 6,1vw, cadre de la carte) : pleine largeur de la carte sous
// 1024 px, colonne de gauche (≈ 59 %) au-delà, 695 px dès que le conteneur atteint sa largeur maximale (1440 px).
const GALLERY_SIZES = '(max-width: 640px) calc(87.8vw - 18px), (max-width: 1024px) calc(87.8vw - 22px), (min-width: 1440px) 700px, calc(49.5vw - 18px)';

/**
 * Galerie d'un projet, indépendante des autres : défilement horizontal natif aimanté (glisser au doigt ou au pavé
 * tactile), flèches, ← → au clavier, points indicateurs (bouton par capture, état courant annoncé). Hauteur fixe
 * 16:10 : aucun décalage de mise en page. Images différées (loading="lazy"). Clic sur une capture : visionneuse
 * plein écran (src/client/lightbox.ts). Le pilotage est dans src/client/gallery.ts ; sans JavaScript, le
 * défilement horizontal reste utilisable.
 */
const Gallery = ({ project, id }: { project: ProjectWithImages; id: string }) => {
  const imgs = project.images;
  const n = imgs.length;
  if (!n) {
    return (
      <div class="gallery gallery--empty">
        <div class="gallery__empty">
          <img src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="" />
          <span>Visuel à venir</span>
        </div>
      </div>
    );
  }
  return (
    <div
      class="gallery"
      role="region"
      aria-roledescription="carrousel"
      aria-label={`Captures du projet ${project.name}`}
      data-gallery={project.name}
      data-carousel
    >
      <div class="gallery__viewport" id={`${id}-slides`} data-carousel-viewport>
        <div class="gallery__track">
          {imgs.map((img, k) => {
            const set = srcsets(img);
            return (
              <div class="gallery__slide" role="group" aria-roledescription="diapositive" aria-label={`${k + 1} sur ${n}`} data-slide>
                <button
                  class="gallery__open"
                  type="button"
                  data-shot
                  data-shot-open={String(k)}
                  data-avif={set.avif}
                  data-webp={set.webp}
                  data-src={set.src}
                  data-alt={img.alt}
                  aria-label={`Agrandir la capture ${k + 1} sur ${n} : ${img.alt}`}
                >
                  <picture>
                    <source type="image/avif" srcset={set.avif} sizes={GALLERY_SIZES} />
                    <img src={set.src} srcset={set.webp} sizes={GALLERY_SIZES} width={img.width} height={img.height} alt="" loading="lazy" decoding="async" />
                  </picture>
                  <span class="gallery__zoom" aria-hidden="true">
                    <ExpandIcon />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {n > 1 ? (
        <div class="gallery__controls">
          <div class="gallery__dots" role="group" aria-label="Choisir une capture">
            {imgs.map((_, k) => (
              <button class="gallery__dot" type="button" aria-controls={`${id}-slides`} aria-label={`Capture ${k + 1} sur ${n}`} aria-current={k === 0 ? 'true' : undefined} data-carousel-dot={String(k)}>
                <span aria-hidden="true"></span>
              </button>
            ))}
          </div>
          <p class="gallery__count" aria-hidden="true">
            <span data-carousel-index>01</span> / {String(n).padStart(2, '0')}
          </p>
          <div class="gallery__arrows">
            <button class="gallery__arrow" type="button" aria-controls={`${id}-slides`} aria-label="Capture précédente" data-carousel-prev>
              <ChevronLeft />
            </button>
            <button class="gallery__arrow" type="button" aria-controls={`${id}-slides`} aria-label="Capture suivante" data-carousel-next>
              <ChevronRight />
            </button>
          </div>
          <p class="sr-only" aria-live="polite" aria-atomic="true" data-carousel-status></p>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Carte d'une réalisation : galerie + statut, nom, résumé court ; le détail (contexte, solution, objectif de
 * conversion ou résultats) est repliable. Le contenu affiché dépend du type, jamais l'inverse : un concept montre son
 * objectif de conversion, un projet client ses résultats vérifiables et le témoignage autorisé.
 */
const WorkCard = ({ project, index, labels }: { project: ProjectWithImages; index: number; labels: SiteContent['projects'] }) => {
  const id = `work-${index + 1}`;
  const isClient = !project.isDemo;
  const results = isClient ? project.results.trim() : '';
  const principles = project.isDemo ? project.principles.trim() : '';
  const quote = isClient ? project.testimonialQuote.trim() : '';
  // Résumé : description courte, sinon le contexte (qui n'est alors pas répété dans le détail).
  const summary = project.description.trim() || project.challenge.trim();
  const challenge = project.description.trim() ? project.challenge.trim() : '';
  const hasDetails = !!(challenge || project.solution.trim() || principles || results || quote);
  const imgs = project.images;
  return (
    <article class="work" aria-labelledby={`${id}-title`} data-work data-reveal>
      <Gallery project={project} id={id} />
      <div class="work__body">
        <p class="work__meta">
          {isClient ? <span class="badge-client">Projet client</span> : <span class="badge-demo">Concept / Démonstration</span>}
          {project.category ? <span class="work__category">{project.category}</span> : null}
        </p>
        <h3 class="work__title" id={`${id}-title`}>
          {project.name}
        </h3>
        {summary ? <p class="work__summary">{summary}</p> : null}
        {results ? (
          <p class="work__result">
            <span class="work__result-label">Résultats obtenus</span>
            {results}
          </p>
        ) : null}
        {hasDetails ? (
          <details class="work__details">
            <summary>
              <span>{labels.detailsLabel}</span>
              <span class="work__details-icon" aria-hidden="true"></span>
            </summary>
            <dl class="work__facts">
              {challenge ? (
                <div>
                  <dt>Contexte / défi</dt>
                  <dd>{challenge}</dd>
                </div>
              ) : null}
              {project.solution ? (
                <div>
                  <dt>Solution apportée</dt>
                  <dd>{project.solution}</dd>
                </div>
              ) : null}
              {principles ? (
                <div>
                  <dt>Objectif de conversion</dt>
                  <dd>{principles}</dd>
                </div>
              ) : null}
            </dl>
            {quote ? (
              <figure class="case__quote">
                <blockquote>
                  <p>“{quote}”</p>
                </blockquote>
                {project.testimonialAuthor ? <figcaption>{project.testimonialAuthor}</figcaption> : null}
              </figure>
            ) : null}
          </details>
        ) : null}
        <div class="work__actions">
          {project.caseUrl ? (
            <a class="btn btn--primary btn--sm" href={project.caseUrl} target="_blank" rel="noopener noreferrer">
              <span>{labels.caseLabel}</span>
              <span class="sr-only"> : {project.name} (nouvel onglet)</span>
              <ArrowUpRight size={16} />
            </a>
          ) : null}
          {project.url ? (
            <a class="btn btn--outline btn--sm" href={project.url} target="_blank" rel="noopener noreferrer nofollow">
              <span>{labels.visitLabel}</span>
              <span class="sr-only"> : {project.name} (nouvel onglet)</span>
              <ExternalIcon />
            </a>
          ) : null}
          {imgs.length ? (
            <button class="btn btn--ghost btn--sm" type="button" data-lightbox-open aria-label={`Voir les ${imgs.length} captures du projet ${project.name} en plein écran`}>
              <span>Plein écran</span>
              <ExpandIcon />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
};

/**
 * Témoignages : uniquement des citations RÉELLES saisies dans l'admin (citation exacte, nom et fonction réels, accord
 * écrit). Vide → la section n'existe pas dans la page.
 */
const Testimonials = ({ content }: { content: SiteContent }) => {
  const t = content.testimonials;
  const items = rows(t, 't', 3, ['Quote', 'Author', 'Role'] as const).filter((r) => r.Quote.trim() && r.Author.trim());
  if (!items.length) return null;
  return (
    <section class="testimonials section" id="temoignages" aria-labelledby="testimonials-title">
      <div class="container">
        <header class="section-head" data-reveal>
          <h2 class="section-title" id="testimonials-title">
            {t.title}
          </h2>
        </header>
        <ul class={`testimonials__grid testimonials__grid--${items.length}`} role="list">
          {items.map((r) => (
            <li data-reveal>
              <figure class="quote">
                <blockquote>
                  <p>“{r.Quote.replace(/^[“"«]\s*|\s*[”"»]$/g, '')}”</p>
                </blockquote>
                <figcaption>
                  <span class="quote__author">{r.Author}</span>
                  {r.Role ? <span class="quote__role">{r.Role}</span> : null}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

const Faq = ({ content }: { content: SiteContent }) => {
  const f = content.faq;
  const items = rows(f, 'q', 7, ['Question', 'Answer'] as const).filter((r) => r.Question && r.Answer);
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

/**
 * Fenêtre de réservation (Cal.com / Calendly) : ouverte par les boutons « Réserver… » quand le lien de rendez-vous
 * appartient à l'un de ces services (src/client/booking.ts) ; sinon le lien s'ouvre dans un nouvel onglet. L'iframe
 * n'est chargée qu'à l'ouverture. Réservation confirmée → événement « booking_completed ».
 */
const BookingDialog = ({ label }: { label: string }) => (
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
const ConsentBanner = ({ provider, domain, script }: { provider: string; domain: string; script: string }) => (
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
