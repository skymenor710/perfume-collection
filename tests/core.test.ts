import { describe, expect, it } from 'vitest';
import seed from '../apps/web/src/data/seed.json';
import { dominantColor, hexToRgb, oklabToRgb, rgbToHex, rgbToOklab } from '@perfumes/core/color';
import { opaqueBounds, removeBackground } from '@perfumes/core/cutout';
import { cleanName, detectConcentration, detectGender, detectVolume, guessFromUrl, parsePrice } from '@perfumes/core/normalize';
import { findDuplicate, safeHttpUrl, safeImageRef, sanitizePerfume, type Perfume } from '@perfumes/core/perfume';
import { accentFor } from '@perfumes/core/accent';
import { cleanDescription, extractProduct, looksBlocked, upgradeImageUrl } from '../apps/server/src/import/extract';
import { parseRobots, robotsAllows } from '../apps/server/src/net/polite';

/** Foto sintética: fundo liso, um "frasco" retangular com corpo de uma cor e tampa de outra. */
function productPhoto(bg: [number, number, number], body: [number, number, number], cap: [number, number, number], w = 120, h = 160) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = bg;
      if (x >= 35 && x < 85 && y >= 60 && y < 150) c = body;
      if (x >= 50 && x < 70 && y >= 35 && y < 60) c = cap;
      data.set([...c, 255], i);
    }
  }
  return { data, w, h };
}

describe('cor', () => {
  it('ida e volta sRGB ↔ OKLab', () => {
    for (const hex of ['#ff0000', '#2b7a3d', '#eceef2', '#050507']) {
      expect(rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))))).toBe(hex);
    }
  });

  it('ignora o fundo branco e acha a cor do frasco', () => {
    const { data, w, h } = productPhoto([255, 255, 255], [40, 150, 60], [200, 170, 90]);
    const cut = removeBackground(data, w, h);
    expect(cut.removed).toBe(true);
    const color = dominantColor(data, w, h, true);
    expect(color.neutral).toBe(false);
    const { r, g, b } = hexToRgb(color.hex);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('frasco preto num fundo branco é neutro, não "branco"', () => {
    const { data, w, h } = productPhoto([250, 250, 250], [25, 25, 28], [180, 180, 185]);
    removeBackground(data, w, h);
    const color = dominantColor(data, w, h, true);
    expect(color.neutral).toBe(true);
    expect(hexToRgb(color.hex).r).toBeLessThan(90);
  });

  it('sotaque tem croma limitado: verde-limão não vira boate', () => {
    const lab = accentFor('#aaff00');
    expect(Math.hypot(lab.a, lab.b)).toBeLessThanOrEqual(0.146);
    expect(lab.L).toBeLessThanOrEqual(0.8);
    const silver = accentFor('#232323');
    expect(Math.hypot(silver.a, silver.b)).toBeLessThan(0.02);
  });
});

describe('recorte', () => {
  it('não recorta foto de ambiente (borda sem cor lisa)', () => {
    const w = 60;
    const h = 60;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([(i * 37) % 255, (i * 91) % 255, (i * 53) % 255, 255], i * 4);
    expect(removeBackground(data, w, h).removed).toBe(false);
  });

  it('corta a caixa no que é visível', () => {
    const { data, w, h } = productPhoto([255, 255, 255], [90, 60, 160], [90, 60, 160]);
    removeBackground(data, w, h);
    const box = opaqueBounds(data, w, h, 0)!;
    expect(box.x).toBe(35);
    expect(box.width).toBe(50);
    expect(box.y).toBe(35);
  });
});

describe('normalização de texto de loja', () => {
  it('limpa o título da loja', () => {
    expect(cleanName('Afnan Supremacy In Heaven Eau de Parfum pour homme | notino.fr', 'Afnan')).toBe('Supremacy In Heaven');
    expect(cleanName('Club de Nuit Elite ARMAF 105ml', 'ARMAF')).toBe('Club de Nuit Elite');
  });

  it('reconhece concentração, volume e gênero', () => {
    expect(detectConcentration('Extrait de Parfum mixte 55 ml')).toBe('Extrait de Parfum');
    expect(detectConcentration('Hawas EDP 100ml')).toBe('Eau de Parfum');
    expect(detectVolume('Empire Extrait de Parfum 50ml & 100ml')).toBe('50/100 ml');
    expect(detectVolume('Spectre Ghost 80 ml')).toBe('80 ml');
    expect(detectGender('Eau de Parfum mixte')).toBe('unisex');
    expect(detectGender('pour homme')).toBe('masculine');
  });

  it('palpite pelo endereço quando a página não abre', () => {
    const g = guessFromUrl('https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/');
    expect(g).toMatchObject({ brand: 'Afnan', name: 'Supremacy In Heaven', concentration: 'Eau de Parfum', gender: 'unisex' });
    expect(guessFromUrl('https://www.amazon.fr/dp/B0FN4NVWGJ').name).toBeNull();
  });

  it('entende preços em formato europeu e britânico', () => {
    expect(parsePrice('35,10 €')).toEqual({ price: 35.1, currency: 'EUR' });
    expect(parsePrice('£29.99')).toEqual({ price: 29.99, currency: 'GBP' });
    expect(parsePrice('1.234,50 €').price).toBe(1234.5);
  });
});

