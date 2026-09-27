import { describe, expect, it } from 'vitest';
import { BOTTLE_CANVAS, placeInCanvas } from '@perfumes/core/canvas';
import { sanitizePerfume } from '@perfumes/core/perfume';
import { assessCutout } from '@perfumes/core/quality';
import { parseDuckDuckGoHtml } from '../apps/server/src/resolver/search';
import { analyzeUrl, identityFromDatabaseUrl } from '../apps/server/src/resolver/url';

describe('o link é pista, não fonte', () => {
  it('tira rastreadores e âncora, mas guarda o link como foi colado', () => {
    const raw = 'https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/?utm_source=google&gclid=abc&srsltid=x#reviews';
    const clue = analyzeUrl(raw)!;
    expect(clue.original).toBe(raw.replace('#reviews', '#reviews'));
    expect(clue.normalized).toBe('https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/');
    expect(clue.host).toBe('notino.fr');
  });

  it('lê marca, nome e concentração de um slug longo', () => {
    const clue = analyzeUrl('https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/')!;
    expect(clue.guess.brand?.toLowerCase()).toBe('afnan');
    expect(clue.guess.name?.toLowerCase()).toContain('supremacy in heaven');
    expect(clue.guess.concentration).toMatch(/Eau de Parfum/i);
  });

  it('link sem nome (Amazon /dp/ASIN) vira identificador para a busca', () => {
    const clue = analyzeUrl('https://www.amazon.fr/dp/B0CHX1W1XY?psc=1&ref_=abc')!;
    expect(clue.ids.asin).toBe('B0CHX1W1XY');
    expect(clue.normalized).not.toContain('psc=');
  });

  it('Amazon com nome no link: o nome vem antes de /dp/, nunca "ref=sr_1_3"', () => {
    const g = analyzeUrl('https://www.amazon.fr/Armaf-Club-Nuit-Intense-Toilette/dp/B01M0BV1ZV/ref=sr_1_3?keywords=club+de+nuit')!.guess;
    expect(g.name).toBe('Armaf Club Nuit Intense Toilette');
  });

  it('código de produto grudado no slug não vira nome', () => {
    expect(analyzeUrl('https://www.sephora.fr/p/good-girl---eau-de-parfum-P3372018.html')!.guess.name).toBe('Good Girl');
    expect(analyzeUrl('https://www.nocibe.fr/lattafa-khamrah-eau-de-parfum-100-ml-s274180')!.guess.name).toBe('Lattafa Khamrah');
    const long = analyzeUrl('https://www.parfumdreams.fr/Lattafa/Asad-Eau-de-Parfum-Spray-100-ml-pour-homme-oriental-epice/index_97112.aspx')!.guess;
    expect(long.brand).toBe('Lattafa');
    expect(long.name).toMatch(/^Asad\b/);
    expect(long.name).not.toMatch(/index|97112|spray/i);
  });

  it('código de produto da loja (notino p-123456)', () => {
    expect(analyzeUrl('https://www.notino.fr/dior/sauvage-eau-de-parfum-pour-homme/p-15676518/')!.ids.storeCode).toBe('15676518');
  });

  it('recusa o que não é página web', () => {
    expect(analyzeUrl('javascript:alert(1)')).toBeNull();
    expect(analyzeUrl('não é link')).toBeNull();
    expect(analyzeUrl('ftp://exemplo.com/a')).toBeNull();
  });

  it('identidade escrita no endereço de uma base de perfumes', () => {
    expect(identityFromDatabaseUrl('https://www.fragrantica.com/perfume/Afnan/Supremacy-in-Heaven-60567.html')).toMatchObject({ brand: 'Afnan', name: 'Supremacy in Heaven' });
    expect(identityFromDatabaseUrl('https://www.exemplo.com/perfume/a/b')).toBeNull();
  });
});

describe('busca', () => {
  it('desembrulha os links do DuckDuckGo e deixa anúncios de fora', () => {
    const html = `
      <div class="result"><a class="result__a" href="//duckduckgo.com/y.js?ad_domain=loja.com&u3=x">Anúncio</a></div>
      <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.afnan.com%2Fproducts%2Fsupremacy-in-heaven&rut=1">Supremacy In Heaven – Afnan</a>
        <a class="result__snippet">Eau de Parfum 100 ml</a></div>
      <div class="result"><a class="result__a" href="https://www.parfumo.com/Perfumes/Afnan/supremacy-in-heaven">Supremacy in Heaven by Afnan</a></div>`;
    const results = parseDuckDuckGoHtml(html);
    expect(results.map((r) => r.url)).toEqual(['https://www.afnan.com/products/supremacy-in-heaven', 'https://www.parfumo.com/Perfumes/Afnan/supremacy-in-heaven']);
    expect(results[0]).toMatchObject({ title: 'Supremacy In Heaven – Afnan', snippet: 'Eau de Parfum 100 ml' });
  });
});

