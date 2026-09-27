import { guessFromUrl } from '../../src/core/normalize';
for (const u of [
  'https://www.sephora.fr/p/good-girl---eau-de-parfum-P3372018.html',
  'https://www.arabicparfums.com/products/lattafa-khamrah-eau-de-parfum-100ml?utm_source=facebook',
  'https://www.parfumdreams.fr/Lattafa/Asad-Eau-de-Parfum-Spray-100-ml-pour-homme-oriental-epice-ambre-vanille/index_97112.aspx',
  'https://www.amazon.fr/Armaf-Club-Nuit-Intense-Toilette/dp/B01M0BV1ZV/ref=sr_1_3?keywords=club+de+nuit',
  'https://www.notino.fr/armaf/cdn-intense-man-edt/',
  'https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/',
  'https://www.nocibe.fr/lattafa-khamrah-eau-de-parfum-100-ml-s274180',
  'https://royaloudleicester.com/products/rasasi-hawas-fire-eau-de-parfum-100ml',
]) console.log(JSON.stringify(guessFromUrl(u)));