describe('extração de página', () => {
  const html = `<html><head><title>X | loja</title>
    <meta property="og:site_name" content="Parfum City">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Rayhaan Cedrus Blanc 100ml","brand":{"@type":"Brand","name":"Parfum City"},
    "description":"Cedrus Blanc van Rayhaan is een Bloemig Houtachtig Musk geur voor dames en heren.","image":["https://cdn.example.com/a.webp"],
    "offers":{"@type":"Offer","price":"39.95","priceCurrency":"EUR"}}</script></head><body>${'x'.repeat(3000)}</body></html>`;

  it('lê JSON-LD e desconfia da loja se passando por marca', () => {
    const d = extractProduct(html, 'https://www.parfumcity.nl/fr/products/rayhaan-cedrus-blanc-100ml');
    expect(d.brand).toBeNull();
    expect(d.price).toBe(39.95);
    expect(d.volume).toBe('100 ml');
    expect(d.images[0]).toBe('https://cdn.example.com/a.webp');
  });

  it('reconhece página de bloqueio e texto de SEO', () => {
    expect(looksBlocked(403, '<title>Just a moment...</title>')).toBe(true);
    expect(looksBlocked(200, html)).toBe(false);
    expect(cleanDescription('Achetez Parfum Nusuk Ateeq ✓ Livraison & retours gratuits possibles (voir conditions)')).toBeNull();
  });

  it('troca miniatura pela foto grande', () => {
    expect(upgradeImageUrl('https://cdn.notinoimg.com/order_2k/afnan/x.jpg')).toBe('https://cdn.notinoimg.com/detail_main_hq/afnan/x.jpg');
    expect(upgradeImageUrl('https://a.com/cdn/shop/files/foo_1200x1200.png?v=1')).toBe('https://a.com/cdn/shop/files/foo.png?v=1');
  });
});

describe('robots.txt', () => {
  const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nDisallow: /*?sort=\nAllow: /search/help\n');
  it('respeita o grupo *', () => {
    expect(robotsAllows(rules, '/afnan/supremacy/')).toBe(true);
    expect(robotsAllows(rules, '/search?q=x')).toBe(false);
    expect(robotsAllows(rules, '/search/help')).toBe(true);
    expect(robotsAllows(rules, '/p?sort=price')).toBe(false);
  });
});

describe('modelo de dados', () => {
  it('a semente tem os 14 perfumes da planilha, com links reais e fotos', () => {
    const list = (seed as unknown[]).map(sanitizePerfume);
    expect(list).toHaveLength(14);
    for (const p of list) {
      expect(p).not.toBeNull();
      expect(p!.sourceUrl).toMatch(/^https:\/\//);
      expect(p!.imageUrl).toMatch(/^bottles\/.+-lg\.webp$/);
      expect(p!.status).toBe('wishlist');
      expect(p!.origin).toBe('google-sheet');
    }
    expect(new Set(list.map((p) => p!.id)).size).toBe(14);
  });

  it('dado corrompido ou hostil não passa', () => {
    expect(sanitizePerfume({ id: 'x' })).toBeNull();
    expect(sanitizePerfume(null)).toBeNull();
    const p = sanitizePerfume({ id: 'a-1', name: '<img src=x onerror=alert(1)>Oud', sourceUrl: 'javascript:alert(1)', imageUrl: 'javascript:1', status: 'hacked', personalRating: 'good', price: -3 })!;
    expect(p.name).toBe('Oud');
    expect(p.sourceUrl).toBeNull();
    expect(p.imageUrl).toBeNull();
    expect(p.status).toBe('wishlist');
    expect(p.personalRating).toBeNull();
    expect(p.price).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeImageRef('/_blob/abc123')).toBe('/_blob/abc123');
  });

  it('acha duplicata pela URL (sem www/barra final) ou pelo nome', () => {
    const list = (seed as unknown[]).map(sanitizePerfume) as Perfume[];
    expect(findDuplicate(list, { sourceUrl: 'https://notino.fr/khadlaj/shiyaaka-snow-eau-de-parfum-pour-homme', brand: null, name: 'x' })?.name).toBe('Shiyaaka Snow');
    expect(findDuplicate(list, { sourceUrl: null, brand: 'afnan', name: 'Supremacy in heaven' })?.id).toBe('afnan-supremacy-in-heaven');
    expect(findDuplicate(list, { sourceUrl: null, brand: 'Lattafa', name: 'Khamrah' })).toBeNull();
  });
});
