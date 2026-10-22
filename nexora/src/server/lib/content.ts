import { z } from 'zod';

/**
 * Contenus éditables depuis /admin/contenus. Le contenu est séparé de la présentation :
 * chaque champ est un texte simple (jamais du HTML), avec une longueur maximale qui protège la mise en page.
 * Les parties mises en couleur vin (« nouvelle dimension », « résultats visibles. », « commence ici. »)
 * sont des champs distincts : on ne stocke ni balise ni style.
 */
const line = (max: number) => z.string().trim().max(max);
const optionalEmail = z.union([z.literal(''), z.string().trim().max(160).email()]);
const optionalPhone = z.union([z.literal(''), z.string().trim().max(30).regex(/^[+0-9 ().-]{6,30}$/)]);
/** Lien de prise de rendez-vous (Cal.com, Calendly…) : https uniquement. */
const optionalHttpsUrl = z.union([z.literal(''), z.string().trim().max(300).url().startsWith('https://')]);
/** Numéro WhatsApp au format international (ex. : +33 6 12 34 56 78). */
const optionalWhatsapp = z.union([z.literal(''), z.string().trim().max(24).regex(/^\+[0-9 ]{8,22}$/)]);

/** Champs numérotés (services 1–5, étapes 1–4…) : la mise en page reste fixe, seuls les textes changent. */
type Upto<N extends number, A extends number[] = [1]> = A['length'] extends N ? A[number] : Upto<N, [...A, [...A, 0]['length']]>;
function numbered<P extends string, N extends number, K extends string>(prefix: P, count: N, fields: Record<K, number>) {
  const shape: Record<string, z.ZodString> = {};
  for (let i = 1; i <= count; i++) for (const [k, max] of Object.entries(fields) as [K, number][]) shape[`${prefix}${i}${k}`] = line(max);
  return shape as Record<`${P}${Upto<N>}${K}`, z.ZodString>;
}

export const contentSchema = z.object({
  hero: z.object({
    titleBefore: line(80),
    titleHighlight: line(60),
    titleAfter: line(80),
    subtitle: line(240),
    /** Public visé et zone d'intervention (positionnement). */
    audience: line(180),
    /** Bouton principal : mène toujours au formulaire de demande de devis (jamais « Réserver » sans réservation). */
    ctaQuote: line(40).min(1),
    /** Bouton secondaire : mène à « Nos réalisations » (concepts et projets clients, chacun avec son statut). */
    ctaWork: line(40).min(1),
    reassurance: line(80),
  }),
  header: z.object({ ctaQuote: line(32).min(1) }),
  /** Preuve sociale : uniquement des données RÉELLES (chiffres vérifiables, avis publics…). Vide = section masquée. */
  proof: z.object({ title: line(80), ...numbered('item', 4, { Value: 16, Label: 80 }) }),
  services: z.object({ title: line(60), titleHighlight: line(60), subtitle: line(200), cta: line(40), ...numbered('s', 5, { Title: 50, Text: 200 }) }),
  method: z.object({ title: line(60), titleHighlight: line(60), subtitle: line(200), ...numbered('m', 4, { Title: 50, Text: 300 }) }),
  /** « Derrière Nexora » : personne RÉELLE uniquement (nom, fonction, texte ; photo envoyée dans l'admin). Vide = masqué. */
  team: z.object({ title: line(60), name: line(80), role: line(120), text: line(700), photoAlt: line(160) }),
  /**
   * « Nos réalisations » : projets clients (résultats vérifiables) puis concepts, chacun avec son statut affiché.
   * Le sous-titre doit rester vrai dans les deux cas : il explique la différence entre les deux statuts.
   */
  projects: z.object({
    title: line(60),
    titleHighlight: line(60),
    subtitle: line(260),
    visitLabel: line(30).min(1),
    caseLabel: line(30).min(1),
    detailsLabel: line(40).min(1),
    emptyText: line(160),
  }),
  /** Témoignages : uniquement des citations RÉELLES, avec l'accord écrit de la personne. Vide = section masquée. */
  testimonials: z.object({ title: line(60), ...numbered('t', 3, { Quote: 400, Author: 80, Role: 120 }) }),
  faq: z.object({ title: line(60), titleHighlight: line(60), ...numbered('q', 7, { Question: 140, Answer: 700 }) }),
  contact: z.object({
    titleLine1: line(60),
    titleHighlight: line(60),
    text: line(240),
    responsePromise: line(80),
    formTitle: line(60).min(1),
    successMessage: line(240).min(1),
    bookingUrl: optionalHttpsUrl,
    bookingLabel: line(40).min(1),
    bookingText: line(160),
    whatsappNumber: optionalWhatsapp,
    whatsappMessage: line(160),
    publicEmail: optionalEmail,
    publicPhone: optionalPhone,
  }),
  footer: z.object({ tagline: line(60) }),
  /**
   * Référencement. `areaServed` : villes ou zones réellement desservies, séparées par des virgules (données structurées
   * et pied de page). Aucune adresse n'est publiée tant que l'adresse réelle n'est pas saisie dans « Informations légales ».
   */
  seo: z.object({ title: line(70).min(1), description: line(170).min(1), areaServed: line(200) }),
  legal: z.object({
    companyName: line(120),
    legalForm: line(80),
    shareCapital: line(60),
    address: line(240),
    siret: line(40),
    rcs: line(80),
    vatNumber: line(40),
    publicationDirector: line(120),
    contactEmail: optionalEmail,
    hostName: line(120),
    hostAddress: line(240),
    hostPhone: line(40),
    retentionPeriod: line(80),
  }),
});

