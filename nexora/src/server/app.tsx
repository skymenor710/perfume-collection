import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import type { AppEnv, Deps } from './context';
import { clientIp, securityHeaders } from './lib/security';
import { loadSession } from './lib/auth';
import { PageCache, publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { Document } from './views/layout';
import { ErrorPage } from './views/site/error';
import { renderHtml } from './views/render';
import { errorSummary } from './log';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const cache = new PageCache();
  const root = path.relative(process.cwd(), deps.assets.clientDir) || '.';

  app.use('*', securityHeaders(deps));
  // Compression gzip des réponses texte (HTML, CSS, JS, JSON, XML) ; les images sont déjà compressées.
  app.use('*', compress());
  app.use('*', clientIp(deps));

  // Fichiers statiques : cache navigateur d'un an. assets/ porte une empreinte dans le nom ; les fichiers de marque et
  // les polices ne changent pas (en cas de changement : nouveau nom de fichier).
  app.use(
    '/assets/*',
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  for (const prefix of ['/brand/*', '/fonts/*']) {
    app.use(
      prefix,
      serveStatic({
        root,
        onFound: (_p, c) => {
          c.header('Cache-Control', 'public, max-age=31536000');
        },
      }),
    );
  }
  app.get(
    '/favicon.ico',
    serveStatic({
      path: path.join(root, 'brand/favicon.ico'),
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=2592000');
      },
    }),
  );

  // Les images servies par /media vérifient la session pour les projets non publiés.
  app.use('/media/*', loadSession(deps));
  app.route('/', publicRoutes(deps, cache));
  app.route('/admin', adminRoutes(deps, cache));

  const page = (title: string, message: string) =>
    renderHtml(
      <Document meta={{ title: `${title} — Nexora`, description: message, canonical: deps.config.publicUrl, publicUrl: deps.config.publicUrl, noindex: true }} assets={deps.assets}>
        <ErrorPage title={title} message={message} />
      </Document>,
    );

  app.notFound((c) => c.html(page('Page introuvable', 'La page demandée n’existe pas ou a été déplacée.'), 404));
  app.onError((err, c) => {
    // Détail technique dans le journal seulement ; message neutre pour le visiteur.
    deps.log.error({ err: errorSummary(err), path: c.req.path }, 'erreur serveur');
    if ((c.req.header('accept') ?? '').includes('application/json')) return c.json({ message: 'Erreur interne. Réessayez dans un instant.' }, 500);
    return c.html(page('Une erreur est survenue', 'Réessayez dans un instant. Si le problème persiste, contactez-nous.'), 500);
  });

  return app;
}
