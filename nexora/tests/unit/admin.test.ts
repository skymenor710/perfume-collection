import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { ADMIN_PASSWORD, Client, contactPayload, createAdmin, pngBuffer, setup, type TestCtx } from '../helpers';
import { auditLog, contactRequests, projectImages, projects, sessions } from '../../src/server/db/schema';
import { sha256 } from '../../src/server/lib/crypto';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setup();
  await createAdmin(ctx);
});
afterEach(async () => ctx.close());

async function loggedIn() {
  const c = new Client(ctx);
  const res = await c.login();
  expect(res.status).toBe(303);
  return c;
}
async function newProject(c: Client) {
  const token = await c.csrf('/admin/projets');
  const res = await c.form('/admin/projets', { _csrf: token });
  expect(res.status).toBe(303);
  const id = res.headers.get('location')!.split('/').pop()!;
  return { id, token };
}
function upload(c: Client, id: string, token: string, files: { name: string; type: string; data: Buffer }[]) {
  const fd = new FormData();
  fd.set('_csrf', token);
  for (const f of files) fd.append('images', new File([new Uint8Array(f.data)], f.name, { type: f.type }));
  return c.req(`/admin/projets/${id}/images`, { method: 'POST', body: fd });
}

describe('accès à l’administration', () => {
  it('toutes les pages protégées redirigent vers la connexion sans session', async () => {
    const c = new Client(ctx);
    for (const p of ['/admin', '/admin/projets', '/admin/contenus', '/admin/demandes', '/admin/compte', '/admin/projets/00000000-0000-0000-0000-000000000000']) {
      const res = await c.req(p);
      expect(res.status, p).toBe(303);
      expect(res.headers.get('location')).toMatch(/^\/admin\/connexion/);
    }
  });

  it('toutes les actions protégées sont refusées sans session (401), même avec une origine valide', async () => {
    const c = new Client(ctx);
    for (const p of ['/admin/projets', '/admin/contenus', '/admin/deconnexion', '/admin/compte/mot-de-passe']) {
      const res = await c.form(p, { _csrf: 'x' }, { headers: { 'x-requested-with': 'fetch' } });
      expect(res.status, p).toBe(401);
    }
    expect(await ctx.deps.db.select().from(projects)).toHaveLength(0);
  });

  it('aucune inscription publique : pas de route de création de compte', async () => {
    const c = new Client(ctx);
    for (const p of ['/admin/inscription', '/admin/register', '/admin/signup']) {
      expect((await c.req(p)).status).not.toBe(200);
    }
  });
});

