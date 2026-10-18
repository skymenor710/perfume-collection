import type { SiteContent } from '../../lib/content';
import type { TeamPhoto } from '../../lib/repo';
import type { Base } from './base';
import { AdminShell, Csrf } from './layout';

/* ---------------------------------------------------------------- Contenus */
type FieldDef = { key: string; label: string; max: number; multiline?: boolean; hint?: string; type?: string };
const repeat = (prefix: string, count: number, label: string, parts: { key: string; label: string; max: number; multiline?: boolean; type?: string }[]): FieldDef[] =>
  Array.from({ length: count }, (_, i) => parts.map((f) => ({ ...f, key: `${prefix}${i + 1}${f.key}`, label: `${label} ${i + 1} — ${f.label}` }))).flat();

const CONTENT_FORM: { section: keyof SiteContent; title: string; intro?: string; fields: FieldDef[] }[] = [
  {
    section: 'hero',
    title: 'Bannière d’accueil',
    intro:
      'Le titre est composé de trois parties ; la partie centrale s’affiche en couleur vin. Le bouton principal mène toujours au formulaire de demande de devis ; le bouton secondaire mène à « Nos réalisations ».',
    fields: [
      { key: 'titleBefore', label: 'Titre — début', max: 80 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'titleAfter', label: 'Titre — fin', max: 80 },
      { key: 'subtitle', label: 'Sous-titre (bénéfice, une phrase)', max: 240, multiline: true },
      { key: 'audience', label: 'Public visé et zone d’intervention', max: 180, hint: 'N’indiquez que des villes ou zones réellement desservies.' },
      { key: 'ctaQuote', label: 'Bouton principal (formulaire de devis)', max: 40 },
      { key: 'ctaWork', label: 'Bouton secondaire (réalisations)', max: 40 },
      { key: 'reassurance', label: 'Mention sous les boutons', max: 80 },
    ],
  },
  {
    section: 'header',
    title: 'En-tête',
    fields: [{ key: 'ctaQuote', label: 'Bouton (formulaire de devis)', max: 32 }],
  },
  {
    section: 'proof',
    title: 'Preuve sociale (chiffres)',
    intro:
      'UNIQUEMENT des données réelles et vérifiables (note Google et nombre d’avis, nombre de sites livrés…). Un chiffre s’affiche quand sa valeur ET sa légende sont remplies ; tant que tout est vide, la bande n’existe pas sur le site.',
    fields: [{ key: 'title', label: 'Titre (lu par les lecteurs d’écran)', max: 80 }, ...repeat('item', 4, 'Chiffre', [{ key: 'Value', label: 'valeur (ex. : 4,9/5)', max: 16 }, { key: 'Label', label: 'légende', max: 80 }])],
  },
  {
    section: 'services',
    title: 'Services',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 200 },
      { key: 'cta', label: 'Lien sous chaque service', max: 40 },
      ...repeat('s', 5, 'Service', [{ key: 'Title', label: 'titre', max: 50 }, { key: 'Text', label: 'bénéfice (une phrase)', max: 200, multiline: true }]),
    ],
  },
  {
    section: 'method',
    title: 'Processus',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 200 },
      ...repeat('m', 4, 'Étape', [{ key: 'Title', label: 'titre', max: 50 }, { key: 'Text', label: 'texte', max: 300, multiline: true }]),
    ],
  },
  {
    section: 'team',
    title: 'Derrière Nexora',
    intro: 'Personne RÉELLE uniquement. La section apparaît quand le nom et le texte sont remplis ; la photo s’envoie plus bas sur cette page.',
    fields: [
      { key: 'title', label: 'Titre', max: 60 },
      { key: 'name', label: 'Nom', max: 80 },
      { key: 'role', label: 'Fonction / spécialité', max: 120 },
      { key: 'text', label: 'Texte (manière de travailler : écoute, stratégie, clarté, accompagnement)', max: 700, multiline: true },
      { key: 'photoAlt', label: 'Description de la photo (texte alternatif)', max: 160 },
    ],
  },
  {
    section: 'projects',
    title: 'Nos réalisations',
    intro:
      'Les textes de chaque projet se remplissent dans Projets. Les projets clients (case « concept » décochée) s’affichent en premier avec le badge « Projet client » et leurs résultats ; les concepts suivent avec le badge « Concept / Démonstration ». Le sous-titre doit rester vrai dans les deux cas.',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'subtitle', label: 'Sous-titre', max: 260, multiline: true },
      { key: 'detailsLabel', label: 'Bouton du détail repliable (contexte, solution…)', max: 40 },
      { key: 'visitLabel', label: 'Bouton vers le site', max: 30 },
      { key: 'caseLabel', label: 'Bouton vers l’étude de cas', max: 30 },
      { key: 'emptyText', label: 'Texte si aucun projet publié', max: 160 },
    ],
  },
  {
    section: 'testimonials',
    title: 'Témoignages',
    intro: 'UNIQUEMENT des citations réelles, avec l’accord écrit de la personne (nom et fonction exacts). Un témoignage s’affiche quand la citation ET le nom sont remplis ; tant que tout est vide, la section n’existe pas sur le site.',
    fields: [
      { key: 'title', label: 'Titre', max: 60 },
      ...repeat('t', 3, 'Témoignage', [
        { key: 'Quote', label: 'citation', max: 400, multiline: true },
        { key: 'Author', label: 'nom', max: 80 },
        { key: 'Role', label: 'fonction et entreprise', max: 120 },
      ]),
    ],
  },
  {
    section: 'faq',
    title: 'Questions fréquentes',
    intro: 'Relisez chaque réponse : elle engage l’entreprise (délais, budget, propriété du site…).',
    fields: [
      { key: 'title', label: 'Titre — début', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      ...repeat('q', 7, 'Question', [{ key: 'Question', label: 'question', max: 140 }, { key: 'Answer', label: 'réponse', max: 700, multiline: true }]),
    ],
  },
  {
    section: 'contact',
    title: 'Section Contact',
    fields: [
      { key: 'titleLine1', label: 'Titre — ligne 1', max: 60 },
      { key: 'titleHighlight', label: 'Titre — partie en vin', max: 60 },
      { key: 'text', label: 'Texte', max: 240, multiline: true },
      { key: 'responsePromise', label: 'Engagement de réponse', max: 80 },
      { key: 'formTitle', label: 'Titre du formulaire', max: 60 },
      { key: 'successMessage', label: 'Message après envoi', max: 240, multiline: true },
      { key: 'bookingUrl', label: 'Lien de prise de rendez-vous (Cal.com, Calendly…)', max: 300, type: 'url', hint: 'https://… — Proposé dans la section Contact. Cal.com et Calendly s’ouvrent dans une fenêtre intégrée, les autres dans un nouvel onglet. Vide : pas de bloc de rendez-vous.' },
      { key: 'bookingLabel', label: 'Bouton de prise de rendez-vous', max: 40 },
      { key: 'bookingText', label: 'Texte du bloc de prise de rendez-vous', max: 160 },
      { key: 'whatsappNumber', label: 'Numéro WhatsApp (facultatif)', max: 24, type: 'tel', hint: 'Format international : +33 6 12 34 56 78. Vide : pas de bouton WhatsApp.' },
      { key: 'whatsappMessage', label: 'Message WhatsApp prérempli', max: 160 },
      { key: 'publicEmail', label: 'E-mail affiché (facultatif)', max: 160, type: 'email' },
      { key: 'publicPhone', label: 'Téléphone affiché (facultatif)', max: 30, type: 'tel' },
    ],
  },
  { section: 'footer', title: 'Pied de page', fields: [{ key: 'tagline', label: 'Accroche sous le logo', max: 60 }] },
  {
    section: 'seo',
    title: 'Référencement',
    fields: [
      { key: 'title', label: 'Titre de la page (onglet, Google)', max: 70 },
      { key: 'description', label: 'Description (Google, partages)', max: 170, multiline: true },
      { key: 'areaServed', label: 'Zones desservies (séparées par des virgules)', max: 200, hint: 'Données structurées (Google) et pied de page. Uniquement des zones réellement desservies ; l’adresse vient des informations légales.' },
    ],
  },
  {
    section: 'legal',
    title: 'Informations légales',
    intro: 'Obligatoires avant la mise en ligne (mentions légales et politique de confidentialité). Rien n’est rempli automatiquement.',
    fields: [
      { key: 'companyName', label: 'Raison sociale', max: 120 },
      { key: 'legalForm', label: 'Forme juridique (ex. : SAS, EI)', max: 80 },
      { key: 'shareCapital', label: 'Capital social (si société)', max: 60 },
      { key: 'address', label: 'Adresse du siège', max: 240, multiline: true },
      { key: 'siret', label: 'SIRET', max: 40 },
      { key: 'rcs', label: 'RCS (ville et numéro, si applicable)', max: 80 },
      { key: 'vatNumber', label: 'N° de TVA intracommunautaire', max: 40 },
      { key: 'publicationDirector', label: 'Directeur de la publication', max: 120 },
      { key: 'contactEmail', label: 'E-mail de contact (droits RGPD)', max: 160, type: 'email' },
      { key: 'hostName', label: 'Hébergeur — nom', max: 120 },
      { key: 'hostAddress', label: 'Hébergeur — adresse', max: 240, multiline: true },
      { key: 'hostPhone', label: 'Hébergeur — téléphone', max: 40 },
      { key: 'retentionPeriod', label: 'Durée de conservation des demandes (ex. : 3 ans)', max: 80 },
    ],
  },
];

