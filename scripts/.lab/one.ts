import { resolveProduct } from '../../server/resolver/resolve';
const t = Date.now();
const r = await resolveProduct({ url: process.argv[2] }, (s) => process.stdout.write(`${s} `));
console.log(`\n${Math.round((Date.now() - t) / 1000)}s`, r.ok === 'choose' ? `ESCOLHER ${r.variants.map((v) => v.volume).join('/')}` : r.ok ? `OK ${r.product.identity.name} ${r.product.identity.volume} variantes=${r.product.variants.length}` : `FALHOU ${r.message}`);
console.log((r as { evidence?: string[]; product?: { evidence: string[] } }).evidence ?? (r as { product: { evidence: string[] } }).product?.evidence);
