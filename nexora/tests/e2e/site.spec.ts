import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN, BASE, prepare, start, stop } from './server';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await prepare();
  await start();
});
test.afterAll(async () => stop());

/** Échoue si la page produit une erreur console ou une requête en échec inattendue. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requête: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
  return problems;
}

async function scrollLeftOf(page: Page, n: number) {
  return page.locator(`#carousel-${n} [data-carousel-viewport]`).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
}

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
    // Cartes de projets carrées.
    const ratios = await page.locator('.carousel').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height));
    for (const r of ratios) expect(Math.abs(r - 1)).toBeLessThan(0.01);
    // Le hero ne se chevauche pas : titre au-dessus du bouton, bouton au-dessus du symbole sur mobile.
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
  await expect(page.locator('[data-header]')).not.toHaveClass(/is-scrolled/);
  await page.locator('.site-nav__link', { hasText: 'Réalisations' }).click();
  await page.waitForFunction(() => Math.abs(document.getElementById('realisations')!.getBoundingClientRect().top - 84) < 4);
  await expect(page.locator('[data-header]')).toHaveClass(/is-scrolled/);
  const backdrop = await page.locator('[data-header]').evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(backdrop).toContain('blur');
  await page.locator('.site-nav__link', { hasText: 'Contact' }).click();
  // Dernière section : la page s'arrête avant que son haut n'atteigne l'en-tête ; elle ne doit jamais passer DESSOUS.
  await page.waitForFunction(() => {
    const top = document.getElementById('contact')!.getBoundingClientRect().top;
    return top >= 82 && top < window.innerHeight / 2 && Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 4;
  });
  await page.locator('.site-nav__link', { hasText: 'Accueil' }).click();
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

test('carrousels indépendants : flèches, points, clavier, chargement paresseux', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const media: string[] = [];
  page.on('request', (r) => r.url().includes('/media/') && media.push(r.url()));
  await page.goto(BASE);
  await page.locator('#realisations').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const firstIds = await page.locator('.carousel__slide:first-child img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).currentSrc.split('/')[4]));
  const loaded = new Set(media.map((u) => u.split('/')[4]));
  expect([...loaded].sort(), 'seulement la première image de chaque carrousel').toEqual([...firstIds].sort());
  expect(loaded.size).toBe(3);

  // Flèche suivante sur le carrousel 2 : seuls ses propres éléments bougent.
  await page.locator('#carousel-2 [data-carousel-next]').click();
  await expect.poll(() => scrollLeftOf(page, 2)).toBe(1);
  expect(await scrollLeftOf(page, 1)).toBe(0);
  expect(await scrollLeftOf(page, 3)).toBe(0);
  await expect(page.locator('#carousel-2 [data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#carousel-1 [data-carousel-dot="0"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#carousel-2 [data-carousel-status]')).toHaveText('Image 2 sur 4');
  await expect
    .poll(() => page.locator('#carousel-2 .carousel__slide').nth(1).locator('img').evaluate((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0))
    .toBe(true);
  // Les autres carrousels n'ont rien chargé de plus.
  expect(await page.locator('#carousel-1 picture[data-deferred]').count()).toBe(3);
  expect(await page.locator('#carousel-3 picture[data-deferred]').count()).toBe(3);

  // Points du carrousel 3.
  await page.locator('#carousel-3 [data-carousel-dot="2"]').click();
  await expect.poll(() => scrollLeftOf(page, 3)).toBe(2);
  expect(await scrollLeftOf(page, 2)).toBe(1);

  // Précédent depuis la première image : boucle vers la dernière.
  await page.locator('#carousel-1 [data-carousel-prev]').click();
  await expect.poll(() => scrollLeftOf(page, 1)).toBe(3);

  // Clavier.
  await page.locator('#carousel-1 [data-carousel-viewport]').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => scrollLeftOf(page, 1)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scrollLeftOf(page, 1)).toBe(1);
  expect(await scrollLeftOf(page, 3)).toBe(2);
  expect(await scrollLeftOf(page, 2)).toBe(1);
});

test('carrousels : glissement tactile réel sur mobile, sans entraîner les autres', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('#carousel-2').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = (await page.locator('#carousel-2').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  // Vrais événements tactiles (touchstart → touchmove → touchend) : glissement du doigt vers la gauche.
  const y = Math.round(box.y + box.height * 0.3);
  const x0 = Math.round(box.x + box.width * 0.85);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * Math.round(box.width * 0.07), y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => scrollLeftOf(page, 2)).toBe(1);
  await expect(page.locator('#carousel-2 [data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');
  expect(await scrollLeftOf(page, 1)).toBe(0);
  expect(await scrollLeftOf(page, 3)).toBe(0);
  await expect.poll(() => page.locator('#carousel-2 .carousel__slide').nth(1).locator('img').evaluate((e) => (e as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await context.close();
});

test('visionneuse : clic sur une capture, navigation, zoom, Échap, retour au carrousel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watch(page);
  await page.goto(BASE);
  await page.locator('#carousel-1').scrollIntoViewIfNeeded();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).not.toBeVisible();

  // Clic direct sur l'image.
  await page.locator('#carousel-1 .carousel__slide').first().locator('img').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('Entreprise de maçonnerie');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('1 / 4');
  const alt = await page.locator('#carousel-1 .carousel__slide').first().locator('img').getAttribute('alt');
  await expect(page.locator('[data-lightbox-caption]')).toHaveText(alt!);
  // Image plus grande que dans la carte (variante haute définition).
  await expect.poll(() => page.locator('.lightbox__img').last().evaluate((e) => Number(/\/(\d+)\.(?:avif|webp)$/.exec((e as HTMLImageElement).currentSrc)?.[1] ?? 0))).toBeGreaterThanOrEqual(1200);
  // Fond inerte : le focus est dans la visionneuse.
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);

  // Navigation clavier et boutons, en boucle.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('2 / 4');
  await page.locator('[data-lightbox-prev]').click();
  await page.locator('[data-lightbox-prev]').click();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('4 / 4');
  await page.locator('[data-lightbox-next]').click();
  await expect(page.locator('[data-lightbox-count]')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('2 / 4');

  // Zoom au clic sur l'image, puis dézoom.
  const img = page.locator('.lightbox__img').last();
  await img.click();
  await expect(page.locator('[data-lightbox-zoom]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => img.evaluate((e) => getComputedStyle(e).transform)).toContain('matrix(2');
  await page.locator('[data-lightbox-zoom]').click();
  await expect(page.locator('[data-lightbox-zoom]')).toHaveAttribute('aria-pressed', 'false');

  // Échap : fermeture, focus rendu au carrousel, qui affiche l'image vue en dernier.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('#carousel-1') !== null)).toBe(true);
  await expect.poll(() => scrollLeftOf(page, 1)).toBe(1);
  await expect(page.locator('#carousel-1 [data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');
  expect(await scrollLeftOf(page, 2)).toBe(0);

  // Bouton « Agrandir » (clavier) et projet suivant.
  await page.locator('#carousel-3 [data-lightbox-open]').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('EARKO');
  await page.locator('[data-lightbox-close]').click();
  await expect(dialog).not.toBeVisible();
  expect(problems).toEqual([]);
});

test('visionneuse mobile : toucher pour ouvrir, glisser pour changer d’image', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('#carousel-2').scrollIntoViewIfNeeded();
  await page.locator('#carousel-2 .carousel__slide').first().locator('img').tap();
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
  await page.locator('[data-contact-toggle]').click();
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
  await page.close();
});

test('formulaire : ouverture, erreurs, échec serveur (données conservées), succès confirmé par le serveur', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watch(page);
  await page.goto(BASE);
  await expect(page.locator('#formulaire-contact')).toBeHidden();
  await page.locator('[data-contact-toggle]').click();
  await expect(page.locator('#formulaire-contact')).toBeVisible();
  await expect(page.locator('[data-contact-toggle]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#cf-name')).toBeFocused();

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
  await page.locator('#cf-type').selectOption('Refonte de site');
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
  expect(problems.filter((p) => !p.includes('500'))).toEqual([]);
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

  // Reflété sur le site, en position 2, sans toucher au code.
  const site = await page.context().newPage();
  await site.goto(BASE);
  const second = site.locator('.project-grid__item').nth(1);
  await expect(second.locator('.project-card__title')).toHaveText('Cabinet Morel');
  await expect(second.locator('.project-card__link')).toHaveAttribute('href', 'https://cabinet-morel.example');
  await expect(second.locator('img').first()).toHaveAttribute('alt', 'Page contact du cabinet Morel');
  await expect(second.locator('.badge-demo')).toHaveCount(0);
  await expect(second.locator('.carousel__slide')).toHaveCount(2);

  // Suppression d'une image → une seule image : contrôles du carrousel masqués.
  await page.locator('.image-row').nth(1).locator('button', { hasText: 'Supprimer' }).click();
  await expect(page.locator('.image-row')).toHaveCount(1);
  await site.reload();
  await expect(site.locator('.project-grid__item').nth(1).locator('[data-carousel-next]')).toHaveCount(0);
  await expect(site.locator('.project-grid__item').nth(1).locator('.carousel__slide')).toHaveCount(1);

  // Contenus.
  await page.goto(`${BASE}/admin/contenus`);
  await page.locator('#c-hero-subtitle').fill('Design sur mesure. Performance. Résultats.');
  await page.locator('button', { hasText: 'Enregistrer et publier' }).click();
  await expect(page.locator('.flash--ok')).toBeVisible();
  await site.reload();
  await expect(site.locator('.hero__lead')).toHaveText('Design sur mesure. Performance. Résultats.');
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
  await expect(page.locator('.project-grid__item').nth(1).locator('.project-card__title')).toHaveText('Cabinet Morel');
  await expect(page.locator('.hero__lead')).toHaveText('Design sur mesure. Performance. Résultats.');
  const src = await page.locator('.project-grid__item').nth(1).locator('img').first().getAttribute('src');
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