export type SiteContent = z.infer<typeof contentSchema>;

const empty = (prefix: string, count: number, keys: string[]) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => keys.map((k) => [`${prefix}${i + 1}${k}`, ''])).flat()) as Record<string, string>;

export const defaultContent: SiteContent = {
  hero: {
    titleBefore: 'Création de sites web',
    titleHighlight: 'premium',
    titleAfter: 'pour les PME.',
    subtitle: 'Des sites rapides et sur mesure, pensés pour transformer vos visiteurs en demandes de devis.',
    // Zone d'intervention : à ajuster dans Admin › Contenus si elle change (aucune adresse n'est affichée).
    audience: 'Sites vitrines, refontes et boutiques en ligne pour PME et indépendants partout en France.',
    ctaQuote: 'Demander un devis',
    ctaWork: 'Voir nos réalisations',
    reassurance: 'Devis gratuit et sans engagement · Réponse sous 1 jour ouvré',
  },
  header: { ctaQuote: 'Demander un devis' },
  // À REMPLIR uniquement avec des données réelles (ex. : « 4,9/5 » + « note moyenne sur Google, 32 avis »).
  proof: { title: 'En quelques chiffres', ...empty('item', 4, ['Value', 'Label']) } as SiteContent['proof'],
  services: {
    title: 'Nos',
    titleHighlight: 'services.',
    subtitle: 'De la création à la maintenance : tout ce qu’il faut pour un site qui vous ressemble et qui travaille pour vous.',
    cta: 'Demander un devis',
    s1Title: 'Création de sites web',
    s1Text: 'Sites vitrines et boutiques en ligne sur mesure : un message clair, une navigation simple et des demandes faciles à envoyer.',
    s2Title: 'Refonte de sites existants',
    s2Text: 'Votre site actuel repensé : structure, contenus et design remis à plat pour que vos visiteurs trouvent l’essentiel.',
    s3Title: 'Responsive design',
    s3Text: 'Un affichage soigné sur téléphone, tablette et ordinateur, testé sur les écrans que vos clients utilisent vraiment.',
    s4Title: 'Optimisation des performances',
    s4Text: 'Pages plus légères et plus rapides, mesurées avec les outils de Google : une meilleure expérience et un meilleur référencement.',
    s5Title: 'Maintenance et accompagnement',
    s5Text: 'Mises à jour, sauvegardes, petites évolutions et conseils après la mise en ligne, selon le niveau de suivi que vous choisissez.',
  },
  method: {
    title: 'Notre',
    titleHighlight: 'processus.',
    subtitle: 'Quatre étapes claires, du premier échange à la mise en ligne : vous savez à chaque moment ce qui est fait, quand et pourquoi.',
    m1Title: 'Découverte',
    m1Text: 'Un premier échange pour comprendre votre activité, vos clients et vos objectifs. Vous recevez ensuite une proposition écrite : périmètre, planning et budget.',
    m2Title: 'Conception',
    m2Text: 'Arborescence, contenus et maquettes : la structure et le design sont validés avec vous avant toute ligne de code.',
    m3Title: 'Développement',
    m3Text: 'Le site est développé sur mesure, rapide et accessible. Vous suivez l’avancement et donnez votre avis au bon moment.',
    m4Title: 'Mise en ligne',
    m4Text: 'Contrôle de la vitesse, du référencement et des formulaires, puis mise en ligne. Nous restons disponibles pour les premiers ajustements.',
  },
  projects: {
    title: 'Nos',
    titleHighlight: 'réalisations.',
    subtitle:
      'Des sites conçus et développés par Nexora. Chaque projet indique son statut : « Projet client » (livré, avec ses résultats) ou « Concept » (réalisé sans commande client, pour montrer notre méthode).',
    visitLabel: 'Voir le site',
    caseLabel: 'Lire l’étude de cas',
    detailsLabel: 'Contexte, solution et objectif',
    emptyText: 'Nos premières réalisations seront bientôt présentées ici.',
  },
  // « Derrière Nexora » : À REMPLIR avec la personne réelle (aucun nom, parcours ni photo inventés). Vide = masqué.
  team: { title: 'Derrière Nexora', name: '', role: '', text: '', photoAlt: '' },
  // À REMPLIR uniquement avec des témoignages réels (citation exacte, nom et fonction, accord écrit).
  testimonials: { title: 'Ils nous ont confié leur site', ...empty('t', 3, ['Quote', 'Author', 'Role']) } as SiteContent['testimonials'],
  faq: {
    title: 'Questions',
    titleHighlight: 'fréquentes.',
    q1Question: 'Combien de temps faut-il pour réaliser un site ?',
    q1Answer:
      'Cela dépend du périmètre : un site vitrine demande moins de temps qu’une boutique en ligne ou qu’une refonte avec reprise de contenus. Le calendrier est fixé par écrit dans la proposition, après le premier échange, avec des étapes de validation datées.',
    q2Question: 'Quel budget faut-il prévoir ?',
    q2Answer:
      'Chaque projet fait l’objet d’un devis détaillé et gratuit après le premier échange, selon le nombre de pages, les fonctionnalités et les contenus à produire. Le prix est fixé avant le démarrage ; toute évolution est chiffrée et validée avec vous avant d’être réalisée.',
    q3Question: 'Qui s’occupe de la maintenance après la mise en ligne ?',
    q3Answer:
      'Les modalités de maintenance — mises à jour, sauvegardes, surveillance, petites évolutions — sont précisées dans la proposition. Vous choisissez le niveau d’accompagnement adapté à votre activité.',
    q4Question: 'Le site sera-t-il bien référencé sur Google ?',
    q4Answer:
      'Le site est construit pour le référencement naturel : pages rapides, structure claire, contenus et balises optimisés, affichage parfait sur mobile. Personne ne peut garantir honnêtement une position précise sur Google ; nous vous montrons ce qui est fait et comment suivre les résultats.',
    q5Question: 'À qui appartient le site ?',
    q5Answer:
      'Le nom de domaine est enregistré à votre nom et vos contenus vous appartiennent. Les conditions de cession du site et de son code sont précisées par écrit dans la proposition, avant le démarrage.',
    q6Question: 'Comment se déroule la collaboration ?',
    q6Answer:
      'Après le premier échange, vous avez un interlocuteur dédié du début à la fin. Chaque étape — conception, développement, mise en ligne — se termine par votre validation. Les échanges se font en visioconférence, par téléphone ou par e-mail, selon ce qui vous convient.',
    q7Question: 'Travaillez-vous avec des entreprises partout en France ?',
    q7Answer:
      'Oui. Nexora accompagne les PME et indépendants partout en France. Les échanges se font en visioconférence, par téléphone ou par e-mail, selon ce qui vous convient.',
  },
  contact: {
    titleLine1: 'Votre prochain site',
    titleHighlight: 'commence ici.',
    text: 'Décrivez votre projet en quelques lignes : nous revenons vers vous avec un premier avis et les prochaines étapes.',
    responsePromise: 'Nous vous répondons sous 1 jour ouvré.',
    formTitle: 'Votre projet',
    successMessage: 'Merci, votre demande a bien été enregistrée. Nous vous répondons sous 1 jour ouvré.',
    bookingUrl: '',
    bookingLabel: 'Réserver un créneau de 20 min',
    bookingText: 'Choisissez directement un créneau pour un premier échange de 20 minutes, sans engagement.',
    whatsappNumber: '',
    whatsappMessage: 'Bonjour, je souhaite parler d’un projet de site web.',
    publicEmail: '',
    publicPhone: '',
  },
  footer: { tagline: 'Création de sites web' },
  seo: {
    title: 'Nexora — Création de sites web premium pour PME',
    description: 'Création et refonte de sites web sur mesure, rapides et responsive pour PME et indépendants partout en France.',
    areaServed: 'France',
  },
  // Informations légales : À COMPLÉTER avant publication (aucune donnée inventée).
  legal: {
    companyName: '',
    legalForm: '',
    shareCapital: '',
    address: '',
    siret: '',
    rcs: '',
    vatNumber: '',
    publicationDirector: '',
    contactEmail: '',
    hostName: '',
    hostAddress: '',
    hostPhone: '',
    retentionPeriod: '',
  },
};

