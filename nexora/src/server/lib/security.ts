import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AppEnv, Deps } from '../context';
import { hmac } from './crypto';

/**
 * En-têtes de sécurité sur toutes les réponses.
 * CSP stricte : aucun script inline ; un seul bloc de style inline autorisé, par son empreinte SHA-256 (CSS du site,
 * intégré pour éviter une requête bloquante). Pas d'objet, pas d'iframe.
 */
export function securityHeaders(deps: Deps): MiddlewareHandler<AppEnv> {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self'${deps.assets.siteInlineCssHash ? ` ${deps.assets.siteInlineCssHash}` : ''}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(deps.config.isProd && deps.config.publicUrl.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('Content-Security-Policy', csp);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    h.set('X-DNS-Prefetch-Control', 'off');
    if (deps.config.cookieSecure) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (c.req.path.startsWith('/admin')) h.set('X-Robots-Tag', 'noindex, nofollow');
    h.delete('X-Powered-By');
  };
}

/**
 * Adresse IP du client. X-Forwarded-For n'est lu que si TRUST_PROXY=true (derrière un proxy de confiance),
 * sinon n'importe qui pourrait choisir son IP et contourner la limitation de débit.
 */
export function clientIp(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let ip = '';
    if (deps.config.trustProxy) {
      const xff = c.req.header('x-forwarded-for');
      if (xff) ip = xff.split(',')[0].trim();
      ip ||= c.req.header('x-real-ip') ?? '';
    }
    if (!ip) {
      try {
        ip = getConnInfo(c).remote.address ?? '';
      } catch {
        ip = '';
      }
    }
    c.set('clientIp', ip || 'unknown');
    await next();
  };
}

/** Empreinte non réversible (HMAC) d'une IP ou d'un e-mail pour les clés de limitation : rien en clair en base. */
export function fingerprint(deps: Deps, kind: string, value: string) {
  return `${kind}:${hmac(deps.config.sessionSecret, `${kind}:${value.toLowerCase()}`).slice(0, 32)}`;
}
