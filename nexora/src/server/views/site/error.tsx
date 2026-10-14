import { ArrowUpRight } from '../icons';

export const ErrorPage = ({ title, message, back = '/', backLabel = 'Retour à l’accueil' }: { title: string; message: string; back?: string; backLabel?: string }) => (
  <main id="contenu" class="error-page">
    <a href="/" aria-label="Nexora — accueil">
      <img src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="Nexora" class="error-page__logo" />
    </a>
    <h1>{title}</h1>
    <p>{message}</p>
    <a class="btn btn--primary btn--lg" href={back}>
      <span>{backLabel}</span>
      <ArrowUpRight />
    </a>
  </main>
);