export const ContentPage = ({
  session,
  assets,
  flash,
  newRequests,
  values,
  errors,
  teamPhoto,
  maxMb,
}: Base & { values: SiteContent; errors?: Record<string, string>; teamPhoto?: TeamPhoto | null; maxMb?: number }) => (
  <AdminShell title="Contenus du site" section="content" session={session} assets={assets} flash={flash} newRequests={newRequests}>
    <p class="lede">Les textes sont publiés dès l’enregistrement. La mise en page est fixe : seuls les textes changent, avec une longueur maximale pour préserver le design.</p>
    <form method="post" action="/admin/contenus" class="form" novalidate>
      <Csrf token={session.csrfToken} />
      {CONTENT_FORM.map((group) => (
        <fieldset class="panel">
          <legend>{group.title}</legend>
          {group.intro ? <p class="muted">{group.intro}</p> : null}
          <div class="fields-grid">
            {group.fields.map((f) => {
              const name = `${group.section}.${f.key}`;
              const id = `c-${group.section}-${f.key}`;
              const value = (values[group.section] as Record<string, string>)[f.key] ?? '';
              const error = errors?.[name];
              return (
                <div class={`field${f.multiline ? ' field--full' : ''}`}>
                  <label for={id}>{f.label}</label>
                  {f.multiline ? (
                    <textarea id={id} name={name} maxlength={f.max} rows={3} aria-invalid={error ? 'true' : undefined}>
                      {value}
                    </textarea>
                  ) : (
                    <input id={id} name={name} type={f.type ?? 'text'} value={value} maxlength={f.max} aria-invalid={error ? 'true' : undefined} />
                  )}
                  {error ? <p class="field__error">{error}</p> : f.hint ? <p class="field__hint">{f.hint}</p> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div class="sticky-actions">
        <button class="btn btn--primary" type="submit">
          Enregistrer et publier
        </button>
      </div>
    </form>

    <section class="panel" aria-labelledby="team-photo-title" id="photo-equipe">
      <h2 id="team-photo-title">Photo — Derrière Nexora</h2>
      <p class="muted">
        Photo RÉELLE du fondateur ou de l’équipe, format portrait (4:5) conseillé, {maxMb ?? 12} Mo maximum. Optimisée automatiquement,
        métadonnées supprimées. Elle n’apparaît que si la section « Derrière Nexora » a un nom et un texte.
      </p>
      {teamPhoto ? (
        <div class="team-photo">
          <img src={`/media/${teamPhoto.id}/480.webp`} width="240" height={Math.round((240 * teamPhoto.height) / teamPhoto.width)} alt="Photo actuelle" />
          <form method="post" action="/admin/contenus/photo/supprimer" class="form" data-confirm="Supprimer la photo ?">
            <Csrf token={session.csrfToken} />
            <button class="btn btn--danger" type="submit">
              Supprimer la photo
            </button>
          </form>
        </div>
      ) : null}
      <form method="post" action="/admin/contenus/photo" enctype="multipart/form-data" class="upload">
        <Csrf token={session.csrfToken} />
        <label for="f-team-photo">{teamPhoto ? 'Remplacer la photo' : 'Choisir une photo'}</label>
        <input id="f-team-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/avif" required />
        <button class="btn btn--primary" type="submit">
          Envoyer
        </button>
      </form>
    </section>
  </AdminShell>
);
