import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN, BASE, prepare, start, stop } from './server';
import { axeViolations, revealAll, slowestInteraction, startInteractionTiming, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await prepare();
  await start();
});
test.afterAll(async () => stop());

const workAt = (page: Page, n: number) => page.locator('#realisations [data-work]').nth(n);

test('largeurs 375 → 1920 : aucun débordement horizontal ni erreur console', async ({ browser }) => {
  for (const [width, height] of [
    [375, 812],
    [390, 844],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const problems = watch(page);
    await page.goto(BASE);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `largeur ${width}`).toBe(0);
    // Galeries des réalisations au format 16:10 (hauteur fixe : aucun décalage de mise en page).
    const ratios = await page.locator('.gallery__viewport').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height));
    expect(ratios).toHaveLength(3);
    for (const r of ratios) expect(Math.abs(r - 1.6)).toBeLessThan(0.01);
    // Le hero ne se chevauche pas : titre au-dessus des boutons, boutons au-dessus du symbole sur mobile.
    if (width < 800) {
      const title = await page.locator('.hero__title').boundingBox();
      const cta = await page.locator('.hero__actions').boundingBox();
      const symbol = await page.locator('.symbol__stage').boundingBox();
      expect(title!.y + title!.height).toBeLessThanOrEqual(cta!.y);
      expect(cta!.y + cta!.height).toBeLessThanOrEqual(symbol!.y + 1);
    }
    expect(problems, `largeur ${width}`).toEqual([]);
    await page.close();
  }
});

test('navigation : liens internes sous l’en-tête fixe, en-tête flouté au défilement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watch(page);
  await page.goto(BASE);
  await expect(page.locator('.site-nav__link')).toHaveText(['Réalisations', 'Services', 'Processus', 'FAQ', 'Contact']);
  await expect(page.locator('[data-header]')).not.toHaveClass(/is-scrolled/);
  await page.locator('.site-nav__link', { hasText: 'Réalisations' }).click();
  await page.waitForFunction(() => Math.abs(document.getElementById('realisations')!.getBoundingClientRect().top - 84) < 4);
  await expect(page.locator('[data-header]')).toHaveClass(/is-scrolled/);
  const backdrop = await page.locator('[data-header]').evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(backdrop).toContain('blur');
  await page.locator('.site-nav__link', { hasText: 'Contact' }).click();
  // Contact : le haut de la section s'arrête juste sous l'en-tête (jamais dessous), formulaire visible.
  await page.waitForFunction(() => Math.abs(document.getElementById('contact')!.getBoundingClientRect().top - 84) < 4);
  await expect(page.locator('#cf-name')).toBeInViewport();
  for (const [label, id] of [
    ['Services', 'services'],
    ['Processus', 'processus'],
    ['FAQ', 'faq'],
  ]) {
    await page.locator('.site-nav__link', { hasText: label }).click();
    await page.waitForFunction((sid) => Math.abs(document.getElementById(sid)!.getBoundingClientRect().top - 84) < 4, id);
  }
  // Le logo ramène en haut de page.
  await page.locator('.site-header__brand').click();
  await page.waitForFunction(() => window.scrollY < 4);
  expect(problems).toEqual([]);
});

test('menu mobile : ouverture, piège du focus, Échap, fermeture au clic', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  const toggle = page.locator('[data-menu-toggle]');
  await expect(page.locator('.site-nav')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-mobile-menu]')).toBeVisible();
  await expect(page.locator('.mobile-menu__link').first()).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-mobile-menu], [data-menu-toggle]'));
  expect(inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-mobile-menu]')).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('.mobile-menu__link', { hasText: 'Réalisations' }).click();
  await expect(page.locator('[data-mobile-menu]')).toBeHidden();
  await page.waitForFunction(() => Math.abs(document.getElementById('realisations')!.getBoundingClientRect().top - 68) < 4);
});

