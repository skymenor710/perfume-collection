import { z } from 'zod';
import { BUDGETS, PROJECT_TYPES, TIMELINES } from './content';
import { hmac, safeEqual } from './crypto';

/** Validation serveur du formulaire (la validation du navigateur n'est qu'un confort). */
const text = (max: number) => z.string().trim().max(max);

export const contactSchema = z.object({
  name: text(120).min(1, 'Indiquez votre nom.'),
  company: text(160).optional().default(''),
  email: z.string().trim().toLowerCase().max(160).email('Indiquez une adresse e-mail valide (ex. : nom@entreprise.fr).'),
  phone: z.union([z.literal(''), z.string().trim().regex(/^[+0-9 ().-]{6,30}$/, 'Numéro de téléphone invalide.')]).optional().default(''),
  projectType: z.enum(PROJECT_TYPES, { message: 'Choisissez un type de projet.' }),
  budget: z.union([z.literal(''), z.enum(BUDGETS)], { message: 'Choisissez une valeur de la liste.' }).optional().default(''),
  timeline: z.union([z.literal(''), z.enum(TIMELINES)], { message: 'Choisissez une valeur de la liste.' }).optional().default(''),
  message: text(4000).min(10, 'Décrivez votre projet en quelques mots (10 caractères minimum).'),
});

export type ContactInput = z.infer<typeof contactSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message.startsWith('Invalid') || issue.message.startsWith('Too') ? 'Valeur invalide.' : issue.message;
  }
  return out;
}

/** Jeton du formulaire : horodatage signé. Sert à détecter les envois automatiques trop rapides. */
export function issueFormToken(secret: string, now = Date.now()) {
  const ts = String(now);
  return `${ts}.${hmac(secret, `contact:${ts}`).slice(0, 22)}`;
}

export type TokenCheck = 'ok' | 'too-fast' | 'invalid' | 'missing';
export const MIN_FILL_MS = 2500;

export function checkFormToken(secret: string, token: unknown, now = Date.now()): TokenCheck {
  if (typeof token !== 'string' || !token) return 'missing';
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return 'invalid';
  if (!safeEqual(sig, hmac(secret, `contact:${ts}`).slice(0, 22))) return 'invalid';
  const age = now - Number(ts);
  if (age < MIN_FILL_MS) return 'too-fast';
  return 'ok';
}

/** Messages « spam » typiques : trop de liens. */
export function looksLikeSpam(input: ContactInput) {
  const links = (input.message.match(/https?:\/\/|www\./gi) ?? []).length;
  return links > 3;
}