/** Lignes numérotées d'une section (ex. : services s1…s4) sous forme de liste. */
export function rows<T extends string>(section: Record<string, string>, prefix: string, count: number, keys: readonly T[]) {
  return Array.from({ length: count }, (_, i) => Object.fromEntries(keys.map((k) => [k, section[`${prefix}${i + 1}${k}`] ?? ''])) as Record<T, string>);
}

/** Lien WhatsApp (wa.me) à partir du numéro international et du message par défaut. */
export function whatsappHref(c: SiteContent['contact']) {
  if (!c.whatsappNumber) return null;
  const digits = c.whatsappNumber.replace(/\D/g, '');
  return `https://wa.me/${digits}${c.whatsappMessage ? `?text=${encodeURIComponent(c.whatsappMessage)}` : ''}`;
}

export const LEGAL_REQUIRED: { key: keyof SiteContent['legal']; label: string }[] = [
  { key: 'companyName', label: 'Raison sociale' },
  { key: 'legalForm', label: 'Forme juridique' },
  { key: 'address', label: 'Adresse du siège' },
  { key: 'siret', label: 'SIRET' },
  { key: 'publicationDirector', label: 'Directeur de la publication' },
  { key: 'contactEmail', label: 'E-mail de contact (mentions légales / RGPD)' },
  { key: 'hostName', label: 'Hébergeur — nom' },
  { key: 'hostAddress', label: 'Hébergeur — adresse' },
  { key: 'retentionPeriod', label: 'Durée de conservation des demandes de contact' },
];

