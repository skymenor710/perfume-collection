import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import type { Base } from './base';
import { Field } from './field';
import { Down, Up } from './icons';
import { AdminShell, Csrf } from './layout';

export interface ProjectFormValues {
  name: string;
  category: string;
  description: string;
  url: string;
  challenge: string;
  solution: string;
  principles: string;
  results: string;
  testimonialQuote: string;
  testimonialAuthor: string;
  caseUrl: string;
  published: boolean;
  isDemo: boolean;
  featuredPosition: string;
}

export const ProjectEditPage = ({
  session,
  assets,
  flash,
  newRequests,
  project,
  values,
  errors,
  maxMb,
}: Base & { project: ProjectWithImages; values: ProjectFormValues; errors?: Record<string, string>; maxMb: number }) => (
  <AdminShell
    title={project.name || 'Nouveau projet'}
    section="projects"
    session={session}
    assets={assets}
    flash={flash}
    newRequests={newRequests}
    actions={
      <a class="btn" href="/admin/projets">
        Retour aux projets
      </a>
    }
  >
    <div class="grid-2">
      <section class="panel" aria-labelledby="info-title">
        <h2 id="info-title">Informations</h2>
        <form method="post" action={`/admin/projets/${project.id}`} class="form" novalidate>
          <Csrf token={session.csrfToken} />
          <Field label="Nom du projet" name="name" value={values.name} required max={120} error={errors?.name} hint="Affiché sous l’image, sur la page d’accueil." />
          <Field label="Catégorie ou courte description" name="category" value={values.category} max={120} error={errors?.category} hint="Ex. : Site vitrine · Design sur mesure" />
          <div class="field">
            <label for="f-description">Description (facultatif)</label>
            <textarea id="f-description" name="description" rows={3} maxlength={400}>
              {values.description}
            </textarea>
            {errors?.description ? <p class="field__error">{errors.description}</p> : null}
          </div>
          <Field label="Adresse du site (facultatif)" name="url" type="url" value={values.url} max={300} error={errors?.url} hint="https://… — un bouton « Voir le projet » est ajouté." />
          <fieldset class="subgroup">
            <legend>Étude de cas</legend>
            <div class="field">
              <label for="f-challenge">Contexte / défi</label>
              <textarea id="f-challenge" name="challenge" rows={3} maxlength={500} aria-describedby="f-challenge-hint">
                {values.challenge}
              </textarea>
              <p class={errors?.challenge ? 'field__error' : 'field__hint'} id="f-challenge-hint">
                {errors?.challenge ?? 'La situation et ce qui devait changer.'}
              </p>
            </div>
            <div class="field">
              <label for="f-solution">Solution apportée</label>
              <textarea id="f-solution" name="solution" rows={3} maxlength={500} aria-describedby="f-solution-hint">
                {values.solution}
              </textarea>
              <p class={errors?.solution ? 'field__error' : 'field__hint'} id="f-solution-hint">
                {errors?.solution ?? 'Ce qui a été conçu et pourquoi.'}
              </p>
            </div>
          </fieldset>
          <fieldset class="subgroup">
            <legend>Concept / démonstration</legend>
            <div class="field">
              <label for="f-principles">Objectif de conversion et principes de conception</label>
              <textarea id="f-principles" name="principles" rows={3} maxlength={600} aria-describedby="f-principles-hint">
                {values.principles}
              </textarea>
              <p class={errors?.principles ? 'field__error' : 'field__hint'} id="f-principles-hint">
                {errors?.principles ?? 'Affiché pour un concept : l’objectif commercial visé et les choix d’UX / de conversion. Jamais de résultat chiffré.'}
              </p>
            </div>
          </fieldset>
          <fieldset class="subgroup">
            <legend>Projet client (section « Résultats clients »)</legend>
            <div class="field">
              <label for="f-results">Résultats vérifiables</label>
              <textarea id="f-results" name="results" rows={3} maxlength={500} aria-describedby="f-results-hint">
                {values.results}
              </textarea>
              <p class={errors?.results ? 'field__error' : 'field__hint'} id="f-results-hint">
                {errors?.results ?? 'Uniquement des chiffres réels, vérifiables, avec l’accord du client (ex. : « +38 % de demandes de devis en 3 mois »).'}
              </p>
            </div>
            <div class="field">
              <label for="f-testimonialQuote">Témoignage du client (citation exacte)</label>
              <textarea id="f-testimonialQuote" name="testimonialQuote" rows={3} maxlength={500} aria-describedby="f-testimonialQuote-hint">
                {values.testimonialQuote}
              </textarea>
              <p class={errors?.testimonialQuote ? 'field__error' : 'field__hint'} id="f-testimonialQuote-hint">
                {errors?.testimonialQuote ?? 'Avec l’accord écrit du client. Sans guillemets.'}
              </p>
            </div>
            <Field label="Auteur du témoignage (nom · fonction)" name="testimonialAuthor" value={values.testimonialAuthor} max={120} error={errors?.testimonialAuthor} hint="Ex. : Prénom Nom · Gérante, Entreprise" />
            <Field label="Lien vers l’étude de cas complète (facultatif)" name="caseUrl" type="url" value={values.caseUrl} max={300} error={errors?.caseUrl} hint="https://… — un bouton « Lire l’étude de cas » est ajouté." />
          </fieldset>
          <div class="field">
            <label for="f-featured">Position sur la page d’accueil</label>
            <select id="f-featured" name="featuredPosition">
              <option value="" selected={!values.featuredPosition}>
                Non affiché en avant
              </option>
              {['1', '2', '3'].map((n) => (
                <option value={n} selected={values.featuredPosition === n}>
                  Position {n}
                </option>
              ))}
            </select>
            <p class="field__hint">Si un autre projet occupe déjà cette position, il est retiré de l’accueil.</p>
          </div>
          <label class="check">
            <input type="checkbox" name="published" value="1" checked={values.published} />
            <span>Publié (visible sur le site)</span>
          </label>
          <label class="check">
            <input type="checkbox" name="isDemo" value="1" checked={values.isDemo} />
            <span>Concept de démonstration (section « Nos concepts », mention « Concept / Démonstration ») — décochez pour un projet client livré</span>
          </label>
          <div class="form__actions">
            <button class="btn btn--primary" type="submit">
              Enregistrer
            </button>
          </div>
        </form>
      </section>

      <section class="panel" aria-labelledby="img-title">
        <h2 id="img-title">Images</h2>
        <p class="muted">
          Format 16:10 recommandé, idéalement 2880 × 1800 px (capture 1440 × 900 en densité 2). JPEG, PNG, WebP ou AVIF, {maxMb} Mo maximum par fichier, 10 fichiers par envoi. Les
          images sont optimisées automatiquement (AVIF + WebP) et leurs métadonnées (GPS, appareil) supprimées.
        </p>
        <form method="post" action={`/admin/projets/${project.id}/images`} enctype="multipart/form-data" class="upload" data-upload>
          <Csrf token={session.csrfToken} />
          <label class="upload__drop" for="f-images">
            <span class="upload__title">Choisir des images</span>
            <span class="muted small" data-upload-label>
              ou les déposer ici
            </span>
          </label>
          <input id="f-images" class="upload__input" type="file" name="images" accept="image/jpeg,image/png,image/webp,image/avif" multiple required />
          <button class="btn btn--primary" type="submit" data-upload-submit>
            Envoyer
          </button>
        </form>

        {project.images.length ? (
          <form method="post" action={`/admin/projets/${project.id}/images/textes`} class="form" id="alts-form">
            <Csrf token={session.csrfToken} />
          </form>
        ) : null}
        {project.images.length ? (
          <ol class="images">
            {project.images.map((img, i) => {
              const v = pickVariant(img.variants, 'webp', 320);
              const isCover = i === 0;
              return (
                <li class="image-row">
                  <img src={`/media/${img.id}/${v.width}.webp`} width="96" height="96" alt="" loading="lazy" />
                  <div class="image-row__body">
                    <div class="image-row__meta">
                      <span class="strong">Image {i + 1}</span>
                      {isCover ? <span class="tag tag--ok">Couverture</span> : null}
                      <span class="muted small">
                        {img.width} × {img.height} px
                      </span>
                    </div>
                    <label class="sr-only" for={`alt-${img.id}`}>
                      Texte alternatif de l’image {i + 1}
                    </label>
                    <input
                      id={`alt-${img.id}`}
                      form="alts-form"
                      name={`alt:${img.id}`}
                      type="text"
                      maxlength={200}
                      value={img.alt}
                      placeholder="Texte alternatif : décrivez l’image (obligatoire pour l’accessibilité)"
                      class={img.alt ? '' : 'is-missing'}
                    />
                    <div class="image-row__actions">
                      <form method="post" action={`/admin/projets/${project.id}/images/${img.id}/deplacer`}>
                        <Csrf token={session.csrfToken} />
                        <input type="hidden" name="direction" value="up" />
                        <button class="icon-btn" type="submit" disabled={i === 0} aria-label={`Monter l’image ${i + 1}`}>
                          <Up />
                        </button>
                      </form>
                      <form method="post" action={`/admin/projets/${project.id}/images/${img.id}/deplacer`}>
                        <Csrf token={session.csrfToken} />
                        <input type="hidden" name="direction" value="down" />
                        <button class="icon-btn" type="submit" disabled={i === project.images.length - 1} aria-label={`Descendre l’image ${i + 1}`}>
                          <Down />
                        </button>
                      </form>
                      {!isCover ? (
                        <form method="post" action={`/admin/projets/${project.id}/images/${img.id}/couverture`}>
                          <Csrf token={session.csrfToken} />
                          <button class="btn btn--small" type="submit">
                            Définir comme couverture
                          </button>
                        </form>
                      ) : null}
                      <form method="post" action={`/admin/projets/${project.id}/images/${img.id}/supprimer`} data-confirm="Supprimer définitivement cette image ?">
                        <Csrf token={session.csrfToken} />
                        <button class="btn btn--small btn--danger" type="submit">
                          Supprimer
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div class="empty">
            <p>Aucune image : un visuel neutre est affiché sur le site.</p>
          </div>
        )}
        {project.images.length ? (
          <div class="form__actions">
            <button class="btn btn--primary" type="submit" form="alts-form">
              Enregistrer les textes alternatifs
            </button>
          </div>
        ) : null}
      </section>
    </div>

    <section class="panel panel--danger" aria-labelledby="danger-title">
      <h2 id="danger-title">Supprimer le projet</h2>
      <p class="muted">Le projet et toutes ses images seront supprimés définitivement.</p>
      <form method="post" action={`/admin/projets/${project.id}/supprimer`} data-confirm={`Supprimer définitivement le projet « ${project.name} » et ses images ?`}>
        <Csrf token={session.csrfToken} />
        <button class="btn btn--danger" type="submit">
          Supprimer ce projet
        </button>
      </form>
    </section>
  </AdminShell>
);
