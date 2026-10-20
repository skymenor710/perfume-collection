import * as Sentry from '@sentry/node';
import type { Config } from '../config';

let enabled = false;

/** Initialise l'observabilité de production sans transmettre de données de visiteurs. */
export function initMonitoring(config: Config) {
  if (!config.monitoring || enabled) return;

  Sentry.init({
    dsn: config.monitoring.dsn,
    environment: config.env,
    tracesSampleRate: config.monitoring.tracesSampleRate,
    // Défense en profondeur : les intégrations automatiques ne reçoivent ni identité, ni données de requête, ni
    // valeurs de requêtes SQL. Les traces gardent uniquement leurs noms et durées techniques.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.env;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) {
          try {
            const url = new URL(event.request.url);
            event.request.url = `${url.origin}${url.pathname}`;
          } catch {
            delete event.request.url;
          }
        }
      }
      return event;
    },
  });
  enabled = true;
}

export function captureException(error: unknown, context: { path?: string; method?: string; stage?: 'startup' | 'request' }) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('component', 'nexora-server');
    if (context.stage) scope.setTag('stage', context.stage);
    if (context.method) scope.setTag('http.method', context.method);
    if (context.path) scope.setTag('http.route', context.path);
    Sentry.captureException(error);
  });
}

/** Les fonctions serverless peuvent être gelées juste après une réponse d'erreur : vide la file dans cette fenêtre. */
export async function flushMonitoring(timeout = 1_000) {
  if (enabled) await Sentry.flush(timeout);
}

/** Trace une requête sans URL complète ni paramètres. */
export async function traceRequest<T>(method: string, path: string, task: () => Promise<T>, status: () => number) {
  if (!enabled) return task();
  return Sentry.startSpan({ name: `${method} ${path}`, op: 'http.server' }, async (span) => {
    try {
      return await task();
    } finally {
      span.setAttribute('http.response.status_code', status());
    }
  });
}
