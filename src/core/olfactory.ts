/**
 * Perfil olfativo: a pirâmide (saída, coração, fundo), acordes, família, perfumista, ano — sempre com a fonte.
 * Nada aqui é inventado: o que nenhuma fonte confirma fica vazio. Não existe "porcentagem" de nota: a ordem
 * dos acordes é a da fonte, e só.
 */

export interface SourceRef {
  name: string;
  url: string;
}

export interface OlfactoryProfile {
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  /** Quando a fonte só lista as notas sem separar em camadas. */
  notes: string[];
  mainAccords: string[];
  fragranceFamily: string | null;
  perfumer: string | null;
  releaseYear: number | null;
  /** Fonte principal das notas. */
  source: string | null;
  sourceUrl: string | null;
  /** Todas as fontes consultadas que contribuíram com algum campo. */
  sources: SourceRef[];
  lastUpdated: string;
}

const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '')
    .trim();

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "of the" fica de fora: "Lily of the Valley" é nota. O que denuncia frase é verbo e adjetivo de marketing.
const PROSE = /\b(with|that|this|is|are|its|reveals?|delivering|adding|sets?|opens?|burst|layers?|blended|inviting|sophisticated|elegance|core|energetic|uplifting|wildly|highly|impeccably)\b/i;

let rejected = 0;

/** Quantas partes a última chamada de splitNotes descartou por parecerem frase, não nota. */
export const lastRejected = () => rejected;

export function splitNotes(text: string): string[] {
  rejected = 0;
  const out: string[] = [];
  for (const raw of text.split(/,|;|\s\/\s|\s+and\s+|\s+et\s+|\s+y\s+|\s+e\s+|\s*&\s*|·|•|\n/i)) {
    const n = clean(raw).replace(/\.$/, '');
    if (!n || n.length > 40 || /^(notes?|and|et)$/i.test(n)) continue;
    // Nota é um nome curto; frase de marketing ("Delivering an energetic burst") não é nota.
    if (n.split(/\s+/).length > 4 || PROSE.test(n)) {
      rejected++;
      continue;
    }
    const c = cap(n);
    if (!out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out.slice(0, 14);
}

const LAYER = {
  top: /(?:top|head|opening)\s*notes?|notes?\s+de\s+t[êe]te|notas?\s+de\s+(?:sa[íi]da|salida|topo)|kopfnoten|\btop\b\s*:/i,
  heart: /(?:heart|middle|mid)\s*notes?|notes?\s+de\s+c(?:œ|oe)ur|notas?\s+de\s+(?:cora[çc][ãa]o|coraz[óo]n|corpo)|herznoten|\bheart\b\s*:|\bmiddle\b\s*:/i,
  base: /(?:base|bottom|dry\s*down)\s*notes?|notes?\s+de\s+fond|notas?\s+de\s+(?:fundo|fondo|base)|basisnoten|\bbase\b\s*:/i,
};

/**
 * Notas escritas em texto livre de loja ("Top Notes: Pineapple, Bergamot… Middle Notes: … Base Notes: …").
 * Devolve nulo quando não há as três camadas reconhecíveis — melhor nada do que uma pirâmide torta.
 */
export function parseNotesText(raw: string): Pick<OlfactoryProfile, 'topNotes' | 'heartNotes' | 'baseNotes'> | null {
  const text = raw.replace(/<\/(p|li|div|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const find = (re: RegExp) => {
    const m = re.exec(text);
    return m ? { index: m.index, end: m.index + m[0].length } : null;
  };
  const top = find(LAYER.top);
  const heart = find(LAYER.heart);
  const base = find(LAYER.base);
  if (!top || !heart || !base || !(top.index < heart.index && heart.index < base.index)) return null;
  const slice = (from: number, to: number) => text.slice(from, to).replace(/^[\s:–-]+/, '');
  // O fundo termina na primeira quebra de parágrafo ou frase longa depois das notas.
  const baseText = slice(base.end, text.length).split(/\n\s*\n|\n(?=[A-Z][a-z]+ [a-z]+ [a-z]+)|(?<=\w)\.\s+(?=[A-Z])|No BPOM|Size|Volume|Concentration|Longevity/)[0];
  let prose = 0;
  const layer = (t: string) => {
    const notes = splitNotes(t);
    prose += lastRejected();
    return notes;
  };
  const result = {
    topNotes: layer(slice(top.end, heart.index)),
    heartNotes: layer(slice(heart.end, base.index)),
    baseNotes: layer(baseText),
  };
  if (!result.topNotes.length || !result.heartNotes.length || !result.baseNotes.length) return null;
  // Descrições genéricas ("Fresh, Lemony, Fruity") não são notas: se tudo termina em -y/-ish, recusa.
  const all = [...result.topNotes, ...result.heartNotes, ...result.baseNotes];
  if (prose > all.length * 0.3) return null;
  if (all.filter((n) => /(y|ish)$/i.test(n)).length / all.length > 0.6) return null;
  return result;
}

export function sanitizeProfile(raw: unknown): OlfactoryProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => clean(x).slice(0, 40))
          .filter(Boolean)
          .slice(0, 16)
      : [];
  const str = (v: unknown, max: number) => (typeof v === 'string' && clean(v) ? clean(v).slice(0, max) : null);
  const url = (v: unknown) => {
    if (typeof v !== 'string') return null;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch {
      return null;
    }
  };
  const profile: OlfactoryProfile = {
    topNotes: list(r.topNotes),
    heartNotes: list(r.heartNotes),
    baseNotes: list(r.baseNotes),
    notes: list(r.notes),
    mainAccords: list(r.mainAccords).slice(0, 8),
    fragranceFamily: str(r.fragranceFamily, 60),
    perfumer: str(r.perfumer, 120),
    releaseYear: typeof r.releaseYear === 'number' && r.releaseYear > 1800 && r.releaseYear < 2100 ? Math.round(r.releaseYear) : null,
    source: str(r.source, 60),
    sourceUrl: url(r.sourceUrl),
    sources: Array.isArray(r.sources)
      ? r.sources
          .map((s) => (s && typeof s === 'object' ? { name: str((s as SourceRef).name, 60), url: url((s as SourceRef).url) } : null))
          .filter((s): s is SourceRef => Boolean(s?.name && s.url))
          .slice(0, 6)
      : [],
    lastUpdated: typeof r.lastUpdated === 'string' && !Number.isNaN(Date.parse(r.lastUpdated)) ? r.lastUpdated : new Date().toISOString(),
  };
  const empty = !profile.topNotes.length && !profile.heartNotes.length && !profile.baseNotes.length && !profile.notes.length && !profile.mainAccords.length;
  return empty ? null : profile;
}

export const hasPyramid = (p: OlfactoryProfile | null) => Boolean(p && (p.topNotes.length || p.heartNotes.length || p.baseNotes.length));
