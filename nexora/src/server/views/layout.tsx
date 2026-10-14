import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { SiteContent } from '../lib/content';
import type { Assets } from '../lib/assets';
import { ArrowUpRight, MenuIcon } from './icons';

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  publicUrl: string;
  noindex?: boolean;
}

/** Logo officiel : symbole N (fichier original détouré) + logotype extrait du bandeau fourni. */
export const Logo = ({ tagline, size = 'md' }: { tagline?: string; size?: 'md' | 'lg' }) => (
  <span class={`logo logo--${size}`}>
    <img class="logo__symbol" src="/brand/symbol-96.webp" width="46" height="48" alt="" decoding="async" />
    <span class="logo__text">
      <img class="logo__wordmark" src="/brand/wordmark-300.webp" width="146" height="24" alt="Nexora" decoding="async" />
      {tagline ? <span class="logo__tagline">{tagline}</span> : null}
    </span>
  </span>
);

export const NAV = [
  { href: '/#accueil', label: 'Accueil' },
  { href: '/#realisations', label: 'Réalisations' },
  { href: '/#contact', label: 'Contact' },
];

export const Header = ({ content }: { content: SiteContent }) => (
  <header class="site-header" data-header>
    <div class="site-header__inner container">
      <a class="site-header__brand" href="/#accueil" aria-label="Nexora — accueil">
        <Logo />
      </a>
      <nav class="site-nav" aria-label="Navigation principale">
        <ul class="site-nav__list">
          {NAV.map((l) => (
            <li>
              <a class="site-nav__link" href={l.href}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <a class="btn btn--outline btn--sm site-header__cta" href="/#contact" data-open-contact>
          <span>{content.header.cta}</span>
          <ArrowUpRight size={16} />
        </a>
      </nav>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" data-menu-toggle>
        <span class="sr-only" data-menu-label>
          Ouvrir le menu
        </span>
        <MenuIcon />
      </button>
    </div>
    <div class="mobile-menu" id="mobile-menu" hidden data-mobile-menu>
      <nav class="mobile-menu__nav" aria-label="Navigation mobile">
        <ul>
          {NAV.map((l) => (
            <li>
              <a class="mobile-menu__link" href={l.href} data-menu-link>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <a class="btn btn--primary mobile-menu__cta" href="/#contact" data-menu-link data-open-contact>
          <span>{content.header.cta}</span>
          <ArrowUpRight />
        </a>
      </nav>
    </div>
  </header>
);

export const Footer = ({ content }: { content: SiteContent }) => (
  <footer class="site-footer">
    <div class="container site-footer__inner">
      <a class="site-footer__brand" href="/#accueil">
        <Logo tagline={content.footer.tagline} />
      </a>
      <nav class="site-footer__nav" aria-label="Pied de page">
        <ul class="site-footer__links">
          {NAV.map((l) => (
            <li>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
        <ul class="site-footer__legal">
          <li>
            <a href="/mentions-legales">Mentions légales</a>
          </li>
          <li>
            <a href="/politique-de-confidentialite">Politique de confidentialité</a>
          </li>
          <li>
            <span>© {new Date().getFullYear()} Nexora</span>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
);

export const Document = ({
  meta,
  assets,
  children,
  bodyClass,
  jsonLd,
}: {
  meta: PageMeta;
  assets: Assets;
  children: Child;
  bodyClass?: string;
  jsonLd?: object;
}) => (
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={meta.canonical} />
      {meta.noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
      <meta name="theme-color" content="#09090C" />
      <meta name="color-scheme" content="dark" />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content="fr_FR" />
      <meta property="og:site_name" content="Nexora" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={meta.canonical} />
      <meta property="og:image" content={`${meta.publicUrl}/brand/og-image.jpg`} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="icon" href="/brand/favicon-32.png" type="image/png" sizes="32x32" />
      <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <link rel="preload" href="/fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
      {assets.siteInlineCss ? (
        <style>{raw(assets.siteInlineCss)}</style>
      ) : (
        assets.siteCss.map((href) => <link rel="stylesheet" href={href} />)
      )}
      <script type="module" src={assets.siteJs}></script>
      {jsonLd ? <script type="application/ld+json">{raw(JSON.stringify(jsonLd).replace(/</g, '\\u003c'))}</script> : null}
    </head>
    <body class={bodyClass}>
      <a class="skip-link" href="#contenu">
        Aller au contenu
      </a>
      {children}
    </body>
  </html>
);
