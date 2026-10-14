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

/** Champs numérotés (services 1–4, étapes 1–3…) : la mise en page reste fixe, seuls les textes changent. */
type Upto<N extends number> = N extends 3 ? 1 | 2 | 3 : N extends 4 ? 1 | 2 | 3 | 4 : 1 | 2 | 3 | 4 | 5 | 6;
function numbered<P extends string, N extends 3 | 4 | 6, K extends string>(prefix: P, count: N, fields: Record<K, number>) {
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
    /** Public visé (positionnement) : texte neutre par défaut, à préciser avec la cible réelle. */
    audience: line(140),
    /** « Réserver… » uniquement si un lien de rendez-vous est configuré ; sinon « Demander… » (vers le formulaire). */
    primaryCta: line(40).min(1),
    primaryCtaFallback: line(40).min(1),
    /** « Découvrir nos concepts » tant qu'aucun projet client avec résultats n'est publié. */
    secondaryCta: line(40).min(1),
    secondaryCtaResults: line(40).min(1),
    reassurance: line(80),
  }),
  header: z.object({ cta: line(32).min(1), ctaFallback: line(32).min(1) }),
  /** Preuve sociale : uniquement des données RÉELLES (chiffres vérifiables, avis publics…). Vide = section masquée. */
  proof: z.object({ title: line(80), ...numbered('item', 4, { Value: 16, Label: 80 }) }),
  services: z.object({ title: line(60), titleHighlight: line(60), subtitle: line(200), cta: line(40), ...numbered('s', 4, { Title: 50, Text: 200 }) }),
  method: z.object({ title: line(60), titleHighlight: line(60), subtitle: line(200), ...numbered('m', 3, { Title: 50, Text: 300 }) }),
  /** « Derrière Nexora » : personne RÉELLE uniquement (nom, fonction, texte ; photo envoyée dans l'admin). Vide = masqué. */
  team: z.object({ title: line(60), name: line(80), role: line(120), text: line(700), photoAlt: line(160) }),
  projects: z.object({
    eyebrow: line(60),
    titleLine1: line(60),
    titleLine2Before: line(30),
    titleLine2Highlight: line(60),
    subtitle: line(200),
    visitLabel: line(30).min(1),
    caseLabel: line(30).min(1),
    emptyText: line(160),
    /** Section « Résultats clients » : projets clients publiés (jamais les concepts). */
    resultsTitle: line(60),
    resultsSubtitle: line(200),
  }),
  /** Témoignages : uniquement des citations RÉELLES, avec l'accord écrit de la personne. Vide = section masquée. */
  testimonials: z.object({ title: line(60), ...numbered('t', 3, { Quote: 400, Author: 80, Role: 120 }) }),
  faq: z.object({ title: line(60), titleHighlight: line(60), ...numbered('q', 6, { Question: 140, Answer: 700 }) }),
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
  seo: z.object({ title: line(70).min(1), description: line(170).min(1) }),
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
    titleBefore: 'Des sites web pensés pour',
    titleHighlight: 'générer des demandes,',
    titleAfter: 'pas seulement des compliments.',
    subtitle:
      'Nous concevons des sites rapides et sur mesure pour les entreprises qui veulent transformer leur présence en ligne en opportunités commerciales.',
    // Texte NEUTRE par défaut : à préciser (secteurs, taille, zone géographique) seulement avec la cible réelle.
    audience: 'Sites vitrines, refontes, e-commerce et automatisations pour PME, indépendants et entreprises de services.',
    primaryCta: 'Réserver un diagnostic de 20 min',
    primaryCtaFallback: 'Demander un diagnostic',
    secondaryCta: 'Découvrir nos concepts',
    secondaryCtaResults: 'Voir des résultats clients',
    reassurance: 'Sans engagement · Réponse sous 1 jour ouvré',
  },
  header: { cta: 'Réserver un diagnostic', ctaFallback: 'Demander un diagnostic' },
  // À REMPLIR uniquement avec des données réelles (ex. : « 4,9/5 » + « note moyenne sur Google, 32 avis »).
  proof: { title: 'En quelques chiffres', ...empty('item', 4, ['Value', 'Label']) } as SiteContent['proof'],
  services: {
    title: 'Ce que nous construisons',
    titleHighlight: 'pour votre croissance.',
    subtitle: 'Quatre façons de transformer votre présence en ligne en opportunités commerciales.',
    cta: 'Parler de ce projet',
    s1Title: 'Sites vitrines',
    s1Text: 'Un site qui présente clairement votre offre et transforme les visites en demandes de devis ou de rendez-vous.',
    s2Title: 'Refonte de site',
    s2Text: 'Votre site actuel repensé, plus rapide et mieux structuré, pour que vos visiteurs trouvent l’essentiel et vous contactent.',
    s3Title: 'E-commerce',
    s3Text: 'Une boutique pensée pour vendre : parcours d’achat simple, fiches produits claires, paiement sans friction.',
    s4Title: 'Automatisations et outils digitaux',
    s4Text: 'Prises de rendez-vous, devis, relances et formulaires automatisés : moins de tâches manuelles, aucune demande oubliée.',
  },
  method: {
    title: 'Comment',
    titleHighlight: 'nous travaillons.',
    subtitle: 'Un cadre clair, du premier échange à la mise en ligne : vous savez à chaque étape ce qui est fait, quand et pourquoi.',
    m1Title: 'Diagnostic et stratégie',
    m1Text:
      'Un échange de 20 minutes pour comprendre votre activité, vos clients et vos objectifs. Vous recevez ensuite une proposition écrite : périmètre, planning et budget.',
    m2Title: 'Design et développement',
    m2Text:
      'Les maquettes sont validées avec vous avant toute ligne de code, puis le site est développé sur mesure. Vous suivez l’avancement et donnez votre avis au bon moment.',
    m3Title: 'Lancement et optimisation',
    m3Text:
      'Mise en ligne, contrôle de la vitesse et du référencement, suivi des demandes reçues. Les ajustements s’appuient ensuite sur des données réelles.',
  },
  projects: {
    eyebrow: '',
    titleLine1: 'Nos concepts de sites',
    titleLine2Before: '',
    titleLine2Highlight: 'à forte conversion.',
    subtitle: 'Découvrez notre approche : contexte, solution apportée et principes de conversion appliqués à chaque concept.',
    visitLabel: 'Voir le projet',
    caseLabel: 'Lire l’étude de cas',
    emptyText: 'Nos premiers concepts seront bientôt présentés ici.',
    resultsTitle: 'Résultats clients',
    resultsSubtitle: 'Des projets livrés, avec leurs résultats vérifiables et l’avis de nos clients.',
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
      'Cela dépend du périmètre : un site vitrine demande moins de temps qu’une boutique en ligne ou qu’une refonte avec reprise de contenus. Le calendrier est fixé par écrit dans la proposition, après le diagnostic, avec des étapes de validation datées.',
    q2Question: 'Quel budget faut-il prévoir ?',
    q2Answer:
      'Chaque projet fait l’objet d’un devis détaillé après le diagnostic, selon le nombre de pages, les fonctionnalités et les contenus à produire. Le prix est fixé avant le démarrage ; toute évolution est chiffrée et validée avec vous avant d’être réalisée.',
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
      'Après le diagnostic, vous avez un interlocuteur dédié du début à la fin. Chaque étape — maquettes, développement, mise en ligne — se termine par votre validation. Les échanges se font en visioconférence, par téléphone ou par e-mail, selon ce qui vous convient.',
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
    title: 'Nexora — Sites web sur mesure qui génèrent des demandes',
    description:
      'Nexora conçoit des sites rapides et sur mesure — vitrines, refontes, e-commerce, automatisations — pour transformer votre présence en ligne en clients.',
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
  'Site vitrine',
  'Refonte de site',
  'Site e-commerce',
  'Automatisation et outils digitaux',
  'Autre',
] as const;

/** Champs facultatifs de qualification du formulaire de contact (listes fermées : modifiables ici). */
export const BUDGETS = ['Moins de 3 000 €', '3 000 à 6 000 €', '6 000 à 12 000 €', 'Plus de 12 000 €', 'Je ne sais pas encore'] as const;
export const TIMELINES = ['Dès que possible', 'Dans 1 à 3 mois', 'Dans 3 à 6 mois', 'Pas de date précise'] as const;
