import type { SiteContent } from '../../lib/content';
import { SERVICE_PROJECT_TYPES, rows } from '../../lib/content';
import type { TeamPhoto } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import { ArrowUpRight } from '../icons';

/** Titre de section en deux parties, la seconde en vin. */
export const SectionTitle = ({ id, before, highlight }: { id: string; before: string; highlight: string }) => (
  <h2 class="section-title" id={id}>
    {before ? <>{before} </> : null}
    {highlight ? <em class="accent">{highlight}</em> : null}
  </h2>
);

/**
 * « En quelques chiffres » : affichée UNIQUEMENT si au moins un chiffre réel (valeur + légende) est saisi dans
 * Admin › Contenus › Preuve sociale. Sinon la section n'existe pas dans la page (aucun texte de remplacement).
 */
export const ProofBand = ({ content }: { content: SiteContent }) => {
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

export const Services = ({ content }: { content: SiteContent }) => {
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

export const Method = ({ content }: { content: SiteContent }) => {
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
export const Team = ({ content, photo }: { content: SiteContent; photo: TeamPhoto | null }) => {
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
 * Témoignages : uniquement des citations RÉELLES saisies dans l'admin (citation exacte, nom et fonction réels, accord
 * écrit). Vide → la section n'existe pas dans la page.
 */
export const Testimonials = ({ content }: { content: SiteContent }) => {
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

export const Faq = ({ content }: { content: SiteContent }) => {
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
