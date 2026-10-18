// Protection de TOUTES les routes d'administration, énumérées depuis l'application réelle (pas une liste écrite à la
// main) : une route enregistrée avant la session ou le contrôle CSRF dans routes/admin.tsx répondrait sans eux.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createAdmin, setup, type TestCtx } from '../helpers';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setup();
  await createAdmin(ctx);
});
afterEach(async () => ctx.close());

const ID = '00000000-0000-4000-8000-000000000000';

function protectedPaths(method: 'GET' | 'POST') {
  const paths = ctx.app.routes
    .filter((r) => r.method === method && r.path.startsWith('/admin') && r.path !== '/admin/connexion' && !r.path.includes('*'))
    .map((r) => r.path.replace(/:\w+/g, ID));
  return [...new Set(paths)];
}

describe('routes d’administration énumérées', () => {
  it('chaque page redirige vers la connexion sans session', async () => {
    const paths = protectedPaths('GET');
    expect(paths.length).toBeGreaterThanOrEqual(7);
    const c = new Client(ctx);
    for (const p of paths) {
      const res = await c.req(p);
      expect(res.status, p).toBe(303);
      expect(res.headers.get('location'), p).toMatch(/^\/admin\/connexion/);
    }
  });

  it('chaque action est refusée sans session (401)', async () => {
    const paths = protectedPaths('POST');
    expect(paths.length).toBeGreaterThanOrEqual(17);
    const c = new Client(ctx);
    for (const p of paths) expect((await c.form(p, { _csrf: 'x' })).status, p).toBe(401);
  });

  it('chaque action est refusée sans jeton CSRF (403), même connecté', async () => {
    const c = new Client(ctx);
    expect((await c.login()).status).toBe(303);
    for (const p of protectedPaths('POST')) expect((await c.form(p, {})).status, p).toBe(403);
    // La session est toujours valide : la déconnexion sans jeton a bien été refusée.
    expect((await c.req('/admin')).status).toBe(200);
  });
});
