import type { Base, RequestRow } from './base';
import { AdminShell } from './layout';
import { RequestsTable } from './request-pages';

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