test('réalisations : trois cartes juste après le hero, statut affiché, détail repliable, images différées', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const media: string[] = [];
  page.on('request', (r) => r.url().includes('/media/') && media.push(r.url()));
  await page.goto(BASE);
  // Ordre de la page : le travail est montré juste après la promesse.
  const order = await page.locator('main > section').evaluateAll((els) => els.map((e) => e.id));
  expect(order.slice(0, 4)).toEqual(['accueil', 'realisations', 'services', 'processus']);
  await expect(page.locator('#works-title')).toHaveText('Nos réalisations.');
  // Chargement différé : la troisième carte, loin de l'écran, n'a encore rien chargé.
  const third = await workAt(page, 2).locator('[data-shot]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.src!.split('/')[2]));
  expect(media.filter((u) => third.some((id) => u.includes(id)))).toEqual([]);
  await page.locator('#realisations').scrollIntoViewIfNeeded();
  for (let n = 0; n < 3; n++) {
    const c = workAt(page, n);
    await expect(c.locator('.badge-demo')).toHaveText('Concept / Démonstration');
    await expect(c.locator('.work__summary')).not.toBeEmpty();
    // Détail replié par défaut, complet une fois ouvert ; un concept n'affiche jamais de résultats.
    await expect(c.locator('.work__facts')).toBeHidden();
    await c.locator('.work__details summary').click();
    await expect(c.locator('.work__facts dt')).toHaveText(['Contexte / défi', 'Solution apportée', 'Objectif de conversion']);
    await expect(c).not.toContainText(/résultat/i);
    await expect(c.locator('[data-slide]')).toHaveCount(4);
    await expect(c.locator('[data-carousel-dot]')).toHaveCount(4);
  }
  await workAt(page, 2).scrollIntoViewIfNeeded();
  await expect.poll(() => workAt(page, 2).locator('[data-slide] img').first().evaluate((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)).toBe(true);
  // Variante adaptée à l'écran (jamais la 2400 px dans la page).
  expect(media.some((u) => u.includes('/2400.'))).toBe(false);
});

test('galeries : indépendantes, flèches, points, clavier, annonce, sans décalage de mise en page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watch(page);
  await page.goto(BASE);
  await workAt(page, 0).scrollIntoViewIfNeeded();
  await startInteractionTiming(page);
  const g0 = workAt(page, 0).locator('[data-carousel]');
  const g1 = workAt(page, 1).locator('[data-carousel]');
  const dots = g0.locator('[data-carousel-dot]');
  const height = (await g0.boundingBox())!.height;
  const shown = (g: typeof g0) =>
    g.locator('[data-carousel-viewport]').evaluate((v) => Math.round(v.scrollLeft / v.clientWidth));

  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
  // Seule la capture affichée est exposée (les autres sont inertes).
  expect(await g0.locator('[data-slide]').evaluateAll((els) => els.map((e) => (e as HTMLElement).inert))).toEqual([false, true, true, true]);

  await g0.locator('[data-carousel-next]').click();
  await expect(g0).toHaveAttribute('data-index', '1');
  await expect.poll(() => shown(g0)).toBe(1);
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(dots.nth(0)).not.toHaveAttribute('aria-current', /.*/);
  await expect(g0.locator('[data-carousel-status]')).toContainText('Capture 2 sur 4');
  await expect(g0.locator('[data-carousel-index]')).toHaveText('02');
  // L'autre galerie n'a pas bougé.
  await expect(g1).toHaveAttribute('data-index', '0');
  expect(await shown(g1)).toBe(0);

  // Précédent en boucle : de la 1re à la dernière.
  await g0.locator('[data-carousel-prev]').click();
  await g0.locator('[data-carousel-prev]').click();
  await expect(g0).toHaveAttribute('data-index', '3');
  await expect.poll(() => shown(g0)).toBe(3);
  // Point indicateur.
  await dots.nth(2).click();
  await expect(g0).toHaveAttribute('data-index', '2');
  await expect.poll(() => shown(g0)).toBe(2);
  // Clavier : ← → Début Fin ; le focus suit la capture affichée.
  await g0.locator('[data-slide]').nth(2).locator('[data-shot-open]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(g0).toHaveAttribute('data-index', '3');
  await expect(g0.locator('[data-slide]').nth(3).locator('[data-shot-open]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(g0).toHaveAttribute('data-index', '0');
  await expect(g0.locator('[data-slide]').nth(0).locator('[data-shot-open]')).toBeFocused();
  await dots.nth(0).focus();
  await page.keyboard.press('End');
  await expect(dots.nth(3)).toBeFocused();
  await expect(dots.nth(3)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => shown(g0)).toBe(3);
  // Hauteur constante pendant toute la navigation.
  expect((await g0.boundingBox())!.height).toBe(height);
  // « Plein écran » ouvre la visionneuse sur la capture affichée.
  await workAt(page, 0).locator('[data-lightbox-open]').click();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('4 / 4');
  await page.keyboard.press('Escape');
  // Latence des interactions (indicateur de laboratoire de l'INP) : bien sous 200 ms.
  const slowest = await slowestInteraction(page);
  expect(slowest.duration, JSON.stringify(slowest)).toBeLessThan(200);
  expect(problems).toEqual([]);
});

test('visionneuse : capture entière (jamais recadrée), navigation, zoom, Échap, focus rendu', async ({ page }) => {
  // Fenêtre basse et large (cas signalé) : l'image doit tenir entière entre la barre et la légende.
  await page.setViewportSize({ width: 1920, height: 871 });
  const problems = watch(page);
  await page.goto(BASE);
  await workAt(page, 1).scrollIntoViewIfNeeded();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).not.toBeVisible();

  const cover = workAt(page, 1).locator('[data-slide]').first().locator('[data-shot-open]');
  await cover.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('Laboratoire in vitro');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('1 / 4');
  await expect(page.locator('[data-lightbox-caption]')).toContainText('in vitro');
  const fit = await page.evaluate(() => {
    const img = [...document.querySelectorAll<HTMLImageElement>('.lightbox__img')].pop()!.getBoundingClientRect();
    const bar = document.querySelector('.lightbox__bar')!.getBoundingClientRect();
    const cap = document.querySelector('.lightbox__caption')!.getBoundingClientRect();
    return { top: img.top, bottom: img.bottom, left: img.left, right: img.right, ratio: img.width / img.height, barBottom: bar.bottom, capTop: cap.top, w: innerWidth };
  });
  expect(fit.top).toBeGreaterThanOrEqual(fit.barBottom);
  expect(fit.bottom).toBeLessThanOrEqual(fit.capTop);
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.w);
  expect(Math.abs(fit.ratio - 1.6)).toBeLessThan(0.01);
  // Grande image : au moins 1100 px de large sur cet écran, variante haute définition.
  expect(fit.right - fit.left).toBeGreaterThan(1100);
  await expect.poll(() => page.locator('.lightbox__img').last().evaluate((e) => Number(/\/(\d+)\.(?:avif|webp)$/.exec((e as HTMLImageElement).currentSrc)?.[1] ?? 0))).toBeGreaterThanOrEqual(1600);
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);

  // Navigation clavier et boutons, en boucle.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('2 / 4');
  await page.locator('[data-lightbox-prev]').click();
  await page.locator('[data-lightbox-prev]').click();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('4 / 4');
  await page.locator('[data-lightbox-next]').click();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('1 / 4');

  // Zoom au clic (les captures 2880 px apportent du détail), puis dézoom.
  const img = page.locator('.lightbox__img').last();
  await expect(page.locator('[data-lightbox-zoom]')).toBeVisible();
  await img.click();
  await expect(page.locator('[data-lightbox-zoom]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => img.evaluate((e) => getComputedStyle(e).transform)).toContain('matrix(2');
  await page.locator('[data-lightbox-zoom]').click();
  await expect(page.locator('[data-lightbox-zoom]')).toHaveAttribute('aria-pressed', 'false');

  // Échap : fermeture, focus rendu au visuel qui l'a ouverte.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(cover).toBeFocused();

  // Capture 3 d'un autre projet, choisie au clavier dans sa galerie : ouvre directement la bonne image.
  await workAt(page, 2).locator('[data-carousel-dot]').nth(2).click();
  await workAt(page, 2).locator('[data-slide]').nth(2).locator('[data-shot-open]').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('EARKO');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('3 / 4');
  await page.locator('[data-lightbox-close]').click();
  await expect(dialog).not.toBeVisible();
  // Bouton « Plein écran ».
  await workAt(page, 0).locator('[data-lightbox-open]').click();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('Entreprise de maçonnerie');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('visionneuse mobile : toucher pour ouvrir, glisser pour changer d’image', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE);
  await workAt(page, 1).scrollIntoViewIfNeeded();
  await workAt(page, 1).locator('[data-slide]').first().locator('[data-shot-open]').tap();
  await expect(page.locator('dialog.lightbox')).toBeVisible();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('1 / 4');
  const box = (await page.locator('[data-lightbox-stage]').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const y = Math.round(box.y + box.height / 2);
  const x0 = Math.round(box.x + box.width * 0.8);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 30, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('[data-lightbox-count]')).toHaveText('2 / 4');
  await expect(page.locator('dialog.lightbox')).toBeVisible();
  await context.close();
});

test('texte non éditable : pas de curseur de saisie hors des champs du formulaire', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE);
  const title = page.locator('.hero__title');
  await title.click({ position: { x: 40, y: 20 } });
  const style = await title.evaluate((el) => ({ caret: getComputedStyle(el).caretColor, cursor: getComputedStyle(el).cursor, editable: (el as HTMLElement).isContentEditable }));
  expect(style).toEqual({ caret: 'rgba(0, 0, 0, 0)', cursor: 'default', editable: false });
  // Aucun élément de saisie n'a pris le focus en cliquant dans le texte.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  // Les champs, eux, gardent le curseur et le point d'insertion.
  const field = page.locator('#cf-name');
  await expect(field).toBeVisible();
  expect(await field.evaluate((el) => ({ caret: getComputedStyle(el).caretColor, cursor: getComputedStyle(el).cursor }))).toEqual({ caret: 'rgb(224, 70, 110)', cursor: 'text' });
  // Liens et boutons : main.
  expect(await page.locator('.hero__actions a').first().evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
});

test('néon : animé, découpé par le masque de la bande vin, en pause hors écran', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE);
  const band = page.locator('.symbol__neon-band');
  expect(await band.evaluate((el) => getComputedStyle(el).animationName)).toBe('neon-sweep');
  const mask = await page.locator('.symbol__neon').evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  expect(mask).toContain('symbol-wine.svg');
  const duration = await band.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(duration).toBeGreaterThanOrEqual(6);
  expect(duration).toBeLessThanOrEqual(10);
  expect(await band.evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('running');
  // Parallaxe : le symbole bouge légèrement avec le défilement (transform, pas de détournement du scroll).
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
  await expect.poll(() => page.locator('[data-parallax-symbol]').evaluate((el) => el.style.transform)).toContain('translate3d');
  await page.evaluate(() => window.scrollTo({ top: 2500, behavior: 'instant' }));
  await expect(page.locator('[data-hero]')).toHaveClass(/is-offscreen/);
  expect(await band.evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
});

test('mouvement réduit : néon figé, aucune parallaxe, contenu visible', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(BASE);
  const band = page.locator('.symbol__neon-band');
  expect(await band.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.classList.contains('js-motion'))).toBe(false);
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
  await page.waitForTimeout(200);
  expect(await page.locator('[data-parallax-symbol]').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  const hidden = await page.locator('[data-reveal]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length);
  expect(hidden).toBe(0);
  // Galerie : changement de capture instantané (aucun défilement animé).
  const g = page.locator('[data-carousel]').first();
  await g.scrollIntoViewIfNeeded();
  await g.locator('[data-carousel-next]').click();
  expect(await g.locator('[data-carousel-viewport]').evaluate((v) => v.scrollLeft === v.clientWidth)).toBe(true);
  await page.close();
});

test('formulaire : visible d’emblée, appels à l’action, erreurs, échec serveur (données conservées), succès confirmé', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watch(page);
  await page.goto(BASE);
  // Aucun bouton à cliquer pour révéler le formulaire.
  await expect(page.locator('[data-contact-toggle]')).toHaveCount(0);
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await expect(page.locator('#cf-name')).toBeVisible();
  await expect(page.locator('.contact__promise')).toHaveText('Nous vous répondons sous 1 jour ouvré.');
  // Événements de conversion (émis localement, sans outil tiers ni réseau).
  await page.evaluate(() => {
    (window as unknown as { __ev: string[] }).__ev = [];
    addEventListener('nexora:track', (e) => {
      const d = (e as CustomEvent<{ name: string; props: Record<string, string> }>).detail;
      (window as unknown as { __ev: string[] }).__ev.push(d.props.service ? `${d.name}:${d.props.service}` : d.name);
    });
  });
  // « Demander un devis » mène toujours au formulaire, sous l'en-tête ; « Voir nos réalisations » au portfolio.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.locator('.hero__cta-primary')).toHaveText('Demander un devis');
  await expect(page.locator('.hero__cta-secondary')).toHaveText('Voir nos réalisations');
  await expect(page.locator('.site-header__cta')).toHaveText('Demander un devis');
  await page.locator('.hero__cta-primary').click();
  await page.waitForFunction(() => {
    const t = document.getElementById('contact')!.getBoundingClientRect().top;
    return t >= 80 && t < 120;
  });
  await expect(page.locator('#cf-name')).toBeInViewport();
  // Chaque service présélectionne son type de projet, défile jusqu'au formulaire et met le champ en avant.
  await expect(page.locator('#services .service__title')).toHaveText([
    'Création de sites web',
    'Refonte de sites existants',
    'Responsive design',
    'Optimisation des performances',
    'Maintenance et accompagnement',
  ]);
  const services = ['Création de site vitrine', 'Refonte de site existant', 'Adaptation mobile (responsive)', 'Optimisation des performances', 'Maintenance et accompagnement'];
  for (const [i, type] of services.entries()) {
    await page.locator('#services .service__link').nth(i).click();
    await expect(page.locator('#cf-type')).toHaveValue(type);
    await expect(page.locator('#cf-type')).toBeFocused();
    await expect(page.locator('#cf-type')).toBeInViewport();
  }

  // Données invalides.
  await page.locator('#cf-email').fill('pas-un-email');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-error-for="name"]')).toHaveText('Indiquez votre nom.');
  await expect(page.locator('#cf-email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-form-status]')).toContainText('corriger');

  await page.locator('#cf-name').fill('Léa Dubois');
  await page.locator('#cf-company').fill('Dubois Conseil');
  await page.locator('#cf-email').fill('lea@dubois-conseil.fr');
  await page.locator('#cf-phone').fill('06 12 34 56 78');
  await page.locator('#cf-type').selectOption('Refonte de site existant');
  await page.locator('#cf-budget').selectOption('6 000 à 12 000 €');
  await page.locator('#cf-timeline').selectOption('Dans 1 à 3 mois');
  await page.locator('#cf-message').fill('Nous voulons moderniser notre site et le rendre plus rapide.');
  await page.waitForTimeout(2600); // délai anti-robot

  // Échec serveur simulé : message d'erreur, rien n'est effacé.
  await page.route('**/contact', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Erreur interne. Réessayez dans un instant."}' }));
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-form-status]')).toContainText('Erreur interne');
  await expect(page.locator('#cf-name')).toHaveValue('Léa Dubois');
  await expect(page.locator('#cf-message')).toHaveValue(/moderniser/);
  await page.unroute('**/contact');

  // Succès réel.
  const resp = page.waitForResponse((r) => r.url().endsWith('/contact') && r.request().method() === 'POST');
  await page.locator('[data-submit]').click();
  expect((await resp).status()).toBe(201);
  await expect(page.locator('[data-form-status]')).toContainText('bien été enregistrée');
  await expect(page.locator('#cf-name')).toHaveValue('');
  expect(await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev)).toEqual([
    'cta_primary',
    ...services.map((t) => `service_click:${t}`),
    'form_start',
    'form_submit_success',
  ]);
  expect(problems.filter((p) => !p.includes('500'))).toEqual([]);
});

