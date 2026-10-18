import { expect, test, type Page } from '@playwright/test';
import { BASE, prepare, start, stop } from './server';
import { axeViolations, revealAll, slowestInteraction, startInteractionTiming, watch } from './helpers';

// Projet « mobile » (playwright.config.ts) : émulation d'un téléphone tactile (Pixel 7, Chromium).
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await prepare();
  await start();
});
test.afterAll(async () => stop());

const workAt = (page: Page, n: number) => page.locator('#realisations [data-work]').nth(n);

/** Glissement horizontal au doigt (événements tactiles réels du navigateur). */
async function swipe(page: Page, selector: string, dx: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = Math.round(box.y + box.height / 2);
  const x0 = Math.round(box.x + box.width * (dx < 0 ? 0.85 : 0.15));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 10, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('mobile : page entière sans débordement ni erreur, hero puis réalisations, menu', async ({ page }) => {
  const problems = watch(page);
  await page.goto(BASE);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  // Boutons du hero : pleine largeur, cibles confortables.
  const cta = (await page.locator('.hero__cta-primary').boundingBox())!;
  expect(cta.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.hero__cta-primary')).toHaveText('Demander un devis');
  await page.locator('[data-menu-toggle]').tap();
  await expect(page.locator('.mobile-menu__link')).toHaveText(['Réalisations', 'Services', 'Processus', 'FAQ', 'Contact']);
  await page.locator('.mobile-menu__link', { hasText: 'Réalisations' }).tap();
  await expect(page.locator('[data-mobile-menu]')).toBeHidden();
  await page.waitForFunction(() => Math.abs(document.getElementById('realisations')!.getBoundingClientRect().top - 68) < 4);
  expect(problems).toEqual([]);
});

test('mobile : galerie au doigt, points et flèches, visionneuse', async ({ page }) => {
  const problems = watch(page);
  await page.goto(BASE);
  await workAt(page, 0).scrollIntoViewIfNeeded();
  await startInteractionTiming(page);
  const g = workAt(page, 0).locator('[data-carousel]');
  await swipe(page, '#realisations [data-work] [data-carousel-viewport]', -220);
  await expect(g).toHaveAttribute('data-index', '1');
  await expect(g.locator('[data-carousel-dot]').nth(1)).toHaveAttribute('aria-current', 'true');
  await swipe(page, '#realisations [data-work] [data-carousel-viewport]', 220);
  await expect(g).toHaveAttribute('data-index', '0');
  await g.locator('[data-carousel-next]').tap();
  await expect(g).toHaveAttribute('data-index', '1');
  await g.locator('[data-carousel-dot]').nth(3).tap();
  await expect(g).toHaveAttribute('data-index', '3');
  // Toucher la capture affichée : visionneuse sur cette capture.
  await expect.poll(() => g.locator('[data-carousel-viewport]').evaluate((v) => Math.round(v.scrollLeft / v.clientWidth))).toBe(3);
  await g.locator('[data-slide]').nth(3).locator('[data-shot-open]').tap();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('4 / 4');
  await page.locator('[data-lightbox-close]').tap();
  await workAt(page, 0).locator('.work__details summary').tap();
  await expect(workAt(page, 0).locator('.work__facts')).toBeVisible();
  const slowest = await slowestInteraction(page);
  expect(slowest.duration, JSON.stringify(slowest)).toBeLessThan(200);
  expect(problems).toEqual([]);
});

test('mobile : service → formulaire présélectionné, envoi enregistré et confirmé', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#services .service__link').nth(1).tap();
  await expect(page.locator('#cf-type')).toHaveValue('Refonte de site existant');
  await expect(page.locator('#cf-type')).toBeInViewport();
  await page.locator('#cf-name').fill('Paul Martin');
  await page.locator('#cf-email').fill('paul@exemple.fr');
  await page.locator('#cf-message').fill('Refonte du site de notre atelier, plus lisible sur téléphone.');
  await page.waitForTimeout(2600); // délai anti-robot
  const resp = page.waitForResponse((r) => r.url().endsWith('/contact') && r.request().method() === 'POST');
  await page.locator('[data-submit]').tap();
  expect((await resp).status()).toBe(201);
  await expect(page.locator('[data-form-status]')).toContainText('bien été enregistrée');
});

test('mobile : accessibilité (axe, WCAG 2.2 AA), page et menu ouvert', async ({ page }) => {
  await page.goto(BASE);
  await revealAll(page);
  expect(await axeViolations(page)).toEqual([]);
  await page.locator('[data-menu-toggle]').tap();
  await expect(page.locator('[data-mobile-menu]')).toBeVisible();
  // Fin de l'apparition échelonnée des liens (l'analyse porte sur l'état stable).
  await page.waitForFunction(() => [...document.querySelectorAll('.mobile-menu__link, .mobile-menu__cta')].every((e) => getComputedStyle(e).opacity === '1'));
  expect(await axeViolations(page)).toEqual([]);
});
