import type { Base, RequestRow } from './base';
import { AdminShell, Csrf, STATUS_LABELS, formatDate } from './layout';

/* ---------------------------------------------------------------- Demandes */
export const RequestsTable = ({ rows }: { rows: RequestRow[] }) => (
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
