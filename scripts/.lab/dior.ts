// Reprocessa o Dior Sauvage do banco do link do claude.ai: resolvedor completo + a foto que a pessoa enviou como concorrente.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { processBottleImage } from '../../server/media/process';
import { resolveProduct } from '../../server/resolver/resolve';
import { accentHexes } from '../../server/import/pipeline';

const OUT = process.argv[3];
const upload = readFileSync(process.argv[2]);
mkdirSync(OUT, { recursive: true });
const resolved = await resolveProduct({
  url: 'https://www.notino.fr/dior/sauvage-eau-de-parfum-pour-homme/p-15676518/',
  identity: { brand: 'Dior', name: 'Sauvage', concentration: 'Eau de Parfum' },
});
const own = await processBottleImage(upload);
console.log('upload:', own.method, own.quality.score, own.quality.reasons);
if (!resolved.ok) console.log('resolver falhou', resolved.evidence);
const found = resolved.ok ? resolved.product : null;
console.log('resolvido:', found?.identity, found?.evidence, found?.image ? [found.image.candidate.label, found.image.candidate.url, found.image.bottle.method, Math.round(found.image.score)] : null);
console.log(JSON.stringify(found?.imageReport?.slice?.(0, 8) ?? found?.imageReport, null, 1));
const useFound = found?.image && found.image.score >= own.quality.score;
const bottle = useFound ? found!.image!.bottle : own;
for (const [name, buf] of [['master.png', bottle.master], ['lg.webp', bottle.large], ['sm.webp', bottle.small]] as const) writeFileSync(path.join(OUT, name), buf);
writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({
  chosen: useFound ? 'resolver' : 'upload',
  dominantColor: bottle.color.hex,
  ...accentHexes(bottle.color.hex),
  imageSource: useFound ? { origin: found!.image!.candidate.origin, url: found!.image!.candidate.url, pageUrl: found!.image!.candidate.pageUrl, label: found!.image!.candidate.label, score: Math.round(found!.image!.score) } : { origin: 'upload', url: null, pageUrl: null, label: 'foto enviada', score: Math.round(own.quality.score) },
  fieldSources: found?.fieldSources ?? {},
  olfactoryProfile: found?.olfactoryProfile ?? null,
  price: found?.price ?? null,
}, null, 2));
console.log('escolhida:', useFound ? 'resolvedor' : 'foto enviada');
