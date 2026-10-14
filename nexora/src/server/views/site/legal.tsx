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
            Les projets signalés « Démonstration » sont des maquettes conçues par Nexora (prospection ou projets internes) : ils ne
            représentent pas des clients. Les noms et coordonnées des entreprises concernées sont masqués.
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

/** `analytics` : nom de l'outil de mesure d'audience s'il est configuré (chargé seulement après consentement). */
export const PrivacyPolicy = ({ content, analytics }: { content: SiteContent; analytics?: string | null }) => {
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
          <p>
            Via le formulaire de contact : nom, entreprise (facultatif), adresse e-mail, téléphone (facultatif), type de projet, budget
            estimatif et délai souhaité (facultatifs) et message.
          </p>
          {content.contact.bookingUrl ? (
            <p>
              La prise de rendez-vous en ligne est assurée par un service tiers (outil de réservation) : les informations que vous y
              saisissez sont traitées selon sa propre politique de confidentialité.
            </p>
          ) : null}

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

          <h2>Cookies et mesure d’audience</h2>
          {analytics ? (
            <p>
              Avec votre accord uniquement (bandeau affiché à votre première visite, choix modifiable à tout moment via le lien « Mesure
              d’audience » en bas de page), nous utilisons {analytics} pour mesurer la fréquentation du site et l’usage de ses boutons,
              de façon agrégée. Sans accord, aucun outil de mesure n’est chargé. Votre choix est mémorisé dans votre navigateur pendant
              6 mois. Aucun cookie publicitaire n’est utilisé. Seul l’espace d’administration utilise un cookie de session strictement
              nécessaire à la connexion.
            </p>
          ) : (
            <p>
              Le site public ne dépose aucun cookie de mesure d’audience ou publicitaire et ne charge aucun outil de mesure. Seul l’espace
              d’administration utilise un cookie de session strictement nécessaire à la connexion.
            </p>
          )}

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
