import { ImportCancelledError, type ImportOutcome } from '../../apps/server/src/import/pipeline';
import type { ImportExecutor } from '../../apps/server/src/jobs/runner';

/** Resultado de importação bem-sucedida, mínimo (o motor real é testado em resolver/research). */
export function okOutcome(name = 'Reflection'): ImportOutcome {
  return {
    ok: true,
    notes: [],
    perfume: {
      name,
      brand: 'Mykonos',
      description: null,
      concentration: null,
      volume: '50 ml',
      gender: null,
      price: 35.95,
      currency: 'EUR',
      sourceUrl: 'https://ok.test/p',
      media: null,
      imageCredit: null,
      imageSource: null,
      accentColor: null,
      accentGlow: null,
      olfactoryProfile: null,
      fieldSources: {},
      variant: null,
      variants: [],
      variantUrl: null,
      confidence: 'high',
    },
  };
}

/**
 * Executor de teste (substitui só o motor de pesquisa, nunca a biblioteca): comportamento pelo domínio do link.
 * slow.test espera o cancelamento; gate.test espera ser liberado (gates, pelo id do job).
 */
export function fakeExecutor(gates: Map<string, () => void> = new Map()): ImportExecutor {
  return async (input, onStage, { signal, jobId }) => {
    const host = new URL(input.url).host;
    onStage('link');
    onStage('identity');
    if (host === 'fail.test') return { ok: false, code: 'unidentified', message: 'Não consegui identificar esse perfume.', guess: null };
    if (host === 'boom.test') throw new Error('detalhe técnico interno: ECONNRESET 10.0.0.3');
    if (host === 'choose.test' && !input.variantId)
      return { ok: 'choose', brand: 'Mykonos', name: 'Reflection', concentration: null, variants: [{ id: '50', label: '50 ml', volume: '50 ml', price: 35.95, currency: 'EUR', url: null, image: null, available: true, thumb: null } as never], preselectedId: null, sourceLabel: 'officialmykonos.com' };
    if (host === 'slow.test')
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    if (host === 'gate.test') await new Promise<void>((resolve) => gates.set(jobId, resolve));
    if (signal.aborted) throw new ImportCancelledError();
    onStage('images');
    onStage('done');
    return okOutcome(input.variantId ? `Reflection ${input.variantId}` : 'Reflection');
  };
}

