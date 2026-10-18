import type { SiteContent } from '../../lib/content';
import type { ProjectWithImages, TeamPhoto } from '../../lib/repo';
import type { Config } from '../../config';
import { Footer, Header } from '../layout';
import { Hero } from './hero';
import { ProofBand, Services, Method, Team, Testimonials, Faq } from './sections';
import { Realisations } from './works';
import { Contact } from './contact';
import { Lightbox, BookingDialog, ConsentBanner } from './overlays';

// Le jeton du formulaire est défini avec le formulaire (contact.tsx) ; ré-exporté ici pour les routes publiques.
export { FORM_TOKEN_PLACEHOLDER } from './contact';

export interface HomeProps {
  content: SiteContent;
  /** Projets CLIENTS publiés (badge « Projet client », résultats vérifiables). */
  results: ProjectWithImages[];
  /** Concepts / démonstrations publiés (badge « Concept / Démonstration », jamais de résultats). */
  concepts: ProjectWithImages[];
  teamPhoto?: TeamPhoto | null;
  analytics?: Config['analytics'];
}

/**
 * Page d'accueil : promesse → (preuve) → réalisations → services → processus → (équipe) → (témoignages) → FAQ →
 * contact. Le travail est montré tôt, juste après la promesse. Tous les textes viennent de Admin › Contenus. Les
 * sections de preuve (chiffres, équipe, témoignages) n'existent QUE si des données réelles sont saisies : aucun texte
 * d'exemple, d'instruction ou d'emplacement « à compléter » n'est jamais montré aux visiteurs.
 */
export const HomePage = ({ content, results, concepts, teamPhoto = null, analytics = null }: HomeProps) => {
  // Projets clients d'abord, puis concepts : chaque carte affiche son statut.
  const works = [...results, ...concepts];
  return (
    <>
      <Header content={content} />
      <main id="contenu">
        <Hero content={content} />
        <ProofBand content={content} />
        <Realisations content={content} projects={works} />
        <Services content={content} />
        <Method content={content} />
        <Team content={content} photo={teamPhoto} />
        <Testimonials content={content} />
        <Faq content={content} />
        <Contact content={content} />
      </main>
      <Footer content={content} consent={!!analytics} />
      {works.some((p) => p.images.length > 0) ? <Lightbox /> : null}
      {content.contact.bookingUrl ? <BookingDialog label={content.contact.bookingLabel} /> : null}
      {analytics ? <ConsentBanner provider={analytics.provider} domain={analytics.domain} script={analytics.scriptUrl} /> : null}
    </>
  );
};
