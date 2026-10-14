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

const caseAt = (page: Page, n: number) => page.locator('#realisations .case').nth(n);

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
    // Visuels des études de cas au format 16:10 (captures entières, sans recadrage).
    const ratios = await page.locator('.case__cover').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height));
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
    ['Méthode', 'methode'],
    ['FAQ', 'faq'],
  ]) {
    await page.locator('.site-nav__link', { hasText: label }).click();
    await page.waitForFunction((sid) => Math.abs(document.getElementById(sid)!.getBoundingClientRect().top - 84) < 4, id);
  }
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

test('études de cas : contexte, solution, résultats, concepts signalés, images chargées à la demande', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const media: string[] = [];
  page.on('request', (r) => r.url().includes('/media/') && media.push(r.url()));
  await page.goto(BASE);
  // Rien n'est chargé tant que les études de cas sont hors écran (chargement paresseux).
  expect(media).toEqual([]);
  await page.locator('#realisations').scrollIntoViewIfNeeded();
  for (let n = 0; n < 3; n++) {
    const c = caseAt(page, n);
    await expect(c.locator('.badge-demo')).toHaveText('Concept / Démonstration');
    await expect(c.locator('dt')).toHaveText(['Contexte / défi', 'Solution apportée', 'Résultats mesurables']);
    await expect(c.locator('.case__results dd')).toContainText('aucun résultat mesuré');
    await expect(c.locator('.case__thumb')).toHaveCount(4);
  }
  await caseAt(page, 2).scrollIntoViewIfNeeded();
  // Couverture : variante adaptée à l'écran (pas la 2400 px), nette.
  await expect.poll(() => caseAt(page, 0).locator('.case__cover img').evaluate((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(media.some((u) => u.includes('/2400.'))).toBe(false);
});

test('visionneuse : capture entière (jamais recadrée), navigation, zoom, Échap, focus rendu', async ({ page }) => {
  // Fenêtre basse et large (cas signalé) : l'image doit tenir entière entre la barre et la légende.
  await page.setViewportSize({ width: 1920, height: 871 });
  const problems = watch(page);
  await page.goto(BASE);
  await caseAt(page, 1).scrollIntoViewIfNeeded();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).not.toBeVisible();

  const cover = caseAt(page, 1).locator('.case__cover');
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

  // Vignette 3 d'un autre projet (clavier) : ouvre directement la bonne image.
  await caseAt(page, 2).locator('.case__thumb').nth(2).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('EARKO');
  await expect(page.locator('[data-lightbox-count]')).toHaveText('3 / 4');
  await page.locator('[data-lightbox-close]').click();
  await expect(dialog).not.toBeVisible();
  // Bouton « Voir les 4 captures ».
  await caseAt(page, 0).locator('[data-lightbox-open]').click();
  await expect(page.locator('[data-lightbox-title]')).toHaveText('Entreprise de maçonnerie');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('visionneuse mobile : toucher pour ouvrir, glisser pour changer d’image', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE);
  await caseAt(page, 1).scrollIntoViewIfNeeded();
  await caseAt(page, 1).locator('.case__cover').tap();
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
  // « Réserver un diagnostic » (sans lien de rendez-vous configuré) : mène au formulaire, titre sous l'en-tête.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('.hero__cta-primary').click();
  await page.waitForFunction(() => {
    const t = document.getElementById('contact')!.getBoundingClientRect().top;
    return t >= 80 && t < 120;
  });
  await expect(page.locator('#cf-name')).toBeInViewport();
  // « Parler de ce projet » (service E-commerce) : type de projet présélectionné.
  await page.locator('#services .service__link').nth(2).click();
  await expect(page.locator('#cf-type')).toHaveValue('Site e-commerce');

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
  const second = caseAt(site, 1);
  await expect(second.locator('.case__title')).toHaveText('Cabinet Morel');
  await expect(second.locator('a', { hasText: 'Voir le projet' })).toHaveAttribute('href', 'https://cabinet-morel.example');
  await expect(second.locator('.case__thumb').first()).toHaveAttribute('aria-label', /Page contact du cabinet Morel/);
  await expect(second.locator('.badge-demo')).toHaveCount(0);
  await expect(second.locator('.badge-client')).toHaveText('Projet client');
  await expect(second.locator('.case__thumb')).toHaveCount(2);

  // Suppression d'une image → une seule image : plus de vignettes, la couverture ouvre toujours la visionneuse.
  await page.locator('.image-row').nth(1).locator('button', { hasText: 'Supprimer' }).click();
  await expect(page.locator('.image-row')).toHaveCount(1);
  await site.reload();
  await expect(caseAt(site, 1).locator('.case__thumb')).toHaveCount(0);
  await caseAt(site, 1).locator('.case__cover').click();
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
  // Lien de rendez-vous : utilisé par les boutons « Réserver », en nouvel onglet.
  await expect(site.locator('.hero__cta-primary')).toHaveAttribute('href', 'https://cal.com/nexora/diagnostic');
  await expect(site.locator('.hero__cta-primary')).toHaveAttribute('target', '_blank');
  await expect(site.locator('.contact__alt a', { hasText: 'Réserver un créneau de 20 min' })).toBeVisible();
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
  await expect(caseAt(page, 1).locator('.case__title')).toHaveText('Cabinet Morel');
  await expect(page.locator('.hero__lead')).toHaveText('Design sur mesure. Performance. Résultats.');
  const src = await caseAt(page, 1).locator('.case__cover img').getAttribute('src');
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