describe('connexion', () => {
  it('mauvais identifiants : message générique, pas de cookie de session', async () => {
    const c = new Client(ctx);
    const bad = await c.login('admin@nexora.test', 'mauvais-mot-de-passe');
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Adresse e-mail ou mot de passe incorrect.');
    const unknown = await c.login('inconnu@nexora.test', ADMIN_PASSWORD);
    expect(await unknown.text()).toContain('Adresse e-mail ou mot de passe incorrect.');
    expect([...c.cookies.keys()]).not.toContain('nx_session');
  });

  it('cookie de session HttpOnly + SameSite ; seule l’empreinte du jeton est stockée', async () => {
    const c = new Client(ctx);
    await c.req('/admin/connexion');
    const page = await c.req('/admin/connexion');
    const pre = /name="_pre" value="([^"]+)"/.exec(await page.text())![1];
    const res = await c.form('/admin/connexion', { _pre: pre, email: 'ADMIN@nexora.test', password: ADMIN_PASSWORD });
    expect(res.status).toBe(303);
    const setCookie = res.headers.getSetCookie().find((h) => h.startsWith('nx_session='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const token = c.cookies.get('nx_session')!;
    const rows = await ctx.deps.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sha256(token));
    expect(rows[0].id).not.toBe(token);
    expect((await c.req('/admin')).status).toBe(200);
  });

  it('refuse la connexion sans jeton pré-session (CSRF de connexion) ou depuis une autre origine', async () => {
    const c = new Client(ctx);
    await c.req('/admin/connexion');
    const noPre = await c.form('/admin/connexion', { email: 'admin@nexora.test', password: ADMIN_PASSWORD });
    expect(noPre.status).toBe(400);
    const page = await c.req('/admin/connexion');
    const pre = /name="_pre" value="([^"]+)"/.exec(await page.text())![1];
    const cross = await c.form('/admin/connexion', { _pre: pre, email: 'admin@nexora.test', password: ADMIN_PASSWORD }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(400);
    expect(await ctx.deps.db.select().from(sessions)).toHaveLength(0);
  });

  it('verrouille le compte après 8 échecs (même avec le bon mot de passe ensuite)', async () => {
    for (let i = 0; i < 8; i++) {
      const c = new Client(ctx, `192.0.2.${i + 1}`);
      expect((await c.login('admin@nexora.test', `faux-${i}`)).status).toBe(400);
    }
    const c = new Client(ctx, '192.0.2.200');
    const res = await c.login();
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Trop de tentatives');
  });

  it('limite les tentatives par IP (20 / 15 min)', async () => {
    const c = new Client(ctx, '192.0.2.250');
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await c.login(`x${i}@nexora.test`, 'faux')).status;
    expect(last).toBe(429);
  });

  it('redirection après connexion limitée à /admin (pas de redirection ouverte)', async () => {
    const c = new Client(ctx);
    const page = await c.req('/admin/connexion');
    const pre = /name="_pre" value="([^"]+)"/.exec(await page.text())![1];
    const res = await c.form('/admin/connexion', { _pre: pre, email: 'admin@nexora.test', password: ADMIN_PASSWORD, next: '//evil.example/x' });
    expect(res.headers.get('location')).toBe('/admin');
  });

  it('déconnexion : la session est supprimée côté serveur', async () => {
    const c = await loggedIn();
    const token = await c.csrf();
    const stolen = c.cookies.get('nx_session')!;
    expect((await c.form('/admin/deconnexion', { _csrf: token })).status).toBe(303);
    expect(await ctx.deps.db.select().from(sessions)).toHaveLength(0);
    const replay = new Client(ctx);
    replay.cookies.set('nx_session', stolen);
    expect((await replay.req('/admin')).status).toBe(303);
  });
});

