import { describe, expect, it } from 'vitest';
import seed from '../apps/web/src/data/seed.json';
import { concentrationAdjust, nameSimilarity } from '@perfumes/core/match';
import { accordLabel, noteLabel } from '@perfumes/core/notes-pt';
import { parseNotesText, sanitizeProfile } from '@perfumes/core/olfactory';
import { ASSET_VERSION, sanitizePerfume } from '@perfumes/core/perfume';
import { assessCutout } from '@perfumes/core/quality';

describe('mesmo perfume?', () => {
  it('reconhece títulos enfeitados de loja', () => {
    expect(nameSimilarity('Club de Nuit Elite', 'Club de Nuit Elite ARMAF 105ml', 'Armaf')).toBeGreaterThan(0.9);
    expect(nameSimilarity("Supremacy Collector's Edition", 'supremacy collector s edition', 'Afnan')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Island Dreams', 'KHADLAJ ISLAND DREAMS 100 ML EXTRAIT DE PARFUM', 'Khadlaj')).toBeGreaterThan(0.9);
  });

  it('recusa outra versão da mesma linha', () => {
    expect(nameSimilarity('Supremacy In Heaven', 'Supremacy Noir', 'Afnan')).toBeLessThan(0.5);
    expect(nameSimilarity('Club de Nuit Precieux', 'Armaf Club de Nuit Precieux IV Extrait De Parfum - 55ML For Women', 'Armaf')).toBeLessThan(0.72);
    expect(nameSimilarity('Reflection', 'Mykonos - Reflection Elixir Extrait de Parfum 50ml', 'Mykonos')).toBeLessThan(0.72);
  });

  it('concentração conta: Sauvage EDP não é Sauvage EDT', () => {
    const edp = nameSimilarity('Sauvage', 'Sauvage Eau de Parfum', 'Dior') + concentrationAdjust('Sauvage Eau de Parfum', 'Eau de Parfum');
    const edt = nameSimilarity('Sauvage', 'Sauvage Eau de Toilette', 'Dior') + concentrationAdjust('Sauvage_Eau_de_Toilette', 'Eau de Parfum');
    expect(edp).toBeGreaterThan(edt);
    expect(edt).toBeLessThan(0.72);
  });

  it('aceita o "I" da edição original', () => {
    expect(nameSimilarity('Club de Nuit Precieux', 'Club de Nuit Precieux I', 'Armaf')).toBeGreaterThanOrEqual(0.72);
  });
});

describe('notas escritas em texto de loja', () => {
  it('lê a pirâmide da descrição oficial', () => {
    const p = parseNotesText('<p>Top Notes: Grapefruit, Ginger, Bergamot</p><p>Middle Notes: Marine Notes, Cardamom, Lily of the Valley</p><p>Base Notes: Musk, Patchouli, Amber, Ambroxan</p><p>No BPOM : NA182506</p>');
    expect(p?.topNotes).toEqual(['Grapefruit', 'Ginger', 'Bergamot']);
    expect(p?.heartNotes).toContain('Lily of the Valley');
    expect(p?.baseNotes).toEqual(['Musk', 'Patchouli', 'Amber', 'Ambroxan']);
  });

  it('recusa texto de marketing no lugar de notas', () => {
    const text =
      'Top notes: Juicy tropical pineapple, Delivering an energetic burst of pure joy, Sets a wonderfully uplifting mood. Heart notes: The core reveals a highly sophisticated tiare, Adding layers of dense elegance. Base notes: Smooth vanilla, Impeccably blended musk.';
    expect(parseNotesText(text)).toBeNull();
  });

  it('recusa descrição genérica ("Fresh, Lemony, Fruity")', () => {
    expect(parseNotesText('Top Notes: Fresh, Lemony, Fruity Middle Notes: Amber, Floral, Musky Base Notes: Musky, Smokey, Woody')).toBeNull();
  });

  it('perfil sem nada útil vira nulo', () => {
    expect(sanitizeProfile({ topNotes: [], sources: [] })).toBeNull();
  });

  it('traduz notas e acordes consagrados, mantém o resto', () => {
    expect(noteLabel('Bergamot')).toBe('Bergamota');
    expect(noteLabel('Mahonial')).toBe('Mahonial');
    expect(accordLabel('woody')).toBe('Amadeirado');
  });
});

describe('avaliação de foto recortada', () => {
  function canvas(w: number, h: number, draw: (x: number, y: number) => boolean) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (draw(x, y)) data.set([60, 90, 120, 255], (y * w + x) * 4);
    return data;
  }

  it('frasco inteiro e centrado é aceito', () => {
    const data = canvas(200, 300, (x, y) => x > 60 && x < 140 && y > 40 && y < 280);
    const r = assessCutout(data, 200, 300, true, 1200);
    expect(r.accepted).toBe(true);
  });

  it('frasco cortado pela borda de cima é recusado', () => {
    const data = canvas(200, 300, (x, y) => x > 60 && x < 140 && y < 280);
    const r = assessCutout(data, 200, 300, true, 1200);
    expect(r.accepted).toBe(false);
    expect(r.reasons.join()).toMatch(/cortado/);
  });

  it('caixa ao lado do frasco perde pontos; tampa separada não', () => {
    const withBox = canvas(300, 300, (x, y) => (x > 30 && x < 110 && y > 60 && y < 280) || (x > 150 && x < 270 && y > 40 && y < 280));
    expect(assessCutout(withBox, 300, 300, true, 1200).reasons.join()).toMatch(/caixa|objeto/);
    const withCap = canvas(200, 300, (x, y) => (x > 60 && x < 140 && y > 90 && y < 280) || (x > 85 && x < 115 && y > 40 && y < 85));
    expect(assessCutout(withCap, 200, 300, true, 1200).reasons.join()).not.toMatch(/caixa/);
  });
});

describe('coleção migrada', () => {
  it('os 14 da planilha têm foto nova, origem da foto e perfil olfativo com fonte', () => {
    const list = (seed as unknown[]).map(sanitizePerfume);
    for (const p of list) {
      expect(p!.assetVersion).toBe(ASSET_VERSION);
      expect(p!.imageSource?.url).toMatch(/^https:\/\//);
      expect(p!.olfactoryProfile?.sources.length).toBeGreaterThan(0);
      expect(p!.olfactoryProfile!.topNotes.length + p!.olfactoryProfile!.notes.length).toBeGreaterThan(0);
      expect(p!.accentColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
