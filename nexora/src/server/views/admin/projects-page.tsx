import type { ProjectWithImages } from '../../lib/repo';
import { pickVariant } from '../../lib/images';
import type { Base } from './base';
import { Down, Up } from './icons';
import { AdminShell, Csrf } from './layout';

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
