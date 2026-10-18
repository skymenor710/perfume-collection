import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Échoue si la page produit une erreur console ou une requête en échec inattendue. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requête: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
  return problems;
}

/**
 * Parcourt la page pour déclencher les apparitions au défilement, puis attend la fin des fondus : l'analyse porte sur
 * ce que le visiteur voit (un texte en cours de fondu a, par définition, un contraste transitoire plus faible).
 */
export async function revealAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForFunction(() => !document.querySelector('.reveal-pending'));
  await page.waitForTimeout(1300);
}

/** Violations axe-core (WCAG 2.0, 2.1 et 2.2 niveaux A et AA, plus bonnes pratiques) : « règle × nombre d'éléments ». */
export async function axeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length} : ${v.nodes[0]?.target.join(' ')}`);
}

/**
 * Latence des interactions (indicateur de laboratoire de l'INP) : durée des événements d'entrée mesurée par le
 * navigateur (Event Timing API), de l'action jusqu'à l'image suivante affichée. Seules les durées ≥ 16 ms sont
 * enregistrées par le navigateur ; 0 = toutes les interactions sous 16 ms.
 */
export async function startInteractionTiming(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __events: { name: string; duration: number }[] };
    w.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { interactionId?: number })[]) {
        if (e.interactionId) w.__events.push({ name: e.name, duration: e.duration });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}

export async function slowestInteraction(page: Page) {
  await page.waitForTimeout(300); // les entrées sont livrées après l'image suivante
  return page.evaluate(() => {
    const events = (window as unknown as { __events: { name: string; duration: number }[] }).__events;
    return events.reduce((max, e) => (e.duration > max.duration ? e : max), { name: 'aucune ≥ 16 ms', duration: 0 });
  });
}
