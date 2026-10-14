import type { Assets } from '../../lib/assets';
import type { SessionInfo } from '../../context';
import type { SiteContent } from '../../lib/content';
import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import type { contactRequests } from '../../db/schema';
import { AdminDocument, AdminShell, Csrf, STATUS_LABELS, formatDate, type Flash } from './layout';

type RequestRow = typeof contactRequests.$inferSelect;

interface Base {
  session: SessionInfo;
  assets: Assets;
  flash?: Flash | null;
  newRequests: number;
}

/* ---------------------------------------------------------------- Connexion */
export const LoginPage = ({ assets, preToken, error, email, next }: { assets: Assets; preToken: string; error?: string; email?: string; next?: string }) => (
  <AdminDocument title="Connexion" assets={assets} bodyClass="admin admin--login">
    <main class="login" id="contenu">
      <div class="login__card">
        <img class="login__logo" src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="" />
        <img class="login__wordmark" src="/brand/wordmark.svg" width="146" height="24" alt="Nexora" />
        <h1>Administration</h1>
        {error ? (
          <div class="flash flash--error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        <form method="post" action="/admin/connexion" class="form">
          <input type="hidden" name="_pre" value={preToken} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div class="field">
            <label for="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" autocomplete="username" required maxlength={160} value={email ?? ''} autofocus />
          </div>
          <div class="field">
            <label for="password">Mot de passe</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required maxlength={256} />
          </div>
          <button class="btn btn--primary btn--block" type="submit">
            Se connecter
          </button>
        </form>
        <p class="login__hint">Accès réservé. Aucun compte ne peut être créé depuis cette page.</p>
      </div>
    </main>
  </AdminDocument>
);

/* ---------------------------------------------------------------- Tableau de bord */
export interface Warning {
  title: string;
  detail: string;
  href?: string;
  linkLabel?: string;
}

export const DashboardPage = ({
  session,
  assets,
  flash,
  newRequests,
  stats,
  warnings,
  recent,
}: Base & { stats: { published: number; total: number; requests: number }; warnings: Warning[]; recent: RequestRow[] }) => (
  <AdminShell title="Tableau de bord" section="dashboard" session={session} assets={assets} flash={flash} newRequests={newRequests}>
    <section class="stats" aria-label="Résumé">
      <a class="stat" href="/admin/demandes?statut=new">
        <span class="stat__value">{newRequests}</span>
        <span class="stat__label">Nouvelles demandes</span>
      </a>
      <a class="stat" href="/admin/demandes">
        <span class="stat__value">{stats.requests}</span>
        <span class="stat__label">Demandes au total</span>
      </a>
      <a class="stat" href="/admin/projets">
        <span class="stat__value">
          {stats.published}
          <small> / {stats.total}</small>
        </span>
        <span class="stat__label">Projets publiés</span>
      </a>
    </section>

    {warnings.length ? (
      <section class="panel" aria-labelledby="warn-title">
        <h2 id="warn-title">À faire avant la mise en ligne</h2>
        <ul class="checklist">
          {warnings.map((w) => (
            <li>
              <strong>{w.title}</strong>
              <span>{w.detail}</span>
              {w.href ? <a href={w.href}>{w.linkLabel ?? 'Corriger'}</a> : null}
            </li>
          ))}
        </ul>
      </section>
    ) : (
      <section class="panel">
        <h2>Tout est configuré</h2>
        <p class="muted">Aucune information manquante détectée.</p>
      </section>
    )}

    <section class="panel" aria-labelledby="recent-title">
      <div class="panel__head">
        <h2 id="recent-title">Dernières demandes</h2>
        <a href="/admin/demandes">Tout voir</a>
      </div>
      {recent.length ? <RequestsTable rows={recent} /> : <p class="muted">Aucune demande pour le moment.</p>}
    </section>
  </AdminShell>
);

/* ---------------------------------------------------------------- Projets */
const Thumb = ({ project }: { project: ProjectWithImages }) => {
  const img = project.images[0];
  if (!img) return <span class="thumb thumb--empty" aria-hidden="true"></span>;
  const v = pickVariant(img.variants, 'webp', 160);
  return <img class="thumb" src={`/media/${img.id}/${v.width}.webp`} width="64" height="64" alt="" loading="lazy" />;
};

export const ProjectsPage = ({ session, assets, flash, newRequests, projects }: Base & { projects: ProjectWithImages[] }) => {
  const featured = projects.filter((p) => p.featuredPosition != null);
  return (
    <AdminShell
      title="Projets"
      section="projects"
      session={session}
      assets={assets}
      flash={flash}
      newRequests={newRequests}
      actions={
        <form method="post" action="/admin/projets">
          <Csrf token={session.csrfToken} />
          <button class="btn btn--primary" type="submit">
            Nouveau projet
          </button>
        </form>
      }
    >
      <p class="lede">
        La page d’accueil affiche les projets <strong>publiés</strong> placés en position 1, 2 et 3.
        {featured.length === 0 ? ' Aucune position n’est définie : les trois premiers projets publiés de la liste sont affichés.' : ''}
      </p>
      {projects.length === 0 ? (
        <div class="empty">
          <p>Aucun projet. Créez votre premier projet pour l’afficher sur le site.</p>
        </div>
      ) : (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Projet</th>
                <th scope="col">Statut</th>
                <th scope="col">Accueil</th>
                <th scope="col">Ordre</th>
                <th scope="col">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr>
                  <td>
                    <div class="cell-project">
                      <Thumb project={p} />
                      <div>
                        <a class="strong" href={`/admin/projets/${p.id}`}>
                          {p.name || 'Sans titre'}
                        </a>
                        <div class="muted small">
                          {p.category || '—'} · {p.images.length} image{p.images.length > 1 ? 's' : ''}
                          {p.isDemo ? <span class="tag tag--demo">Démonstration</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <form method="post" action={`/admin/projets/${p.id}/publication`}>
                      <Csrf token={session.csrfToken} />
                      <input type="hidden" name="published" value={p.published ? '0' : '1'} />
                      <button class={`tag tag--btn ${p.published ? 'tag--ok' : 'tag--draft'}`} type="submit" title={p.published ? 'Cliquer pour dépublier' : 'Cliquer pour publier'}>
                        {p.published ? 'Publié' : 'Brouillon'}
                      </button>
                    </form>
                  </td>
                  <td>
                    <form method="post" action={`/admin/projets/${p.id}/accueil`} class="inline-form">
                      <Csrf token={session.csrfToken} />
                      <label class="sr-only" for={`pos-${p.id}`}>
                        Position sur l’accueil pour {p.name}
                      </label>
                      <select id={`pos-${p.id}`} name="position" data-autosubmit>
                        <option value="" selected={p.featuredPosition == null}>
                          —
                        </option>
                        {[1, 2, 3].map((n) => (
                          <option value={String(n)} selected={p.featuredPosition === n}>
                            Position {n}
                          </option>
                        ))}
                      </select>
                      <noscript>
                        <button class="btn btn--small" type="submit">
                          OK
                        </button>
                      </noscript>
                    </form>
                    {p.featuredPosition != null && !p.published ? <div class="warn small">Non publié : invisible</div> : null}
                  </td>
                  <td>
                    <div class="order-btns">
                      <form method="post" action={`/admin/projets/${p.id}/deplacer`}>
                        <Csrf token={session.csrfToken} />
                        <input type="hidden" name="direction" value="up" />
                        <button class="icon-btn" type="submit" disabled={i === 0} aria-label={`Monter ${p.name}`}>
                          <Up />
                        </button>
                      </form>
                      <form method="post" action={`/admin/projets/${p.id}/deplacer`}>
                        <Csrf token={session.csrfToken} />
                        <input type="hidden" name="direction" value="down" />
                        <button class="icon-btn" type="submit" disabled={i === projects.length - 1} aria-label={`Descendre ${p.name}`}>
                          <Down />
                        </button>
                      </form>
                    </div>
                  </td>
                  <td class="right">
                    <a class="btn btn--small" href={`/admin/projets/${p.id}`}>
                      Modifier
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
};

const Up = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m6 14 6-6 6 6" />
  </svg>
);
const Down = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m6 10 6 6 6-6" />
  </svg>
);

export interface ProjectFormValues {
  name: string;
  category: string;
  description: string;
  url: string;
  challenge: string;
  solution: string;
  results: string;
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
              {errors?.challenge ?? 'La situation du client et ce qui devait changer.'}
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
          <div class="field">
            <label for="f-results">Résultats mesurables</label>
            <textarea id="f-results" name="results" rows={3} maxlength={500} aria-describedby="f-results-hint">
              {values.results}
            </textarea>
            <p class={errors?.results ? 'field__error' : 'field__hint'} id="f-results-hint">
              {errors?.results ?? 'Uniquement des chiffres réels et vérifiables (ex. : « +38 % de demandes de devis en 3 mois »). Vide pour un projet de démonstration.'}
            </p>
          </div>
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
            <span>Concept de démonstration (affiche la mention « Concept / Démonstration »)</span>
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
          Format carré recommandé (1600 × 1600 px). JPEG, PNG, WebP ou AVIF, {maxMb} Mo maximum par fichier, 10 fichiers par envoi. Les
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

const Field = ({
  label,
  name,
  value,
  type = 'text',
  required,
  max,
  error,
  hint,
  autocomplete,
}: {
  label: string;
  name: string;
  value: string;
  type?: string;
  required?: boolean;
  max?: number;
  error?: string;
  hint?: string;
  autocomplete?: string;
}) => {
  const id = `f-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return (
    <div class="field">
      <label for={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        required={required}
        maxlength={max}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={hint || error ? `${id}-desc` : undefined}
        autocomplete={autocomplete}
      />
      <p class={error ? 'field__error' : 'field__hint'} id={`${id}-desc`}>
        {error ?? hint}
      </p>
    </div>
  );
};

/* ---------------------------------------------------------------- Contenus */
type FieldDef = { key: string; label: string; max: number; multiline?: boolean; hint?: string; type?: string };
const repeat = (prefix: string, count: number, label: string, parts: { key: string; label: string; max: number; multiline?: boolean; type?: string }[]): FieldDef[] =>
  Array.from({ length: count }, (_, i) => parts.map((f) => ({ ...f, key: `${prefix}${i + 1}${f.key}`, label: `${label} ${i + 1} — ${f.label}` }))).flat();

const CONTENT_FORM: { section: keyof SiteContent; title: string; intro?: string; fields: FieldDef[] }[] = [
  {
    section: 'hero',
    title: 'Bannière d’accueil',
    intro: 'Le titre est composé de trois parties ; la partie centrale s’affiche en couleur vin. Le bouton principal ouvre le lien de rendez-vous s’il est renseigné (section Contact), sinon le formulaire.',
    fields: [
      { key: 'titleBefore', label: 'Titre — début', max: 80 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'titleAfter', label: 'Titre — fin', max: 80 },
      { key: 'subtitle', label: 'Sous-titre', max: 240, multiline: true },
      { key: 'primaryCta', label: 'Bouton principal', max: 40 },
      { key: 'secondaryCta', label: 'Bouton secondaire (vers les réalisations)', max: 40 },
      { key: 'reassurance', label: 'Mention sous les boutons', max: 80 },
    ],
  },
  { section: 'header', title: 'En-tête', fields: [{ key: 'cta', label: 'Bouton de l’en-tête', max: 32 }] },
  {
    section: 'proof',
    title: 'Preuve sociale (chiffres)',
    intro:
      'UNIQUEMENT des données réelles et vérifiables (note Google et nombre d’avis, nombre de sites livrés, résultats mesurés…). Tant que tout est vide, la bande n’apparaît pas sur le site.',
    fields: [{ key: 'title', label: 'Titre (lu par les lecteurs d’écran)', max: 80 }, ...repeat('item', 4, 'Chiffre', [{ key: 'Value', label: 'valeur (ex. : 4,9/5)', max: 16 }, { key: 'Label', label: 'légende', max: 80 }])],
  },
  {
    section: 'services',
    title: 'Services',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 200 },
      { key: 'cta', label: 'Lien sous chaque service', max: 40 },
      ...repeat('s', 4, 'Service', [{ key: 'Title', label: 'titre', max: 50 }, { key: 'Text', label: 'bénéfice (une phrase)', max: 200, multiline: true }]),
    ],
  },
  {
    section: 'method',
    title: 'Méthode',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 200 },
      ...repeat('m', 3, 'Étape', [{ key: 'Title', label: 'titre', max: 50 }, { key: 'Text', label: 'texte', max: 300, multiline: true }]),
    ],
  },
  {
    section: 'projects',
    title: 'Réalisations (études de cas)',
    intro: 'Le contexte, la solution et les résultats de chaque projet se remplissent dans Projets.',
    fields: [
      { key: 'eyebrow', label: 'Sur-titre (facultatif)', max: 60 },
      { key: 'titleLine1', label: 'Titre — ligne 1', max: 60 },
      { key: 'titleLine2Before', label: 'Titre — ligne 2, début', max: 30 },
      { key: 'titleLine2Highlight', label: 'Titre — ligne 2, partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 200, multiline: true },
      { key: 'visitLabel', label: 'Bouton vers le site', max: 30 },
      { key: 'caseLabel', label: 'Bouton vers l’étude de cas', max: 30 },
      { key: 'emptyText', label: 'Texte si aucun projet', max: 160 },
    ],
  },
  {
    section: 'testimonials',
    title: 'Témoignages',
    intro: 'UNIQUEMENT des citations réelles, avec l’accord écrit de la personne (nom et fonction exacts). Tant que tout est vide, la section n’apparaît pas sur le site.',
    fields: [
      { key: 'title', label: 'Titre', max: 60 },
      ...repeat('t', 3, 'Témoignage', [
        { key: 'Quote', label: 'citation', max: 400, multiline: true },
        { key: 'Author', label: 'nom', max: 80 },
        { key: 'Role', label: 'fonction et entreprise', max: 120 },
      ]),
    ],
  },
  {
    section: 'faq',
    title: 'Questions fréquentes',
    intro: 'Relisez chaque réponse : elle engage l’entreprise (délais, budget, propriété du site…).',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      ...repeat('q', 6, 'Question', [{ key: 'Question', label: 'question', max: 140 }, { key: 'Answer', label: 'réponse', max: 700, multiline: true }]),
    ],
  },
  {
    section: 'contact',
    title: 'Section Contact',
    fields: [
      { key: 'titleLine1', label: 'Titre — ligne 1', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'text', label: 'Texte', max: 240, multiline: true },
      { key: 'responsePromise', label: 'Engagement de réponse', max: 80 },
      { key: 'formTitle', label: 'Titre du formulaire', max: 60 },
      { key: 'successMessage', label: 'Message après envoi', max: 240, multiline: true },
      { key: 'bookingUrl', label: 'Lien de prise de rendez-vous (Cal.com, Calendly…)', max: 300, type: 'url', hint: 'https://… — vide : les boutons « Réserver » mènent au formulaire.' },
      { key: 'bookingLabel', label: 'Bouton de prise de rendez-vous', max: 40 },
      { key: 'whatsappNumber', label: 'Numéro WhatsApp (facultatif)', max: 24, type: 'tel', hint: 'Format international : +33 6 12 34 56 78. Vide : pas de bouton WhatsApp.' },
      { key: 'whatsappMessage', label: 'Message WhatsApp prérempli', max: 160 },
      { key: 'publicEmail', label: 'E-mail affiché (facultatif)', max: 160, type: 'email' },
      { key: 'publicPhone', label: 'Téléphone affiché (facultatif)', max: 30, type: 'tel' },
    ],
  },
  { section: 'footer', title: 'Pied de page', fields: [{ key: 'tagline', label: 'Accroche sous le logo', max: 60 }] },
  {
    section: 'seo',
    title: 'Référencement',
    fields: [
      { key: 'title', label: 'Titre de la page (onglet, Google)', max: 70 },
      { key: 'description', label: 'Description (Google, partages)', max: 170, multiline: true },
    ],
  },
  {
    section: 'legal',
    title: 'Informations légales',
    intro: 'Obligatoires avant la mise en ligne (mentions légales et politique de confidentialité). Rien n’est rempli automatiquement.',
    fields: [
      { key: 'companyName', label: 'Raison sociale', max: 120 },
      { key: 'legalForm', label: 'Forme juridique (ex. : SAS, EI)', max: 80 },
      { key: 'shareCapital', label: 'Capital social (si société)', max: 60 },
      { key: 'address', label: 'Adresse du siège', max: 240, multiline: true },
      { key: 'siret', label: 'SIRET', max: 40 },
      { key: 'rcs', label: 'RCS (ville et numéro, si applicable)', max: 80 },
      { key: 'vatNumber', label: 'N° de TVA intracommunautaire', max: 40 },
      { key: 'publicationDirector', label: 'Directeur de la publication', max: 120 },
      { key: 'contactEmail', label: 'E-mail de contact (droits RGPD)', max: 160, type: 'email' },
      { key: 'hostName', label: 'Hébergeur — nom', max: 120 },
      { key: 'hostAddress', label: 'Hébergeur — adresse', max: 240, multiline: true },
      { key: 'hostPhone', label: 'Hébergeur — téléphone', max: 40 },
      { key: 'retentionPeriod', label: 'Durée de conservation des demandes (ex. : 3 ans)', max: 80 },
    ],
  },
];

export const ContentPage = ({
  session,
  assets,
  flash,
  newRequests,
  values,
  errors,
}: Base & { values: SiteContent; errors?: Record<string, string> }) => (
  <AdminShell title="Contenus du site" section="content" session={session} assets={assets} flash={flash} newRequests={newRequests}>
    <p class="lede">Les textes sont publiés dès l’enregistrement. La mise en page est fixe : seuls les textes changent, avec une longueur maximale pour préserver le design.</p>
    <form method="post" action="/admin/contenus" class="form" novalidate>
      <Csrf token={session.csrfToken} />
      {CONTENT_FORM.map((group) => (
        <fieldset class="panel">
          <legend>{group.title}</legend>
          {group.intro ? <p class="muted">{group.intro}</p> : null}
          <div class="fields-grid">
            {group.fields.map((f) => {
              const name = `${group.section}.${f.key}`;
              const id = `c-${group.section}-${f.key}`;
              const value = (values[group.section] as Record<string, string>)[f.key] ?? '';
              const error = errors?.[name];
              return (
                <div class={`field${f.multiline ? ' field--full' : ''}`}>
                  <label for={id}>{f.label}</label>
                  {f.multiline ? (
                    <textarea id={id} name={name} maxlength={f.max} rows={3} aria-invalid={error ? 'true' : undefined}>
                      {value}
                    </textarea>
                  ) : (
                    <input id={id} name={name} type={f.type ?? 'text'} value={value} maxlength={f.max} aria-invalid={error ? 'true' : undefined} />
                  )}
                  {error ? <p class="field__error">{error}</p> : f.hint ? <p class="field__hint">{f.hint}</p> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div class="sticky-actions">
        <button class="btn btn--primary" type="submit">
          Enregistrer et publier
        </button>
      </div>
    </form>
  </AdminShell>
);

/* ---------------------------------------------------------------- Demandes */
const RequestsTable = ({ rows }: { rows: RequestRow[] }) => (
  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th scope="col">Reçue le</th>
          <th scope="col">Nom</th>
          <th scope="col">Entreprise</th>
          <th scope="col">Type</th>
          <th scope="col">Statut</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr class={r.status === 'new' ? 'is-new' : ''}>
            <td class="nowrap">{formatDate(r.createdAt)}</td>
            <td>
              <a class="strong" href={`/admin/demandes/${r.id}`}>
                {r.name}
              </a>
            </td>
            <td>{r.company || '—'}</td>
            <td>{r.projectType}</td>
            <td>
              <span class={`tag tag--${r.status}`}>{STATUS_LABELS[r.status]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const RequestsPage = ({
  session,
  assets,
  flash,
  newRequests,
  rows,
  status,
  counts,
  page,
  pages,
}: Base & { rows: RequestRow[]; status: string; counts: Record<string, number>; page: number; pages: number }) => {
  const tabs = [
    { key: 'all', label: 'Toutes' },
    { key: 'new', label: 'Nouvelles' },
    { key: 'in_progress', label: 'En cours' },
    { key: 'done', label: 'Terminées' },
  ];
  return (
    <AdminShell title="Demandes de contact" section="requests" session={session} assets={assets} flash={flash} newRequests={newRequests}>
      <nav class="tabs" aria-label="Filtrer par statut">
        {tabs.map((t) => (
          <a href={t.key === 'all' ? '/admin/demandes' : `/admin/demandes?statut=${t.key}`} aria-current={status === t.key ? 'page' : undefined}>
            {t.label} <span class="count">{counts[t.key] ?? 0}</span>
          </a>
        ))}
      </nav>
      {rows.length ? <RequestsTable rows={rows} /> : <div class="empty"><p>Aucune demande dans cette catégorie.</p></div>}
      {pages > 1 ? (
        <nav class="pager" aria-label="Pagination">
          {page > 1 ? <a href={`/admin/demandes?statut=${status}&page=${page - 1}`}>Précédent</a> : <span></span>}
          <span class="muted">
            Page {page} / {pages}
          </span>
          {page < pages ? <a href={`/admin/demandes?statut=${status}&page=${page + 1}`}>Suivant</a> : <span></span>}
        </nav>
      ) : null}
    </AdminShell>
  );
};

export const RequestDetailPage = ({ session, assets, flash, newRequests, row, mailConfigured }: Base & { row: RequestRow; mailConfigured: boolean }) => (
  <AdminShell
    title={`Demande de ${row.name}`}
    section="requests"
    session={session}
    assets={assets}
    flash={flash}
    newRequests={newRequests}
    actions={
      <a class="btn" href="/admin/demandes">
        Retour aux demandes
      </a>
    }
  >
    <div class="grid-2">
      <section class="panel" aria-labelledby="req-title">
        <h2 id="req-title">Message</h2>
        <dl class="dl">
          <dt>Reçue le</dt>
          <dd>{formatDate(row.createdAt)}</dd>
          <dt>Nom</dt>
          <dd>{row.name}</dd>
          <dt>Entreprise</dt>
          <dd>{row.company || '—'}</dd>
          <dt>E-mail</dt>
          <dd>
            <a href={`mailto:${row.email}`}>{row.email}</a>
          </dd>
          <dt>Téléphone</dt>
          <dd>{row.phone ? <a href={`tel:${row.phone.replace(/[^+0-9]/g, '')}`}>{row.phone}</a> : '—'}</dd>
          <dt>Type de projet</dt>
          <dd>{row.projectType}</dd>
          <dt>Budget estimatif</dt>
          <dd>{row.budget || '—'}</dd>
          <dt>Délai souhaité</dt>
          <dd>{row.timeline || '—'}</dd>
        </dl>
        <div class="message">{row.message}</div>
      </section>
      <div class="stack">
        <section class="panel" aria-labelledby="status-title">
          <h2 id="status-title">Suivi</h2>
          <form method="post" action={`/admin/demandes/${row.id}/statut`} class="form">
            <Csrf token={session.csrfToken} />
            <div class="field">
              <label for="r-status">Statut</label>
              <select id="r-status" name="status">
                {(['new', 'in_progress', 'done'] as const).map((s) => (
                  <option value={s} selected={row.status === s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <button class="btn btn--primary" type="submit">
              Mettre à jour
            </button>
          </form>
        </section>
        <section class="panel" aria-labelledby="notif-title">
          <h2 id="notif-title">Notification e-mail</h2>
          {row.notifiedAt ? (
            <p>Envoyée le {formatDate(row.notifiedAt)}.</p>
          ) : (
            <p class="warn">{row.notifyError ?? 'Non envoyée.'}</p>
          )}
          {!mailConfigured ? <p class="muted small">Configurez MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM et MAIL_TO pour être prévenu par e-mail.</p> : null}
        </section>
        <section class="panel panel--danger" aria-labelledby="del-title">
          <h2 id="del-title">Supprimer</h2>
          <p class="muted">À utiliser par exemple pour une demande d’effacement (RGPD) ou un message indésirable.</p>
          <form method="post" action={`/admin/demandes/${row.id}/supprimer`} data-confirm="Supprimer définitivement cette demande ?">
            <Csrf token={session.csrfToken} />
            <button class="btn btn--danger" type="submit">
              Supprimer la demande
            </button>
          </form>
        </section>
      </div>
    </div>
  </AdminShell>
);

/* ---------------------------------------------------------------- Compte */
export const AccountPage = ({
  session,
  assets,
  flash,
  newRequests,
  errors,
  config,
}: Base & {
  errors?: Record<string, string>;
  config: { mail: { configured: boolean; provider: string; missing: string[] }; storage: string; database: string };
}) => (
  <AdminShell title="Compte et configuration" section="account" session={session} assets={assets} flash={flash} newRequests={newRequests}>
    <div class="grid-2">
      <section class="panel" aria-labelledby="pw-title">
        <h2 id="pw-title">Changer le mot de passe</h2>
        <form method="post" action="/admin/compte/mot-de-passe" class="form" novalidate>
          <Csrf token={session.csrfToken} />
          <input type="text" name="username" value={session.email} autocomplete="username" hidden />
          <Field label="Mot de passe actuel" name="current" type="password" value="" required max={256} error={errors?.current} autocomplete="current-password" />
          <Field label="Nouveau mot de passe" name="next" type="password" value="" required max={256} error={errors?.next} hint="12 caractères minimum." autocomplete="new-password" />
          <Field label="Confirmer le nouveau mot de passe" name="confirm" type="password" value="" required max={256} error={errors?.confirm} autocomplete="new-password" />
          <button class="btn btn--primary" type="submit">
            Mettre à jour
          </button>
          <p class="muted small">Les autres sessions ouvertes seront déconnectées.</p>
        </form>
      </section>
      <section class="panel" aria-labelledby="cfg-title">
        <h2 id="cfg-title">Configuration du serveur</h2>
        <dl class="dl">
          <dt>Notification e-mail</dt>
          <dd>
            {config.mail.configured ? (
              <span class="tag tag--ok">Active ({config.mail.provider})</span>
            ) : (
              <>
                <span class="tag tag--draft">Non configurée</span>
                <span class="muted small block">Variables manquantes : {config.mail.missing.join(', ')}</span>
              </>
            )}
          </dd>
          <dt>Stockage des images</dt>
          <dd>{config.storage}</dd>
          <dt>Base de données</dt>
          <dd>{config.database}</dd>
        </dl>
        <p class="muted small">Ces réglages se modifient dans les variables d’environnement du serveur (voir README), jamais depuis le navigateur.</p>
      </section>
    </div>
  </AdminShell>
);

export const AdminErrorPage = ({ assets, title, message }: { assets: Assets; title: string; message: string }) => (
  <AdminDocument title={title} assets={assets} bodyClass="admin admin--login">
    <main class="login" id="contenu">
      <div class="login__card">
        <h1>{title}</h1>
        <p>{message}</p>
        <a class="btn btn--primary btn--block" href="/admin">
          Retour à l’administration
        </a>
      </div>
    </main>
  </AdminDocument>
);
