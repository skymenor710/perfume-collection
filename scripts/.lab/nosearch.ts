// A mesma pergunta, com o buscador DESLIGADO: a identificação precisa sair da página + catálogo da base.
import { duckDuckGo } from '../../server/resolver/search';
(duckDuckGo as { available: () => boolean }).available = () => false;
const { resolveProduct } = await import('../../server/resolver/resolve');
const r = await resolveProduct({ url: 'https://officialmykonos.com/products/mykonos-reflection-extrait-de-parfum-50ml-100ml?nocache=1' });
console.log(r.ok === 'choose' ? `ESCOLHER ${r.identity.brand} · ${r.identity.name}: ${r.variants.map((v) => v.volume).join('/')}` : r.ok ? 'OK sem pergunta' : `FALHOU ${r.message}`);
console.log(r.evidence ?? '');
