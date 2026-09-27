import { describe, expect, it } from 'vitest';
import { meaningfulVariants, parseJsonLdVariants, parseShopifyProductJs, parseWooVariations, preselectedVariant, shopifyHandle, volumeFromText } from '../server/import/variants';

// Como a Royal Oud publica o Mykonos Reflection (ids e preços reais, fotos encurtadas).
const REFLECTION = {
  title: 'Mykonos Reflection EDP',
  variants: [
    { id: 58518844014937, title: '100ml', option1: '100ml', price: 3999, available: false, sku: null, featured_image: { src: '//cdn.shopify.com/files/reflection-7673649.webp' } },
    { id: 58518844047705, title: '50ml', option1: '50ml', price: 2999, available: true, sku: null, featured_image: { src: '//cdn.shopify.com/files/reflection-7128882.webp' } },
  ],
};
const PAGE = 'https://royaloudleicester.com/products/mykonos-reflection-edp-50ml-100ml';

describe('variantes: cada uma é um objeto só (tamanho + preço + foto + link)', () => {
  const vs = parseShopifyProductJs(REFLECTION, PAGE, 'GBP');

  it('lê tamanho, preço em centavos, disponibilidade e a foto DA variante', () => {
    const v50 = vs.find((v) => v.volumeMl === 50)!;
    expect(v50).toMatchObject({ id: '58518844047705', volume: '50 ml', price: 29.99, currency: 'GBP', available: true, image: 'https://cdn.shopify.com/files/reflection-7128882.webp' });
    expect(v50.url).toBe(`${PAGE}?variant=58518844047705`);
    expect(vs.find((v) => v.volumeMl === 100)!.image).toContain('7673649');
  });

  it('o link com ?variant= escolhe a variante; o slug "50ml-100ml" sozinho não escolhe nada', () => {
    expect(preselectedVariant(`${PAGE}?variant=58518844047705`, vs)).toBe('58518844047705');
    expect(preselectedVariant(PAGE, vs)).toBeNull();
    expect(preselectedVariant('https://loja.com/products/khamrah-100ml', [{ ...vs[0], volumeMl: 100 }, { ...vs[1], volumeMl: 50 }])).toBe(vs[0].id);
  });

  it('só pergunta quando há variantes de fato diferentes', () => {
    expect(meaningfulVariants(vs)).toHaveLength(2);
    expect(meaningfulVariants([vs[0], { ...vs[0], id: 'x' }])).toHaveLength(1);
  });

  it('volume em ml ou onças comerciais', () => {
    expect(volumeFromText('Eau de Parfum 3.4 fl oz')).toEqual({ volume: '100 ml', ml: 100 });
    expect(volumeFromText('1.7oz')).toEqual({ volume: '50 ml', ml: 50 });
    expect(volumeFromText('Parfum 7,5 ml')).toEqual({ volume: '7,5 ml', ml: 7.5 });
    expect(volumeFromText('Edição 2024')).toBeNull();
  });

  it('reconhece endereço de produto Shopify (com idioma e coleção)', () => {
    expect(shopifyHandle('https://arabicparfums.com/en/products/club-de-nuit-elite-armaf?x=1')).toEqual({ origin: 'https://arabicparfums.com', prefix: '/en', handle: 'club-de-nuit-elite-armaf' });
    expect(shopifyHandle('https://loja.com/collections/novos/products/asad')).toMatchObject({ handle: 'asad' });
    expect(shopifyHandle('https://www.notino.fr/dior/sauvage/')).toBeNull();
  });
});

describe('WooCommerce e JSON-LD', () => {
  it('formulário de variações do WooCommerce, e a escolha pelos atributos do link', () => {
    const data = JSON.stringify([
      { variation_id: 11, attributes: { attribute_pa_contenance: '50-ml' }, display_price: 35.95, is_in_stock: true, sku: 'R50', image: { full_src: 'https://loja.fr/r50.jpg' } },
      { variation_id: 12, attributes: { attribute_pa_contenance: '100-ml' }, display_price: 47.95, is_in_stock: true, sku: 'R100', image: { full_src: 'https://loja.fr/r100.jpg' } },
    ]).replace(/"/g, '&quot;');
    const html = `<form class="variations_form" data-product_variations="${data}"></form>`;
    const vs = parseWooVariations(html, 'https://loja.fr/produit/reflection/', 'EUR');
    expect(vs.map((v) => [v.volumeMl, v.price, v.image])).toEqual([
      [50, 35.95, 'https://loja.fr/r50.jpg'],
      [100, 47.95, 'https://loja.fr/r100.jpg'],
    ]);
    expect(preselectedVariant('https://loja.fr/produit/reflection/?attribute_pa_contenance=100-ml', vs)).toBe('12');
  });

  it('JSON-LD com ProductGroup.hasVariant', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      hasVariant: [
        { '@type': 'Product', name: 'Reflection 50 ml', sku: 'A50', image: 'https://x.com/a50.png', offers: { price: '35.95', priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url: 'https://x.com/p?s=50' } },
        { '@type': 'Product', name: 'Reflection 100 ml', sku: 'A100', image: 'https://x.com/a100.png', offers: { price: '47.95', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock' } },
      ],
    };
    const vs = parseJsonLdVariants(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, 'https://x.com/p');
    expect(vs).toHaveLength(2);
    expect(vs[0]).toMatchObject({ volumeMl: 50, price: 35.95, currency: 'EUR', available: true, image: 'https://x.com/a50.png', url: 'https://x.com/p?s=50' });
    expect(vs[1]).toMatchObject({ volumeMl: 100, available: false });
  });
});

describe('tamanho no nome do arquivo e nome sem prefixo de marca', async () => {
  const { sizeFromFilename } = await import('../server/research/perfume');
  const { cleanName } = await import('../src/core/normalize');

  it('lê um tamanho do nome do arquivo; dois tamanhos não dizem nada', () => {
    expect(sizeFromFilename('https://cdn.shopify.com/files/empire_100ml_sku_1.jpg?v=1')).toBe(100);
    expect(sizeFromFilename('https://cdn.shopify.com/files/reflection-edp-50ml100ml-mykonos-7673649.webp')).toBeNull();
    expect(sizeFromFilename('https://cdn.shopify.com/files/1_de7eb121.jpg')).toBeNull();
  });

  it('"Marca - Nome" e colaborações perdem o prefixo', () => {
    expect(cleanName('Mykonos - Reflection', 'Mykonos')).toBe('Reflection');
    expect(cleanName('Mykonos x RRQ - Empire', 'Mykonos')).toBe('Empire');
    expect(cleanName('Club de Nuit Intense Man', 'Armaf')).toBe('Club de Nuit Intense Man');
  });
});