describe('CSRF', () => {
  it('refuse une action authentifiée sans jeton, avec un mauvais jeton ou depuis une autre origine', async () => {
    const c = await loggedIn();
    expect((await c.form('/admin/projets', {})).status).toBe(403);
    expect((await c.form('/admin/projets', { _csrf: 'faux' })).status).toBe(403);
    const token = await c.csrf();
    expect((await c.form('/admin/projets', { _csrf: token }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.form('/admin/projets', { _csrf: token }, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect(await ctx.deps.db.select().from(projects)).toHaveLength(0);
    expect((await c.form('/admin/projets', { _csrf: token })).status).toBe(303);
    expect(await ctx.deps.db.select().from(projects)).toHaveLength(1);
  });
});

describe('projets', () => {
  it('création, édition, publication et mise en avant visibles immédiatement sur le site', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    // Brouillon : invisible.
    expect(await (await new Client(ctx).req('/')).text()).not.toContain('Boulangerie Dupont');
    const res = await c.form(`/admin/projets/${id}`, {
      _csrf: token,
      name: 'Boulangerie Dupont',
      category: 'Site vitrine · Design sur mesure',
      description: '',
      url: 'https://boulangerie-dupont.fr',
      challenge: 'Peu de commandes en ligne.',
      solution: 'Site vitrine avec commande de gâteaux.',
      results: '+38 % de commandes en 3 mois (mesuré).',
      caseUrl: 'https://nexora.example/etudes/dupont',
      featuredPosition: '1',
      published: '1',
    });
    expect(res.status).toBe(303);
    const home = await (await new Client(ctx).req('/')).text();
    expect(home).toContain('Boulangerie Dupont');
    expect(home).toContain('href="https://boulangerie-dupont.fr"');
    expect(home).toContain('rel="noopener noreferrer nofollow"');
    // Étude de cas : contexte, solution, résultats et lien vers l'étude complète.
    expect(home).toContain('Peu de commandes en ligne.');
    expect(home).toContain('+38 % de commandes en 3 mois (mesuré).');
    expect(home).toContain('href="https://nexora.example/etudes/dupont"');
    expect(home).toContain('Lire l’étude de cas');
    // Projet réel : mention « Projet client », jamais « Concept / Démonstration ».
    expect(home).toContain('Projet client');
    expect(home).not.toContain('Concept / Démonstration');
    expect(await ctx.deps.db.select().from(auditLog)).not.toHaveLength(0);
  });

  it('refuse les URL dangereuses (javascript:, data:) et les champs trop longs', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://exemple.fr', 'https://user:pass@exemple.fr']) {
      const res = await c.form(`/admin/projets/${id}`, { _csrf: token, name: 'X', category: '', description: '', url, featuredPosition: '' });
      expect(res.status, url).toBe(422);
    }
    const long = await c.form(`/admin/projets/${id}`, { _csrf: token, name: 'x'.repeat(200), category: '', description: '', url: '', featuredPosition: '' });
    expect(long.status).toBe(422);
    const [p] = await ctx.deps.db.select().from(projects).where(eq(projects.id, id));
    expect(p.url).toBeNull();
  });

  it('échappe le HTML saisi (pas de XSS stockée)', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    await c.form(`/admin/projets/${id}`, { _csrf: token, name: '<img src=x onerror=alert(1)>', category: '<script>alert(1)</script>', description: '', url: '', featuredPosition: '1', published: '1' });
    const home = await (await new Client(ctx).req('/')).text();
    expect(home).not.toContain('<script>alert(1)</script>');
    expect(home).not.toContain('<img src=x onerror');
    expect(home).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('une seule position par projet sur l’accueil', async () => {
    const c = await loggedIn();
    const a = await newProject(c);
    const b = await newProject(c);
    await c.form(`/admin/projets/${a.id}/accueil`, { _csrf: a.token, position: '2' });
    await c.form(`/admin/projets/${b.id}/accueil`, { _csrf: a.token, position: '2' });
    const rows = await ctx.deps.db.select().from(projects);
    expect(rows.find((r) => r.id === a.id)!.featuredPosition).toBeNull();
    expect(rows.find((r) => r.id === b.id)!.featuredPosition).toBe(2);
    expect((await c.form(`/admin/projets/${a.id}/accueil`, { _csrf: a.token, position: '7' })).status).toBe(400);
  });

  it('images : envoi, optimisation AVIF/WebP, ordre, couverture, suppression des fichiers', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    const res = await upload(c, id, token, [
      { name: 'une.png', type: 'image/png', data: await pngBuffer(1000, 1000, { r: 200, g: 10, b: 10 }) },
      { name: 'deux.png', type: 'image/png', data: await pngBuffer(900, 900, { r: 10, g: 200, b: 10 }) },
    ]);
    expect(res.status).toBe(303);
    let imgs = await ctx.deps.db.select().from(projectImages).where(eq(projectImages.projectId, id));
    expect(imgs).toHaveLength(2);
    const first = imgs.sort((x, y) => x.sortOrder - y.sortOrder)[0];
    expect(first.variants.map((v) => `${v.width}.${v.format}`).sort()).toEqual(['1000.avif', '1000.webp', '480.avif', '480.webp', '640.avif', '640.webp', '800.avif', '800.webp']);
    const dir = path.join(ctx.dir, 'uploads', first.storagePrefix);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toContain('master.webp');

    // Projet non publié : images invisibles pour le public, visibles pour l'admin.
    expect((await new Client(ctx).req(`/media/${first.id}/480.webp`)).status).toBe(404);
    const adminImg = await c.req(`/media/${first.id}/480.webp`);
    expect(adminImg.status).toBe(200);
    expect(adminImg.headers.get('content-type')).toBe('image/webp');
    expect(adminImg.headers.get('cache-control')).toBe('private, no-store');
    // Chemins arbitraires refusés.
    expect((await c.req(`/media/${first.id}/..%2F..%2Fsecret.webp`)).status).toBe(404);
    expect((await c.req(`/media/${first.id}/master.webp`)).status).toBe(404);

    // Ordre et couverture.
    const second = imgs.find((i) => i.id !== first.id)!;
    await c.form(`/admin/projets/${id}/images/${second.id}/couverture`, { _csrf: token });
    let [p] = await ctx.deps.db.select().from(projects).where(eq(projects.id, id));
    expect(p.coverImageId).toBe(second.id);
    await c.form(`/admin/projets/${id}/images/${first.id}/deplacer`, { _csrf: token, direction: 'up' });
    [p] = await ctx.deps.db.select().from(projects).where(eq(projects.id, id));
    expect(p.coverImageId).toBe(first.id);

    // Textes alternatifs.
    await c.form(`/admin/projets/${id}/images/textes`, { _csrf: token, [`alt:${first.id}`]: 'Page d’accueil du site' });
    imgs = await ctx.deps.db.select().from(projectImages).where(eq(projectImages.id, first.id));
    expect(imgs[0].alt).toBe('Page d’accueil du site');

    // Publication : images publiques avec cache long.
    await c.form(`/admin/projets/${id}/publication`, { _csrf: token, published: '1' });
    const pub = await new Client(ctx).req(`/media/${first.id}/480.webp`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('cache-control')).toContain('immutable');

    // Suppression : ligne et fichiers.
    await c.form(`/admin/projets/${id}/images/${first.id}/supprimer`, { _csrf: token });
    expect(existsSync(dir)).toBe(false);
    expect((await new Client(ctx).req(`/media/${first.id}/480.webp`)).status).toBe(404);
  });

  it('refuse les fichiers qui ne sont pas de vraies images (SVG, faux JPEG, trop petits, trop gros)', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    const fakeJpeg = Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(200, ' '));
    const truncated = (await pngBuffer(800, 800)).subarray(0, 120);
    const res = await upload(c, id, token, [
      { name: 'logo.svg', type: 'image/svg+xml', data: svg },
      { name: 'photo.jpg', type: 'image/jpeg', data: fakeJpeg },
      { name: 'tronquee.png', type: 'image/png', data: truncated },
      { name: 'mini.png', type: 'image/png', data: await pngBuffer(100, 100) },
    ]);
    expect(res.status).toBe(303);
    expect(await ctx.deps.db.select().from(projectImages)).toHaveLength(0);
    const page = await (await c.req(`/admin/projets/${id}`)).text();
    expect(page).toContain('Format non pris en charge');
    expect(page).toContain('Image illisible ou corrompue');
    expect(page).toContain('Image trop petite');

    // Au-delà de la limite (UPLOAD_MAX_MB=2 dans les tests).
    const big = Buffer.concat([await pngBuffer(800, 800), Buffer.alloc(3 * 1024 * 1024)]);
    await upload(c, id, token, [{ name: 'grosse.png', type: 'image/png', data: big }]);
    expect(await ctx.deps.db.select().from(projectImages)).toHaveLength(0);
    expect(await (await c.req(`/admin/projets/${id}`)).text()).toContain('Fichier trop volumineux');
  });

  it('suppression d’un projet : images et fichiers supprimés', async () => {
    const c = await loggedIn();
    const { id, token } = await newProject(c);
    await upload(c, id, token, [{ name: 'a.png', type: 'image/png', data: await pngBuffer() }]);
    expect(existsSync(path.join(ctx.dir, 'uploads', 'projects', id))).toBe(true);
    await c.form(`/admin/projets/${id}/supprimer`, { _csrf: token });
    expect(await ctx.deps.db.select().from(projects)).toHaveLength(0);
    expect(await ctx.deps.db.select().from(projectImages)).toHaveLength(0);
    expect(existsSync(path.join(ctx.dir, 'uploads', 'projects', id))).toBe(false);
  });

  it('ordre des projets : monter / descendre', async () => {
    const c = await loggedIn();
    const a = await newProject(c);
    const b = await newProject(c);
    await c.form(`/admin/projets/${b.id}/deplacer`, { _csrf: a.token, direction: 'up' });
    const rows = (await ctx.deps.db.select().from(projects)).sort((x, y) => x.sortOrder - y.sortOrder);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe('contenus', () => {
  it('« Derrière Nexora » : masquée tant que vide, puis nom, texte et photo envoyée (servie publiquement)', async () => {
    const c = await loggedIn();
    expect(await (await new Client(ctx).req('/')).text()).not.toContain('id="equipe"');
    let token = await c.csrf('/admin/contenus');
    const fd = new FormData();
    fd.set('_csrf', token);
    fd.append('photo', new File([new Uint8Array(await pngBuffer(800, 1000))], 'portrait.png', { type: 'image/png' }));
    const up = await c.req('/admin/contenus/photo', { method: 'POST', body: fd });
    expect(up.status).toBe(303);
    // Photo seule : la section reste masquée (pas de personne sans nom ni texte).
    expect(await (await new Client(ctx).req('/')).text()).not.toContain('id="equipe"');
    token = await c.csrf('/admin/contenus');
    expect((await c.form('/admin/contenus', { _csrf: token, 'team.name': 'Prénom Nom', 'team.role': 'Fondateur', 'team.text': 'Texte réel.', 'team.photoAlt': 'Portrait' })).status).toBe(303);
    const home = await (await new Client(ctx).req('/')).text();
    expect(home).toContain('id="equipe"');
    expect(home).toContain('alt="Portrait"');
    const src = /<picture class="team__photo"[\s\S]*?<img src="([^"]+)"/.exec(home)![1];
    const img = await new Client(ctx).req(src);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    // Suppression : la photo n'est plus servie, la section reste (texte seul).
    token = await c.csrf('/admin/contenus');
    expect((await c.form('/admin/contenus/photo/supprimer', { _csrf: token })).status).toBe(303);
    expect((await new Client(ctx).req(src)).status).toBe(404);
    expect(await (await new Client(ctx).req('/')).text()).not.toContain('team__photo');
  });

  it('modifie les textes du site, publiés immédiatement (cache invalidé)', async () => {
    const c = await loggedIn();
    const before = await (await new Client(ctx).req('/')).text();
    expect(before).toContain('générer des demandes,');
    const token = await c.csrf('/admin/contenus');
    const res = await c.form('/admin/contenus', {
      _csrf: token,
      'hero.titleHighlight': 'attirer des clients,',
      'services.s2Title': 'Refonte complète',
      'faq.q1Question': 'Combien de temps pour un site vitrine ?',
      'legal.companyName': 'Nexora SAS',
    });
    expect(res.status).toBe(303);
    const after = await (await new Client(ctx).req('/')).text();
    expect(after).toContain('attirer des clients,');
    expect(after).toContain('Refonte complète');
    expect(after).toContain('Combien de temps pour un site vitrine ?');
    expect(await (await new Client(ctx).req('/mentions-legales')).text()).toContain('Nexora SAS');
  });

  it('refuse un texte trop long ou un bouton vide sans rien publier ; le HTML est échappé', async () => {
    const c = await loggedIn();
    const token = await c.csrf('/admin/contenus');
    expect((await c.form('/admin/contenus', { _csrf: token, 'hero.subtitle': 'x'.repeat(400) })).status).toBe(422);
    // Lien de rendez-vous : https uniquement ; WhatsApp : format international.
    expect((await c.form('/admin/contenus', { _csrf: token, 'contact.bookingUrl': 'javascript:alert(1)' })).status).toBe(422);
    expect((await c.form('/admin/contenus', { _csrf: token, 'contact.bookingUrl': 'http://cal.com/x' })).status).toBe(422);
    expect((await c.form('/admin/contenus', { _csrf: token, 'contact.whatsappNumber': '0612345678' })).status).toBe(422);
    expect((await c.form('/admin/contenus', { _csrf: token, 'hero.primaryCta': '' })).status).toBe(422);
    expect((await c.form('/admin/contenus', { _csrf: token, 'contact.publicEmail': 'pas-un-email' })).status).toBe(422);
    expect(await (await new Client(ctx).req('/')).text()).toContain('générer des demandes,');
    // Clés héritées ignorées (pas de pollution de prototype).
    expect((await c.form('/admin/contenus', { _csrf: token, '__proto__.toString': 'x', 'hero.constructor': 'x' })).status).toBe(303);
    expect(typeof ({} as Record<string, unknown>).toString).toBe('function');
    await c.form('/admin/contenus', { _csrf: token, 'hero.subtitle': '<script>alert(1)</script>' });
    const home = await (await new Client(ctx).req('/')).text();
    expect(home).not.toContain('<script>alert(1)</script>');
    expect(home).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('demandes de contact', () => {
  it('consultation, changement de statut et suppression ; contenu échappé', async () => {
    const visitor = new Client(ctx, '198.51.100.20');
    await visitor.req('/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(contactPayload({ name: '<b>Pirate</b>', message: '<script>document.location="https://evil"</script> bonjour' })),
    });
    const [row] = await ctx.deps.db.select().from(contactRequests);
    const c = await loggedIn();
    const list = await (await c.req('/admin/demandes')).text();
    expect(list).toContain('&lt;b&gt;Pirate&lt;/b&gt;');
    expect(list).not.toContain('<b>Pirate</b>');
    const detail = await (await c.req(`/admin/demandes/${row.id}`)).text();
    expect(detail).not.toContain('<script>document.location');
    expect(detail).toContain('Notification e-mail non configurée');
    const token = await c.csrf('/admin/demandes');
    await c.form(`/admin/demandes/${row.id}/statut`, { _csrf: token, status: 'in_progress' });
    expect((await ctx.deps.db.select().from(contactRequests))[0].status).toBe('in_progress');
    expect((await c.form(`/admin/demandes/${row.id}/statut`, { _csrf: token, status: 'piraté' })).status).toBe(400);
    const filtered = await (await c.req('/admin/demandes?statut=in_progress')).text();
    expect(filtered).toContain('&lt;b&gt;Pirate&lt;/b&gt;');
    await c.form(`/admin/demandes/${row.id}/supprimer`, { _csrf: token });
    expect(await ctx.deps.db.select().from(contactRequests)).toHaveLength(0);
  });

  it('identifiants inexistants ou malformés : 404 sans détail', async () => {
    const c = await loggedIn();
    expect((await c.req('/admin/demandes/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await c.req("/admin/demandes/1' or '1'='1")).status).toBe(404);
  });
});

describe('compte', () => {
  it('changement de mot de passe : vérifie l’actuel, impose 12 caractères, ferme les autres sessions', async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    const token = await a.csrf('/admin/compte');
    expect((await a.form('/admin/compte/mot-de-passe', { _csrf: token, current: 'faux', next: 'Nouveau-Mot-De-Passe-1', confirm: 'Nouveau-Mot-De-Passe-1' })).status).toBe(422);
    expect((await a.form('/admin/compte/mot-de-passe', { _csrf: token, current: ADMIN_PASSWORD, next: 'court', confirm: 'court' })).status).toBe(422);
    const ok = await a.form('/admin/compte/mot-de-passe', { _csrf: token, current: ADMIN_PASSWORD, next: 'Nouveau-Mot-De-Passe-1', confirm: 'Nouveau-Mot-De-Passe-1' });
    expect(ok.status).toBe(303);
    expect((await a.req('/admin')).status).toBe(200);
    expect((await b.req('/admin')).status).toBe(303);
    expect((await new Client(ctx).login('admin@nexora.test', 'Nouveau-Mot-De-Passe-1')).status).toBe(303);
  });

  it('le tableau de bord signale les informations manquantes (e-mail, légal)', async () => {
    const c = await loggedIn();
    const html = await (await c.req('/admin')).text();
    expect(html).toContain('Notification e-mail non configurée');
    expect(html).toContain('Informations légales incomplètes');
  });
});
