/**
 * A planilha "Lista de Perfumes" (Google Sheets do usuário, aba única, A1:C15), normalizada.
 * Lida em 2026-09-26 pelo conector do Google Drive; os links da coluna C eram hiperlinks e as URLs abaixo
 * são as de verdade (xl/worksheets/_rels/sheet1.xml.rels do XLSX exportado). Nenhum perfume inventado.
 *
 * `image` é a foto de produto usada no palco: a primeira foto da própria página do link, exceto quando a loja
 * bloqueia robôs (Cdiscount) — aí vem do site oficial da marca, anotado em `imageSource`.
 */

export interface SeedSource {
  /** Texto da coluna A, sem mexer. */
  sheetName: string;
  /** Texto da coluna B, sem mexer. */
  sheetPrice: string;
  brand: string;
  name: string;
  concentration: string;
  gender: 'masculine' | 'unisex' | null;
  volume: string;
  price: number;
  currency: 'EUR';
  priceNote: string | null;
  sourceUrl: string;
  image: string;
  imageSource: string;
  /** Ajuste fino do recorte para fotos com sombra ou fundo levemente texturizado. */
  cutout?: { tolerance?: number; feather?: number; pockets?: boolean; region?: [number, number, number, number]; trimBottom?: number };
}

export const SHEET = {
  title: 'Lista de Perfumes',
  url: 'https://docs.google.com/spreadsheets/d/1_fSpeSpVTbuJmg89Jw7gPaTrddiA9elMnf4vtcjjHvI/edit?gid=638163495#gid=638163495',
  readAt: '2026-09-26',
};

