import type { SiteContent } from '../../lib/content';
import { missingLegal } from '../../lib/content';
import { Footer, Header } from '../layout';

/** Valeur légale ou mention visible « à compléter » : rien n'est inventé. */
const V = ({ value }: { value: string }) => (value ? <>{value}</> : <span class="pending">À compléter</span>);

const PendingNotice = ({ content }: { content: SiteContent }) =>
  missingLegal(content).length ? (
    <p class="legal__notice">
      Certaines informations légales sont en cours de complétion. Elles seront publiées avant la mise en service définitive du site.
    </p>
  ) : null;

export const LegalNotice = ({ content, publicUrl }: { content: SiteContent; publicUrl: string }) => {
  const l = content.legal;
  return (
    <>
      <Header content={content} />
      <main id="contenu" class="legal">
        <div class="container legal__inner">
          <h1>Mentions légales</h1>
          <PendingNotice content={content} />

          <h2>Éditeur du site</h2>
          <dl>
            <dt>Raison sociale</dt>
            <dd><V value={l.companyName} /></dd>
            <dt>Forme juridique</dt>
            <dd><V value={l.legalForm} /></dd>
            {l.shareCapital ? (
              <>
                <dt>Capital social</dt>
                <dd>{l.shareCapital}</dd>
              </>
            ) : null}
            <dt>Siège social</dt>
            <dd><V value={l.address} /></dd>
            <dt>SIRET</dt>
            <dd><V value={l.siret} /></dd>
            {l.rcs ? (
              <>
                <dt>RCS</dt>
                <dd>{l.rcs}</dd>
              </>
            ) : null}
            {l.vatNumber ? (
              <>
                <dt>N° de TVA intracommunautaire</dt>
                <dd>{l.vatNumber}</dd>
              </>
            ) : null}
            <dt>Directeur de la publication</dt>
            <dd><V value={l.publicationDirector} /></dd>
            <dt>Contact</dt>
            <dd>{l.contactEmail ? <a href={`mailto:${l.contactEmail}`}>{l.contactEmail}</a> : <V value="" />}</dd>
          </dl>

          <h2>Hébergement</h2>
          <dl>
            <dt>Hébergeur</dt>
            <dd><V value={l.hostName} /></dd>
            <dt>Adresse</dt>
            <dd><V value={l.hostAddress} /></dd>
            {l.hostPhone ? (
              <>
                <dt>Téléphone</dt>
                <dd>{l.hostPhone}</dd>
              </>
            ) : null}
          </dl>

          <h2>Propriété intellectuelle</h2>
          <p>
            L’ensemble des contenus de ce site ({publicUrl.replace(/^https?:\/\//, '')}) — textes, logo, identité visuelle et code — est
            protégé par le droit de la propriété intellectuelle. Toute reproduction sans autorisation préalable est interdite.
          </p>
          <p>
            Les projets signalés « Démonstration » sont des exemples fictifs, réalisés pour illustrer notre savoir-faire ; ils ne
            représentent pas des clients. Les photographies utilisées dans ces démonstrations proviennent d’Unsplash (licence Unsplash).
          </p>

          <h2>Données personnelles et cookies</h2>
          <p>
            Le traitement des informations envoyées via le formulaire de contact est décrit dans notre{' '}
            <a href="/politique-de-confidentialite">politique de confidentialité</a>. Le site n’utilise aucun cookie publicitaire ni
            outil de mesure d’audience.
          </p>
        </div>
      </main>
      <Footer content={content} />
    </>
  );
};

export const PrivacyPolicy = ({ content }: { content: SiteContent }) => {
  const l = content.legal;
  return (
    <>
      <Header content={content} />
      <main id="contenu" class="legal">
        <div class="container legal__inner">
          <h1>Politique de confidentialité</h1>
          <PendingNotice content={content} />

          <h2>Responsable du traitement</h2>
          <p>
            <V value={l.companyName} />
            {l.address ? <>, {l.address}</> : null}. Contact :{' '}
            {l.contactEmail ? <a href={`mailto:${l.contactEmail}`}>{l.contactEmail}</a> : <V value="" />}.
          </p>

          <h2>Données collectées</h2>
          <p>Via le formulaire de contact uniquement : nom, entreprise (facultatif), adresse e-mail, téléphone (facultatif), type de projet et message.</p>

          <h2>Finalité et base légale</h2>
          <p>
            Ces informations servent exclusivement à répondre à votre demande et à échanger avec vous sur votre projet (mesures
            précontractuelles prises à votre demande — article 6.1.b du RGPD). Elles ne sont utilisées pour aucune prospection
            commerciale et aucune inscription à une liste de diffusion n’est effectuée.
          </p>

          <h2>Destinataires</h2>
          <p>
            Les données sont accessibles uniquement à l’équipe Nexora. Elles sont stockées chez notre hébergeur et, si la notification
            par e-mail est activée, transmises à notre prestataire d’envoi d’e-mails, dans le seul but de nous prévenir de votre demande.
            Elles ne sont jamais vendues ni cédées.
          </p>

          <h2>Durée de conservation</h2>
          <p>
            <V value={l.retentionPeriod} /> à compter de notre dernier échange, puis suppression.
          </p>

          <h2>Vos droits</h2>
          <p>
            Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité de vos
            données. Pour les exercer, écrivez-nous à{' '}
            {l.contactEmail ? <a href={`mailto:${l.contactEmail}`}>{l.contactEmail}</a> : <V value="" />}. Vous pouvez également
            adresser une réclamation à la CNIL (<a href="https://www.cnil.fr" rel="noopener noreferrer">www.cnil.fr</a>).
          </p>

          <h2>Cookies</h2>
          <p>
            Le site public ne dépose aucun cookie de mesure d’audience ou publicitaire. Seul l’espace d’administration utilise un cookie
            de session strictement nécessaire à la connexion.
          </p>

          <h2>Sécurité</h2>
          <p>
            Les échanges sont chiffrés (HTTPS), l’accès aux demandes est réservé aux administrateurs authentifiés et les données ne sont
            pas journalisées en clair.
          </p>
        </div>
      </main>
      <Footer content={content} />
    </>
  );
};
