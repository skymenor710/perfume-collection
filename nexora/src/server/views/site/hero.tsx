import type { SiteContent } from '../../lib/content';
import { ArrowUpRight, MouseIcon } from '../icons';

export const Hero = ({ content }: { content: SiteContent }) => {
  const h = content.hero;
  return (
    <section class="hero" id="accueil" aria-labelledby="hero-title" data-hero>
      <div class="hero__bg" aria-hidden="true" data-parallax-bg>
        <span class="hero__glow hero__glow--a"></span>
        <span class="hero__glow hero__glow--b"></span>
        <span class="hero__beam"></span>
        <span class="hero__streak"></span>
      </div>
      <div class="container hero__grid">
        <div class="hero__copy">
          <h1 class="hero__title" id="hero-title">
            {h.titleBefore ? <span>{h.titleBefore} </span> : null}
            {h.titleHighlight ? <em class="accent">{h.titleHighlight}</em> : null}
            {h.titleAfter ? <span> {h.titleAfter}</span> : null}
          </h1>
          {h.subtitle ? <p class="hero__lead">{h.subtitle}</p> : null}
          {h.audience ? <p class="hero__audience">{h.audience}</p> : null}
          <div class="hero__actions">
            {/* Toujours le formulaire de devis : ce bouton ne promet jamais une réservation. */}
            <a class="btn btn--primary btn--lg hero__cta-primary" href="#contact" data-track="cta_primary">
              <span>{h.ctaQuote}</span>
              <ArrowUpRight />
            </a>
            <a class="btn btn--outline btn--lg hero__cta-secondary" href="#realisations" data-track="cta_secondary">
              <span>{h.ctaWork}</span>
              <ArrowUpRight />
            </a>
          </div>
          {h.reassurance ? <p class="hero__reassurance">{h.reassurance}</p> : null}
        </div>
        <SymbolVisual />
      </div>
      <div class="container hero__foot">
        <a class="scroll-cue" href="#realisations" aria-label="Voir nos réalisations">
          <MouseIcon />
        </a>
        <div class="scroll-line" aria-hidden="true">
          <span class="scroll-line__fill" data-scroll-progress></span>
        </div>
      </div>
    </section>
  );
};

/** Symbole N reconstruit en 4K (assets-src/logo4k) : variantes AVIF + WebP de 320 à 1600 px. */
const SYMBOL_SIZES = '(max-width: 860px) min(64vw, 380px), min(36vw, 540px)';
const symbolSrcset = (fmt: 'avif' | 'webp') =>
  [320, 480, 640, 960, 1280, 1600].map((w) => `/brand/symbol-${w}.${fmt} ${w}w`).join(', ');

const SymbolPicture = ({ priority }: { priority?: boolean }) => (
  <picture>
    <source type="image/avif" srcset={symbolSrcset('avif')} sizes={SYMBOL_SIZES} />
    <img
      class={priority ? 'symbol__img' : undefined}
      src="/brand/symbol-960.webp"
      srcset={symbolSrcset('webp')}
      sizes={SYMBOL_SIZES}
      width="2805"
      height="2915"
      alt=""
      fetchpriority={priority ? 'high' : undefined}
      decoding="async"
    />
  </picture>
);

/**
 * Le symbole N : calques superposés —
 *  - l'image 4K (géométrie du fichier HD, rendu du bandeau),
 *  - un reflet néon fin qui parcourt la bande vin, découpé par son tracé vectoriel exact (aucun débordement),
 *  - un reflet au sol (mêmes fichiers, retournés et estompés : aucune requête supplémentaire).
 */
const SymbolVisual = () => (
  <div class="hero__visual" aria-hidden="true">
    <div class="symbol" data-parallax-symbol>
      <span class="symbol__halo"></span>
      <div class="symbol__stage">
        <SymbolPicture priority />
        <span class="symbol__neon" data-neon>
          <span class="symbol__neon-band"></span>
        </span>
      </div>
      <div class="symbol__reflection">
        <SymbolPicture />
      </div>
    </div>
  </div>
);
