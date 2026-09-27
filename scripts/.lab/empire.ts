import { writeFileSync } from 'node:fs';
import { resolveProduct } from '../../server/resolver/resolve';
const r = await resolveProduct({ url: 'https://officialmykonos.com/products/mykonos-x-rrq-empire-extrait-de-parfum-50ml-100ml', variantId: '42310340411467' });
if (r.ok === true) {
  const p = r.product;
  console.log(p.identity, p.price, p.image?.candidate.url, p.image?.bottle.method, Math.round(p.image?.score ?? 0));
  for (const c of p.imageReport.slice(0, 8)) console.log(' ·', c.score, c.url.split('/').pop()?.split('?')[0], c.reasons.join('; '));
  if (p.image) writeFileSync('scripts/.lab/empire-50.webp', p.image.bottle.large);
} else console.log(r);
