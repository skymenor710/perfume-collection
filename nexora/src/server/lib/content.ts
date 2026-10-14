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

export const contentSchema = z.object({
  hero: z.object({
    titleBefore: line(80),
    titleHighlight: line(60),
    titleAfter: line(80),
    subtitle: line(140),
    primaryCta: line(40).min(1),
    secondaryCta: line(40).min(1),
  }),
  header: z.object({ cta: line(40).min(1) }),
  projects: z.object({
    eyebrow: line(60),
    titleLine1: line(60),
    titleLine2Before: line(30),
    titleLine2Highlight: line(60),
    subtitle: line(140),
    visitLabel: line(30).min(1),
    emptyText: line(160),
  }),
  contact: z.object({
    titleLine1: line(60),
    titleHighlight: line(60),
    text: line(160),
    cta: line(40).min(1),
    successMessage: line(240).min(1),
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

export const defaultContent: SiteContent = {
  hero: {
    titleBefore: 'Des sites qui donnent une',
    titleHighlight: 'nouvelle dimension',
    titleAfter: 'à votre entreprise.',
    subtitle: 'Design sur mesure. Performance. Expérience intuitive.',
    primaryCta: 'Découvrir nos réalisations',
    secondaryCta: 'Parlons de votre projet',
  },
  header: { cta: 'Parlons de votre projet' },
  projects: {
    eyebrow: 'Aperçus de démonstration',
    titleLine1: 'Des projets concrets.',
    titleLine2Before: 'Des',
    titleLine2Highlight: 'résultats visibles.',
    subtitle: 'Une sélection de nos créations.',
    visitLabel: 'Voir le site',
    emptyText: 'Nos premières réalisations seront bientôt présentées ici.',
  },
  contact: {
    titleLine1: 'Votre prochain site',
    titleHighlight: 'commence ici.',
    text: 'Parlons de votre activité et de vos ambitions.',
    cta: 'Discutons de votre projet',
    successMessage: 'Merci, votre demande a bien été enregistrée. Nous revenons vers vous rapidement.',
    publicEmail: '',
    publicPhone: '',
  },
  footer: { tagline: 'Création de sites web' },
  seo: {
    title: 'Nexora — Création de sites web sur mesure',
    description: 'Nexora conçoit des sites web sur mesure pour les entreprises : design soigné, performance et expérience intuitive.',
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
