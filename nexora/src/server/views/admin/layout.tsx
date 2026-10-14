import type { Child } from 'hono/jsx';
import type { Assets } from '../../lib/assets';
import type { SessionInfo } from '../../context';

export interface Flash {
  type: 'ok' | 'error' | 'info';
  lines: string[];
}

const NAV = [
  { href: '/admin', label: 'Tableau de bord', key: 'dashboard' },
  { href: '/admin/projets', label: 'Projets', key: 'projects' },
  { href: '/admin/contenus', label: 'Contenus du site', key: 'content' },
  { href: '/admin/demandes', label: 'Demandes', key: 'requests' },
  { href: '/admin/compte', label: 'Compte', key: 'account' },
] as const;

export type AdminSection = (typeof NAV)[number]['key'];

export const AdminDocument = ({ title, assets, children, bodyClass }: { title: string; assets: Assets; children: Child; bodyClass?: string }) => (
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{`${title} — Administration Nexora`}</title>
      <link rel="icon" href="/favicon.ico" sizes="any" />
      {assets.adminCss.map((href) => (
        <link rel="stylesheet" href={href} />
      ))}
      <script type="module" src={assets.adminJs}></script>
    </head>
    <body class={bodyClass ?? 'admin'}>{children}</body>
  </html>
);

export const AdminShell = ({
  title,
  section,
  session,
  assets,
  flash,
  newRequests,
  children,
  actions,
}: {
  title: string;
  section: AdminSection;
  session: SessionInfo;
  assets: Assets;
  flash?: Flash | null;
  newRequests?: number;
  children: Child;
  actions?: Child;
}) => (
  <AdminDocument title={title} assets={assets}>
    <a class="skip-link" href="#contenu">
      Aller au contenu
    </a>
    <div class="shell">
      <aside class="sidebar">
        <a class="sidebar__brand" href="/admin">
          <img src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="34" height="36" alt="" />
          <span>
            <img src="/brand/wordmark.svg" width="133" height="22" alt="Nexora" />
            <small>Administration</small>
          </span>
        </a>
        <nav class="sidebar__nav" aria-label="Administration">
          <ul>
            {NAV.map((n) => (
              <li>
                <a href={n.href} aria-current={n.key === section ? 'page' : undefined}>
                  {n.label}
                  {n.key === 'requests' && newRequests ? (
                    <span class="count" aria-label={`${newRequests} nouvelle(s)`}>
                      {newRequests}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class="sidebar__foot">
          <a class="sidebar__site" href="/" target="_blank" rel="noopener">
            Voir le site (nouvel onglet)
          </a>
          <p class="sidebar__user">{session.email}</p>
          <form method="post" action="/admin/deconnexion">
            <input type="hidden" name="_csrf" value={session.csrfToken} />
            <button class="btn-link" type="submit">
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>
      <main class="main" id="contenu">
        <header class="page-head">
          <h1>{title}</h1>
          {actions ? <div class="page-head__actions">{actions}</div> : null}
        </header>
        {flash ? (
          <div class={`flash flash--${flash.type}`} role={flash.type === 'error' ? 'alert' : 'status'}>
            {flash.lines.map((l) => (
              <p>{l}</p>
            ))}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  </AdminDocument>
);

export const Csrf = ({ token }: { token: string }) => <input type="hidden" name="_csrf" value={token} />;

export function formatDate(d: Date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(d);
}

export const STATUS_LABELS = { new: 'Nouvelle', in_progress: 'En cours', done: 'Terminée' } as const;