test('accessibilité (axe, WCAG 2.2 AA) : accueil, détail ouvert, visionneuse, pages légales', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE);
  await revealAll(page);
  expect(await axeViolations(page)).toEqual([]);
  // États interactifs : détail d'une réalisation ouvert, FAQ ouverte, galerie déplacée, visionneuse ouverte.
  await workAt(page, 0).locator('.work__details summary').click();
  await page.locator('.faq__item summary').first().click();
  await workAt(page, 1).locator('[data-carousel-next]').click();
  expect(await axeViolations(page)).toEqual([]);
  await workAt(page, 1).locator('[data-lightbox-open]').click();
  await expect(page.locator('dialog.lightbox')).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  for (const path of ['/mentions-legales', '/politique-de-confidentialite', '/admin/connexion']) {
    await page.goto(`${BASE}${path}`);
    expect(await axeViolations(page), path).toEqual([]);
  }
});

test('référencement : titre, description, données structurées locales, plan du site', async ({ page, request }) => {
  await page.goto(BASE);
  await expect(page).toHaveTitle(/Création de sites web/);
  await expect(page.locator('h1')).toHaveText(/Création de sites web premium pour les PME/);
  expect(await page.locator('meta[name=description]').getAttribute('content')).toMatch(/Romorantin-Lanthenay, Blois, Orléans/);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  const org = ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'ProfessionalService');
  expect(org.areaServed.map((a: { name: string }) => a.name)).toEqual(['Romorantin-Lanthenay', 'Blois', 'Orléans', 'Centre-Val de Loire']);
  expect(org.hasOfferCatalog.itemListElement).toHaveLength(5);
  // Rien d'inventé : pas d'adresse, de téléphone ni d'avis tant qu'ils ne sont pas saisis.
  expect(org.address).toBeUndefined();
  expect(org.telephone).toBeUndefined();
  expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i);
  const sitemap = await (await request.get(`${BASE}/sitemap.xml`)).text();
  expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  // Typographie française : aucun « ? » ou « : » ne peut se retrouver seul en début de ligne.
  const faq = await page.locator('.faq__q').allTextContents();
  for (const q of faq) expect(q).not.toMatch(/ \?$/);
});