export const SEED: SeedSource[] = [
  {
    sheetName: 'Khadlaj Shiyaaka Snow – Eau de Parfum pour homme 100 ml',
    sheetPrice: '35,10 €',
    brand: 'Khadlaj',
    name: 'Shiyaaka Snow',
    concentration: 'Eau de Parfum',
    gender: 'masculine',
    volume: '100 ml',
    price: 35.1,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/khadlaj/shiyaaka-snow-eau-de-parfum-pour-homme/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/khadlaj/6291107979335_01-o/shiyaaka-snow___260209.jpg',
    imageSource: 'notino.fr (página do link)',
    cutout: { pockets: false },
  },
  {
    sheetName: "Afnan Supremacy Collector's Edition – Eau de Parfum pour homme 100 ml",
    sheetPrice: '60,00 €',
    brand: 'Afnan',
    name: "Supremacy Collector's Edition",
    concentration: 'Eau de Parfum',
    gender: 'masculine',
    volume: '100 ml',
    price: 60,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/afnan/supremacy-collectors-edition-eau-de-parfum-pour-homme/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/afnan/6290171075073_01-o/supremacy-collectors-edition___241108.jpg',
    imageSource: 'notino.fr (página do link)',
    cutout: { trimBottom: 0.04 },
  },
  {
    sheetName: 'Afnan Supremacy Not Only Intense – Extrait de Parfum pour homme 100 ml',
    sheetPrice: '48,00 €',
    brand: 'Afnan',
    name: 'Supremacy Not Only Intense',
    concentration: 'Extrait de Parfum',
    gender: 'masculine',
    volume: '100 ml',
    price: 48,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/afnan/supremacy-not-only-intense-eau-de-parfum-pour-homme/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/afnan/6290171070214_01-o/supremacy-not-only-intense___211004.jpg',
    imageSource: 'notino.fr (página do link)',
    cutout: { trimBottom: 0.04 },
  },
  {
    sheetName: 'Afnan Supremacy In Heaven – Eau de Parfum 100 ml',
    sheetPrice: '37,50 €',
    brand: 'Afnan',
    name: 'Supremacy In Heaven',
    concentration: 'Eau de Parfum',
    gender: null,
    volume: '100 ml',
    price: 37.5,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/afnan/6290171002253_01-o/supremacy-in-heaven___210927.jpg',
    imageSource: 'notino.fr (página do link)',
    cutout: { trimBottom: 0.04 },
  },
  {
    sheetName: 'Nusuk Ateeq – Parfum pour homme 100 ml',
    sheetPrice: '29,99 € (aprox.)',
    brand: 'Nusuk',
    name: 'Ateeq',
    concentration: 'Parfum',
    gender: 'masculine',
    volume: '100 ml',
    price: 29.99,
    currency: 'EUR',
    priceNote: 'aprox.',
    sourceUrl: 'https://www.amazon.fr/dp/B0FN4NVWGJ',
    image: 'https://m.media-amazon.com/images/I/61H0N+-OmPL._AC_SL1080_.jpg',
    imageSource: 'amazon.fr (página do link)',
  },
  {
    sheetName: 'French Avenue Spectre Ghost – Eau de Parfum pour homme 80 ml',
    sheetPrice: '34,90 €',
    brand: 'French Avenue',
    name: 'Spectre Ghost',
    concentration: 'Eau de Parfum',
    gender: 'masculine',
    volume: '80 ml',
    price: 34.9,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.ferwer.fr/french-avenue_spectre-ghost-eau-de-parfum-pour-homme',
    image: 'https://www.ferwer.fr/images/french-avenue-13311-1-l.webp',
    imageSource: 'ferwer.fr (página do link)',
    cutout: { trimBottom: 0.075 },
  },
  {
    sheetName: 'Armaf Club de Nuit Precieux – Extrait de Parfum mixte 55 ml',
    sheetPrice: '43,50 €',
    brand: 'Armaf',
    name: 'Club de Nuit Precieux',
    concentration: 'Extrait de Parfum',
    gender: 'unisex',
    volume: '55 ml',
    price: 43.5,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/armaf/club-de-nuit-precieux-extrait-de-parfum-mixte/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/armaf/6294015181913_01-o/club-de-nuit-precieux___250113.jpg',
    imageSource: 'notino.fr (página do link)',
    cutout: { trimBottom: 0.04 },
  },
  {
    sheetName: 'Armaf Club de Nuit Elite – Eau de Parfum 105 ml',
    sheetPrice: '50,00 € (aprox.)',
    brand: 'Armaf',
    name: 'Club de Nuit Elite',
    concentration: 'Eau de Parfum',
    gender: null,
    volume: '105 ml',
    price: 50,
    currency: 'EUR',
    priceNote: 'aprox.',
    sourceUrl: 'https://arabicparfums.com/en/products/club-de-nuit-elite-armaf',
    // A foto principal da loja tem frutas e flores em volta; esta é a foto "frasco + caixa" da mesma página, só o frasco.
    image: 'https://cdn.shopify.com/s/files/1/0815/8848/6483/files/CDN-Elite-105-ml-edp-group.webp?v=1789566527',
    imageSource: 'arabicparfums.com (página do link, 2ª foto)',
    cutout: { region: [0.56, 0.1, 0.44, 0.8], tolerance: 4 },
  },
  {
    sheetName: 'Rayhaan Cedrus Blanc – Eau de Parfum mixte 100 ml',
    sheetPrice: '40,00 € (aprox.)',
    brand: 'Rayhaan',
    name: 'Cedrus Blanc',
    concentration: 'Eau de Parfum',
    gender: 'unisex',
    volume: '100 ml',
    price: 40,
    currency: 'EUR',
    priceNote: 'aprox.',
    sourceUrl: 'https://www.parfumcity.nl/fr/products/rayhaan-cedrus-blanc-100ml',
    image: 'https://www.parfumcity.nl/cdn/shop/files/rayhaan-cedrus-blanc-100ml-6523556.webp?v=1787152265&width=1920',
    imageSource: 'parfumcity.nl (página do link)',
  },
  {
    sheetName: 'Mykonos Reflection – Eau de Parfum 50/100 ml',
    sheetPrice: '34,50 € (aprox., £29,99)',
    brand: 'Mykonos',
    name: 'Reflection',
    concentration: 'Eau de Parfum',
    gender: null,
    volume: '50/100 ml',
    price: 34.5,
    currency: 'EUR',
    priceNote: 'aprox. · £29,99 na loja',
    sourceUrl: 'https://royaloudleicester.com/products/mykonos-reflection-edp-50ml-100ml',
    image: 'https://royaloudleicester.com/cdn/shop/files/reflection-edp-50ml100ml-mykonos-7673649.webp?v=1783431684',
    imageSource: 'royaloudleicester.com (página do link)',
    // Corpo prateado quase branco: tolerância menor para o recorte não morder o metal.
    cutout: { tolerance: 2.5, feather: 5 },
  },
  {
    sheetName: 'Maison Asrar Vanguard – Eau de Parfum mixte 100 ml',
    sheetPrice: '53,90 €',
    brand: 'Maison Asrar',
    name: 'Vanguard',
    concentration: 'Eau de Parfum',
    gender: 'unisex',
    volume: '100 ml',
    price: 53.9,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/maison-asrar/vanguard-eau-de-parfum-mixte/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/maison_asrar/6290362164906_01-o/vanguard___260209.jpg',
    imageSource: 'notino.fr (página do link)',
    // A foto da loja espelha o frasco num piso branco; o reflexo sai (o app desenha o seu).
    cutout: { trimBottom: 0.035 },
  },
  {
    sheetName: 'Khadlaj Island Dreams – Extrait de Parfum mixte 100 ml',
    sheetPrice: '37,00 €',
    brand: 'Khadlaj',
    name: 'Island Dreams',
    concentration: 'Extrait de Parfum',
    gender: 'unisex',
    volume: '100 ml',
    price: 37,
    currency: 'EUR',
    priceNote: null,
    sourceUrl: 'https://www.notino.fr/khadlaj/island-dreams-extrait-de-parfum-mixte/',
    image: 'https://cdn.notinoimg.com/detail_main_hq/khadlaj/6291107979991_01-o/island-dreams___251120.jpg',
    imageSource: 'notino.fr (página do link)',
  },
  {
    sheetName: 'Mykonos x RRQ Empire – Extrait de Parfum 50/100 ml',
    sheetPrice: '26,00 € (aprox., ESGOTADO no site oficial)',
    brand: 'Mykonos × RRQ',
    name: 'Empire',
    concentration: 'Extrait de Parfum',
    gender: null,
    volume: '50/100 ml',
    price: 26,
    currency: 'EUR',
    priceNote: 'aprox. · esgotado no site oficial',
    sourceUrl: 'https://officialmykonos.com/products/mykonos-x-rrq-empire-extrait-de-parfum-50ml-100ml',
    image: 'https://cdn.shopify.com/s/files/1/0637/6325/1275/files/empire_100ml_sku_1.jpg?v=1778043194',
    imageSource: 'officialmykonos.com (página do link)',
  },
  {
    sheetName: 'Afnan 9 PM Night Out – Extrait de Parfum mixte 100 ml',
    sheetPrice: '48,63 € (aprox.)',
    brand: 'Afnan',
    name: '9 PM Night Out',
    concentration: 'Extrait de Parfum',
    gender: 'unisex',
    volume: '100 ml',
    price: 48.63,
    currency: 'EUR',
    priceNote: 'aprox.',
    sourceUrl: 'https://www.cdiscount.com/au-quotidien/hygiene-soin-beaute/afnan-9-pm-night-out-extrait/f-127021804-aadji53933.html',
    image: 'https://cdn.shopify.com/s/files/1/0655/0473/9421/files/72.png?v=1768480402',
    imageSource: 'afnan.com (site oficial — a Cdiscount bloqueia leitura automática)',
  },
];
