import { writeFileSync } from 'node:fs';
import { resolveProduct } from '../../server/resolver/resolve';
const base = 'https://royaloudleicester.com/products/mykonos-reflection-edp-50ml-100ml';
for (const [label, url, variantId] of [
  ['sem variante no link', base, null],
  ['link com ?variant= (50 ml)', `${base}?variant=58518844047705`, null],
  ['50 ml escolhido', `${base}?variant=58518844047705`, '58518844047705'],
] as const) {
  const t = Date.now();
  const r = await resolveProduct({ url, variantId });
  const secs = Math.round((Date.now() - t) / 1000);
  if (r.ok === 'choose') {
    console.log(`\n${label} (${secs}s) → PERGUNTA: ${r.identity.brand} · ${r.identity.name}`);
    for (const v of r.variants) console.log(`   ${v.volume} ${v.price} ${v.currency} disp=${v.available} foto=${v.image?.split('/').pop()?.split('?')[0]} miniatura=${v.thumb ? 'sim' : 'não'}${v.id === r.preselectedId ? '  ← pré-selecionada' : ''}`);
  } else if (r.ok) {
    const p = r.product;
    console.log(`\n${label} (${secs}s) → ${p.identity.brand} · ${p.identity.name} · ${p.identity.volume} · ${p.price?.value} ${p.price?.currency} · variante ${p.variant?.id} · link ${p.variant?.url}`);
    console.log(`   foto: ${p.image?.candidate.label} (${p.image?.candidate.url.split('/').pop()?.split('?')[0]}) ${p.image?.bottle.method} ${Math.round(p.image?.score ?? 0)}`);
    for (const c of p.imageReport) console.log(`   · ${c.score} ${c.url.split('/').pop()?.split('?')[0].slice(0, 50)} ${c.reasons.join('; ')}`);
    if (p.image) writeFileSync('scripts/.lab/reflection-50.webp', p.image.bottle.large);
  } else console.log(`\n${label} → falhou: ${r.message}`);
}
