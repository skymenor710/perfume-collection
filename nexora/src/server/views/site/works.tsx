import type { SiteContent } from '../../lib/content';
import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import { ArrowUpRight, ChevronLeft, ChevronRight, ExpandIcon, ExternalIcon } from '../icons';
import { SectionTitle } from './sections';

/**
 * « Nos réalisations » : projets clients (résultats vérifiables, témoignage autorisé) puis concepts (objectif de
 * conversion, jamais de résultats). Chaque carte affiche son statut ; le sous-titre explique la différence.
 */
export const Realisations = ({ content, projects }: { content: SiteContent; projects: ProjectWithImages[] }) => {
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