test('administration : accès refusé sans connexion, connexion, projet complet reflété sur le site, déconnexion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/admin/projets`);
  await expect(page).toHaveURL(/\/admin\/connexion\?next=%2Fadmin%2Fprojets/);
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill('mauvais');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('.flash--error')).toContainText('incorrect');
  await page.locator('#password').fill(ADMIN.password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(`${BASE}/admin/projets`);

  // La demande envoyée au test précédent est bien en base.
  await page.goto(`${BASE}/admin/demandes`);
  await expect(page.locator('table')).toContainText('Léa Dubois');
  await page.locator('a', { hasText: 'Léa Dubois' }).click();
  await expect(page.locator('.message')).toContainText('moderniser');
  await page.locator('#r-status').selectOption('in_progress');
  await page.locator('button', { hasText: 'Mettre à jour' }).click();
  await expect(page.locator('.flash--ok')).toContainText('Statut mis à jour');

  // Nouveau projet.
  await page.goto(`${BASE}/admin/projets`);
  await page.locator('button', { hasText: 'Nouveau projet' }).click();
  await expect(page.locator('h1')).toHaveText('Nouveau projet');
  await page.locator('#f-name').fill('Cabinet Morel');
  await page.locator('#f-category').fill('Site vitrine · Avocats');
  await page.locator('#f-url').fill('https://cabinet-morel.example');
  await page.locator('#f-challenge').fill('Peu de demandes de rendez-vous en ligne.');
  await page.locator('#f-results').fill('+25 % de demandes de rendez-vous en 3 mois (mesuré).');
  await page.locator('#f-testimonialQuote').fill('Les demandes arrivent enfin qualifiées.');
  await page.locator('#f-testimonialAuthor').fill('Me Morel · Avocate');
  await page.locator('#f-featured').selectOption('2');
  await page.locator('input[name=published]').check();
  await page.locator('button', { hasText: 'Enregistrer' }).first().click();
  await expect(page.locator('.flash--ok')).toContainText('Projet enregistré');

  // Deux images.
  const red = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 160, g: 30, b: 60 } } }).jpeg().toBuffer();
  const blue = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 30, g: 60, b: 160 } } }).png().toBuffer();
  await page.locator('#f-images').setInputFiles([
    { name: 'accueil.jpg', mimeType: 'image/jpeg', buffer: red },
    { name: 'contact.png', mimeType: 'image/png', buffer: blue },
  ]);
  await page.locator('[data-upload-submit]').click();
  await expect(page.locator('.flash--ok')).toContainText('2 image(s) ajoutée(s)');
  await expect(page.locator('.image-row')).toHaveCount(2);
  const alts = page.locator('.image-row input[type=text]');
  await alts.nth(0).fill('Page d’accueil du cabinet Morel');
  await alts.nth(1).fill('Page contact du cabinet Morel');
  await page.locator('button', { hasText: 'Enregistrer les textes alternatifs' }).click();
  await expect(page.locator('.flash--ok')).toContainText('Textes alternatifs enregistrés');
  // Ordre : la seconde devient couverture.
  await page.locator('.image-row').nth(1).locator('button', { hasText: 'Définir comme couverture' }).click();
  await expect(page.locator('.image-row').nth(0).locator('input[type=text]')).toHaveValue('Page contact du cabinet Morel');

  // Reflété sur le site, sans toucher au code : projet client en tête de « Nos réalisations », avant les concepts.
  const site = await page.context().newPage();
  await site.goto(BASE);
  await expect(site.locator('#realisations [data-work]')).toHaveCount(4);
  await expect(site.locator('.hero__cta-secondary')).toHaveText('Voir nos réalisations');
  const first = workAt(site, 0);
  await expect(first.locator('.work__title')).toHaveText('Cabinet Morel');
  await expect(first.locator('.badge-client')).toHaveText('Projet client');
  await expect(first.locator('.badge-demo')).toHaveCount(0);
  await expect(first.locator('.work__result')).toContainText('+25 % de demandes de rendez-vous en 3 mois (mesuré).');
  await first.locator('.work__details summary').click();
  await expect(first.locator('.case__quote')).toContainText('Les demandes arrivent enfin qualifiées.');
  await expect(first.locator('a', { hasText: 'Voir le site' })).toHaveAttribute('href', 'https://cabinet-morel.example');
  await expect(first.locator('[data-shot-open]').first()).toHaveAttribute('aria-label', /Page contact du cabinet Morel/);
  await expect(first.locator('[data-slide]')).toHaveCount(2);
  await expect(first.locator('[data-carousel-dot]')).toHaveCount(2);
  await expect(workAt(site, 1).locator('.badge-demo')).toHaveText('Concept / Démonstration');

  // Suppression d'une image → une seule capture : ni flèches ni points, la capture ouvre toujours la visionneuse.
  await page.locator('.image-row').nth(1).locator('button', { hasText: 'Supprimer' }).click();
  await expect(page.locator('.image-row')).toHaveCount(1);
  await site.reload();
  await expect(workAt(site, 0).locator('[data-carousel-dot]')).toHaveCount(0);
  await expect(workAt(site, 0).locator('[data-carousel-next]')).toHaveCount(0);
  await workAt(site, 0).locator('[data-shot-open]').click();
  await expect(site.locator('[data-lightbox-count]')).toHaveText('1 / 1');
  await site.keyboard.press('Escape');

  // Contenus.
  await page.goto(`${BASE}/admin/contenus`);
  await page.locator('#c-hero-subtitle').fill('Design sur mesure. Performance. Résultats.');
  await page.locator('#c-contact-bookingUrl').fill('https://cal.com/nexora/diagnostic');
  await page.locator('button', { hasText: 'Enregistrer et publier' }).click();
  await expect(page.locator('.flash--ok')).toBeVisible();
  await site.reload();
  await expect(site.locator('.hero__lead')).toHaveText('Design sur mesure. Performance. Résultats.');
  // Lien de rendez-vous configuré : proposé dans la section Contact (fenêtre intégrée pour Cal.com) ; les boutons
  // « Demander un devis » mènent toujours au formulaire. La confirmation envoyée par le service (depuis son origine)
  // déclenche « booking_completed ».
  await expect(site.locator('.hero__cta-primary')).toHaveText('Demander un devis');
  await expect(site.locator('.hero__cta-primary')).toHaveAttribute('href', '#contact');
  const bookingLink = site.locator('.contact__booking a', { hasText: 'Réserver un créneau de 20 min' });
  await expect(bookingLink).toHaveAttribute('href', 'https://cal.com/nexora/diagnostic');
  await site.route(/cal\.com/, (r) =>
    r.fulfill({ contentType: 'text/html', body: '<p>Agenda</p><script>setTimeout(() => parent.postMessage({ originator: "CAL", type: "bookingSuccessfulV2" }, "*"), 200)</script>' }),
  );
  const booked = site.evaluate(() => new Promise<string>((ok) => addEventListener('nexora:track', (e) => (e as CustomEvent<{ name: string }>).detail.name === 'booking_completed' && ok('ok'))));
  await bookingLink.scrollIntoViewIfNeeded();
  await bookingLink.click();
  await expect(site.locator('dialog.booking')).toBeVisible();
  await expect(site.locator('dialog.booking iframe')).toHaveAttribute('src', /^https:\/\/cal\.com\/nexora\/diagnostic\?embed=/);
  expect(await booked).toBe('ok');
  await site.locator('[data-booking-close]').click();
  await expect(site.locator('dialog.booking')).not.toBeVisible();
  await site.close();

  // Déconnexion.
  await page.locator('button', { hasText: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/admin\/connexion/);
  await page.goto(`${BASE}/admin`);
  await expect(page).toHaveURL(/\/admin\/connexion/);
});

test('persistance après redémarrage du serveur (base + fichiers)', async ({ page }) => {
  await stop();
  await start();
  await page.goto(BASE);
  await expect(workAt(page, 0).locator('.work__title')).toHaveText('Cabinet Morel');
  await expect(page.locator('.hero__lead')).toHaveText('Design sur mesure. Performance. Résultats.');
  const src = await workAt(page, 0).locator('[data-slide] img').first().getAttribute('src');
  const img = await page.request.get(`${BASE}${src}`);
  expect(img.status()).toBe(200);
  await page.goto(`${BASE}/admin/connexion`);
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.locator('button[type=submit]').click();
  await page.goto(`${BASE}/admin/demandes`);
  await expect(page.locator('table')).toContainText('Léa Dubois');
  await expect(page.locator('table')).toContainText('En cours');
});
