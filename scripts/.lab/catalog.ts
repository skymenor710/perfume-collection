import { guessFromUrl } from '../../src/core/normalize';
import { identifyFromCatalog } from '../../server/research/parfumo';
for (const u of [
  'https://www.notino.fr/armaf/cdn-intense-man-edt/',
  'https://www.arabicparfums.com/products/lattafa-khamrah-eau-de-parfum-100ml',
  'https://www.parfumdreams.fr/Lattafa/Asad-Eau-de-Parfum-Spray-100-ml-pour-homme-oriental-epice-ambre-vanille/index_97112.aspx',
  'https://www.amazon.fr/Armaf-Club-Nuit-Intense-Toilette/dp/B01M0BV1ZV/ref=sr_1_3',
  'https://www.sephora.fr/p/good-girl---eau-de-parfum-P3372018.html',
  'https://www.notino.fr/afnan/supremacy-in-heaven-eau-de-parfum-mixte/',
]) {
  const g = guessFromUrl(u);
  const t = Date.now();
  const r = await identifyFromCatalog(g.brand, g.name ?? '');
  console.log(`${(g.brand ?? '—').padEnd(8)} ${String(g.name).padEnd(40)} → ${r ? `${r.brand} · ${r.name}${r.ambiguous ? ' (ambíguo)' : ''}` : 'nada'}  ${Math.round((Date.now() - t) / 1000)}s`);
}
