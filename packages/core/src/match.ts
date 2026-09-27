/**
 * "Este produto é o mesmo perfume?" — comparação de nomes vindos de lojas diferentes.
 * Lojas enfeitam títulos ("Armaf Club De Nuit Maleka Eau de Parfum (EDP) 105 ML - Floral Fruity Perfume for Women");
 * a comparação tira marca, concentração, volume e palavras de marketing, e mede o quanto os nomes se cobrem.
 * Variações são o perigo (Supremacy In Heaven × Supremacy Noir; Reflection × Reflection Elixir): palavra
 * que só um dos lados tem pesa contra.
 */

import { detectConcentration } from './normalize';

const STOP = new Set([
  'eau', 'de', 'parfum', 'perfume', 'parfume', 'toilette', 'cologne', 'extrait', 'edp', 'edt', 'edc', 'the', 'by', 'for', 'pour',
  'homme', 'femme', 'men', 'women', 'man', 'woman', 'unisex', 'unisexe', 'mixte', 'ml', 'fl', 'oz', 'spray', 'vaporisateur', 'natural',
  'fragrance', 'fragrances', 'new', 'original', 'luxury', 'long', 'lasting', 'and', 'et', 'e', 'y', 'with', 'le', 'la', 'les', 'du', 'des',
  'x', 'official', 'gift', 'tester',
]);

/** Palavras que marcam OUTRO perfume da mesma linha: se só um lado tem, não é o mesmo. */
const VARIANT = new Set([
  'intense', 'elixir', 'noir', 'black', 'gold', 'silver', 'pink', 'red', 'blue', 'white', 'rouge', 'night', 'day', 'sport', 'absolute',
  'absolu', 'extreme', 'limited', 'edition', 'collector', 'collectors', 'rebel', 'oud', 'royal', 'prive', 'privé', 'heaven', 'gala', 'incense',
  'men', 'women', 'maleka', 'imperiale', 'urban', 'elite', 'precieux', 'untold', 'milestone', 'sillage', 'iconic', 'blanc', 'ghost', 'snow', 'pure',
]);

export function tokens(text: string, brand?: string | null): string[] {
  const brandTokens = new Set((brand ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/\d+\s*(ml|g|oz)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    // "collector-s" (slug de "Collector's") deixa um "s" solto: letras soltas não identificam nada.
    .filter((t) => t && !STOP.has(t) && !brandTokens.has(t) && !/^\d{2,}$/.test(t) && !/^[a-hj-uw-z]$/.test(t));
}

/** Numeral de edição (II, IV, 2…) só num dos lados = outro perfume. "I"/"1" é tratado como a edição original. */
const EDITION = /^(ii|iii|iv|v|vi|vii|viii|ix|x|[2-9])$/;

/** 0–1. Acima de ~0.75 é o mesmo perfume; abaixo de 0.5, outro. */
export function nameSimilarity(wanted: string, candidate: string, brand?: string | null): number {
  const a = new Set(tokens(wanted, brand));
  const b = new Set(tokens(candidate, brand));
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  const recall = common / a.size;
  const precision = common / b.size;
  let score = (2 * recall * precision) / (recall + precision || 1);
  // Palavra de variante presente só num dos lados: quase certamente outro perfume da linha.
  for (const t of b) if (!a.has(t) && (VARIANT.has(t) || EDITION.test(t))) score -= 0.35;
  for (const t of a) if (!b.has(t) && (VARIANT.has(t) || EDITION.test(t))) score -= 0.35;
  // "I" do outro lado não conta contra (a edição original às vezes leva o numeral, às vezes não).
  if (b.has('i') && !a.has('i')) score += (1 - score) * 0.5 * Number(common === a.size);
  return Math.max(0, Math.min(1, score));
}

/**
 * Mesma linha, concentrações diferentes (Sauvage EDT × EDP × Elixir) são perfumes diferentes.
 * Quando o título da candidata declara uma concentração e ela não bate com a procurada, perde pontos;
 * quando bate, ganha um pouco (desempata "Sauvage (Eau de Parfum)" × "Sauvage (Eau de Toilette)").
 */
export function concentrationAdjust(candidateTitle: string, wanted: string | null | undefined): number {
  if (!wanted) return 0;
  const found = detectConcentration(candidateTitle.replace(/[_-]+/g, ' '));
  if (!found) return 0;
  return found === wanted ? 0.05 : -0.3;
}

export function brandMatches(wanted: string | null, candidate: string | null): boolean {
  if (!wanted || !candidate) return false;
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(perfumes?|parfums?|fragrances?|global|official)$/g, '');
  const a = norm(wanted);
  const b = norm(candidate);
  return Boolean(a && b && (a === b || a.startsWith(b) || b.startsWith(a)));
}
