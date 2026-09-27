import { researchPerfume } from '../../server/research/perfume';
const r = await researchPerfume({ brand: 'Lattafa', name: 'Asad', concentration: 'Eau de Parfum', pageImages: [], pageUrl: null });
console.log('db', r.fragrantica?.url, r.fragrantica?.image);
console.log('stores', r.stores.map((s) => `${s.official ? 'OF' : 're'} ${s.product.store} ${s.product.title} imgs=${s.product.images?.length}`));
console.log(JSON.stringify(r.imageReport, null, 1).slice(0, 2500));