export function missingLegal(c: SiteContent) {
  return LEGAL_REQUIRED.filter((f) => !c.legal[f.key]);
}

/** Fusionne une valeur stockée (éventuellement ancienne ou partielle) avec les valeurs par défaut. */
export function mergeContent(stored: unknown): SiteContent {
  const out = structuredClone(defaultContent) as Record<string, Record<string, string>>;
  if (stored && typeof stored === 'object') {
    for (const [section, fields] of Object.entries(stored as Record<string, unknown>)) {
      if (!(section in out) || !fields || typeof fields !== 'object') continue;
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        if (k in out[section] && typeof v === 'string') out[section][k] = v;
      }
    }
  }
  const parsed = contentSchema.safeParse(out);
  return parsed.success ? parsed.data : defaultContent;
}

export const PROJECT_TYPES = [
  'Création de site vitrine',
  'Création de boutique en ligne',
  'Refonte de site existant',
  'Adaptation mobile (responsive)',
  'Optimisation des performances',
  'Maintenance et accompagnement',
  'Autre',
] as const;

/** Type de projet présélectionné dans le formulaire depuis chaque service (dans l'ordre des services 1 à 5). */
export const SERVICE_PROJECT_TYPES = [
  'Création de site vitrine',
  'Refonte de site existant',
  'Adaptation mobile (responsive)',
  'Optimisation des performances',
  'Maintenance et accompagnement',
] as const satisfies readonly (typeof PROJECT_TYPES)[number][];

/** Zones desservies (Référencement › zones) sous forme de liste. */
export function areaList(c: SiteContent) {
  return c.seo.areaServed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Typographie française : espace insécable avant : et », après « ; espace fine insécable avant ? ! ; — aucun signe ne
 * se retrouve seul en début de ligne. Appliquée à l'affichage seulement (le texte saisi dans l'admin n'est pas modifié).
 */
export function frTypo(text: string) {
  return text
    .replace(/[ \u00A0\u202F]([?!;])/g, '\u202F$1')
    .replace(/[ \u00A0\u202F]([:»])/g, '\u00A0$1')
    .replace(/«[ \u00A0\u202F]/g, '«\u00A0');
}

/** Contenu prêt à afficher : typographie française sur tous les textes (adresses, liens et numéros inchangés). */
export function displayContent(c: SiteContent): SiteContent {
  const keep = /url|email|phone|number/i;
  const out = structuredClone(c) as Record<string, Record<string, string>>;
  for (const section of Object.values(out)) for (const k of Object.keys(section)) if (!keep.test(k)) section[k] = frTypo(section[k]);
  return out as unknown as SiteContent;
}

/** Champs facultatifs de qualification du formulaire de contact (listes fermées : modifiables ici). */
export const BUDGETS = ['Moins de 1 000 €', '2 000 à 3 000 €', '3 000 à 6 000 €', '6 000 à 12 000 €', 'Plus de 12 000 €', 'Je ne sais pas encore'] as const;
export const TIMELINES = ['Dès que possible', 'Dans 1 à 3 mois', 'Dans 3 à 6 mois', 'Pas de date précise'] as const;