describe('quadro padrão do frasco', () => {
  it('frasco alto: altura manda, base na linha de 92%', () => {
    const p = placeInCanvas(400, 1000, 2048);
    expect(p.height).toBe(Math.round(2048 * BOTTLE_CANVAS.maxHeight));
    expect(p.top + p.height).toBe(Math.round(2048 * BOTTLE_CANVAS.baseline));
    expect(Math.abs(p.left * 2 + p.width - 2048)).toBeLessThanOrEqual(1);
  });

  it('frasco largo: largura manda, mesma base', () => {
    const p = placeInCanvas(1200, 600, 2048);
    expect(p.width).toBe(Math.round(2048 * BOTTLE_CANVAS.maxWidth));
    expect(p.top + p.height).toBe(Math.round(2048 * BOTTLE_CANVAS.baseline));
  });
});

describe('controle de qualidade do recorte', () => {
  const image = (w: number, h: number, paint: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 120;
        data[i + 3] = paint(x, y);
      }
    return data;
  };

  it('retângulo opaco (fundo que não saiu) é reprovado', () => {
    const r = assessCutout(image(200, 300, () => 255), 200, 300, true, 300);
    expect(r.accepted).toBe(false);
  });

  it('frasco limpo, sem tocar as bordas, passa', () => {
    const r = assessCutout(image(200, 300, (x, y) => (x > 50 && x < 150 && y > 40 && y < 290 ? 255 : 0)), 200, 300, true, 1200);
    expect(r.accepted).toBe(true);
  });
});

describe('modelo', () => {
  it('guarda a origem de cada campo e descarta o que não é da lista', () => {
    const p = sanitizePerfume({
      id: 'x-1',
      name: 'Teste',
      masterUrl: 'media/abc.png',
      fieldSources: {
        price: { kind: 'retailer', label: 'loja.com', url: 'https://loja.com/p' },
        name: { kind: 'hacker', label: 'x', url: null },
        evil: { kind: 'page', label: 'x', url: null },
        image: { kind: 'official', label: '<b>afnan.com</b>', url: 'javascript:alert(1)' },
      },
    })!;
    expect(p.masterUrl).toBe('media/abc.png');
    expect(Object.keys(p.fieldSources).sort()).toEqual(['image', 'price']);
    expect(p.fieldSources.image).toEqual({ kind: 'official', label: 'afnan.com', url: null });
  });
});

describe('identidade pelo catálogo da base de perfumes (sem buscador)', async () => {
  const { __catalogRules: r } = await import('../apps/server/src/research/parfumo');
  const cov = (title: string, slug: string) => {
    const s = r.plainTokens(slug);
    return r.covered(r.plainTokens(title), new Set(s), s.some((w) => ['man', 'woman', 'homme', 'femme'].includes(w)));
  };

  it('todas as palavras do título precisam estar no link', () => {
    expect(cov('asad', 'asad oriental epice ambre vanille')).toBe(true);
    expect(cov('khamrah qahwa', 'khamrah eau de parfum')).toBe(false);
  });

  it('sigla vale pelas iniciais: cdn = club de nuit', () => {
    expect(cov('club de nuit intense man eau de toilette', 'cdn intense man edt')).toBe(true);
    expect(cov('club de nuit intense woman', 'cdn intense man edt')).toBe(false);
  });

  it('gênero só conta quando o link diz algum', () => {
    expect(cov('club de nuit intense man', 'club nuit intense toilette')).toBe(true);
    expect(cov('club de nuit intense woman', 'club nuit intense toilette')).toBe(true);
  });

  it('nome limpo para exibir', () => {
    expect(r.displayName('club de nuit intense man eau de toilette', 'Armaf')).toBe('Club de Nuit Intense Man');
    expect(r.displayName('club de nuit precieux i', 'Armaf')).toBe('Club de Nuit Precieux I');
  });
});
