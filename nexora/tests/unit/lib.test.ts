import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSafeKey, createStorage } from '../../src/server/lib/storage';
import { hashPassword, verifyPassword } from '../../src/server/lib/crypto';
import { checkFormToken, issueFormToken } from '../../src/server/lib/contact';
import { sniffImageType } from '../../src/server/lib/images';
import { createMailer } from '../../src/server/lib/mail';
import { contentSchema, defaultContent, displayContent, frTypo, mergeContent } from '../../src/server/lib/content';
import { serverlessProblems } from '../../src/server/serverless';
import { createLogger } from '../../src/server/log';

describe('stockage', () => {
  it('refuse les clés dangereuses (traversée de répertoire)', () => {
    for (const k of ['../etc/passwd', 'projects/../../x', '/abs', 'a//b', 'A-MAJ', '']) expect(() => assertSafeKey(k), k).toThrow();
    expect(() => assertSafeKey('projects/1f/2a/480.webp')).not.toThrow();
  });
  it('local : écriture atomique, lecture, liste et suppression par préfixe', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nx-st-'));
    const s = createStorage({ driver: 'local', dir });
    await s.put('projects/p1/i1/480.webp', Buffer.from('a'), 'image/webp');
    await s.put('projects/p1/i1/800.webp', Buffer.from('b'), 'image/webp');
    expect((await s.get('projects/p1/i1/480.webp'))?.toString()).toBe('a');
    expect(await s.get('projects/p1/i1/none.webp')).toBeNull();
    expect(await s.list('projects/')).toEqual(['projects/p1/i1/480.webp', 'projects/p1/i1/800.webp']);
    await s.deletePrefix('projects/p1/i1');
    expect(await s.list('projects/')).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('mots de passe', () => {
  it('scrypt salé : deux hachages différents, vérification correcte', async () => {
    const a = await hashPassword('mot de passe très long');
    const b = await hashPassword('mot de passe très long');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('mot de passe très long', a)).toBe(true);
    expect(await verifyPassword('mot de passe tres long', a)).toBe(false);
    expect(await verifyPassword('x', 'format-invalide')).toBe(false);
  });
});

describe('jeton du formulaire', () => {
  it('signé, horodaté, refuse les envois trop rapides et les faux', () => {
    const now = Date.now();
    expect(checkFormToken('s'.repeat(32), issueFormToken('s'.repeat(32), now - 10_000), now)).toBe('ok');
    expect(checkFormToken('s'.repeat(32), issueFormToken('s'.repeat(32), now - 500), now)).toBe('too-fast');
    expect(checkFormToken('s'.repeat(32), issueFormToken('s'.repeat(32), now - 49 * 3600_000), now)).toBe('expired');
    expect(checkFormToken('s'.repeat(32), issueFormToken('s'.repeat(32), now - 47 * 3600_000), now)).toBe('ok');
    expect(checkFormToken('s'.repeat(32), issueFormToken('autre'.repeat(8), now - 10_000), now)).toBe('invalid');
    expect(checkFormToken('s'.repeat(32), undefined, now)).toBe('missing');
    expect(checkFormToken('s'.repeat(32), 'abc.def', now)).toBe('invalid');
  });
});

describe('images', () => {
  it('reconnaît les formats par leur contenu, pas par l’extension', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]))).toBe('jpeg');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a................'))).toBeNull();
  });
});

describe('e-mail', () => {
  it('sans configuration : aucun envoi simulé, erreur explicite', async () => {
    const m = createMailer({ provider: 'none', configured: false, missing: ['MAIL_PROVIDER'] });
    expect(m.configured).toBe(false);
    await expect(m.send({ subject: 's', text: 't' })).rejects.toThrow(/non configurée/);
  });
  it('Brevo / Resend : requête au bon point d’accès, clé dans l’en-tête', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    const brevo = createMailer({ provider: 'brevo', apiKey: 'k1', from: 'Nexora <site@nexora.fr>', to: 'a@nexora.fr, b@nexora.fr', configured: true, missing: [] }, fake);
    await brevo.send({ subject: 'Sujet', text: 'Texte', replyTo: 'client@example.fr' });
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0].init.headers as Record<string, string>)['api-key']).toBe('k1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sender).toEqual({ name: 'Nexora', email: 'site@nexora.fr' });
    expect(body.to).toHaveLength(2);
    const resend = createMailer({ provider: 'resend', apiKey: 'k2', from: 'site@nexora.fr', to: 'a@nexora.fr', configured: true, missing: [] }, fake);
    await resend.send({ subject: 'Sujet', text: 'Texte' });
    expect(calls[1].url).toBe('https://api.resend.com/emails');
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer k2');
  });
  it('échec du fournisseur : erreur remontée (la demande reste enregistrée par l’appelant)', async () => {
    const fake = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const m = createMailer({ provider: 'resend', apiKey: 'k', from: 'a@b.fr', to: 'c@d.fr', configured: true, missing: [] }, fake);
    await expect(m.send({ subject: 's', text: 't' })).rejects.toThrow('HTTP 401');
  });
});

describe('contenus', () => {
  it('valeurs par défaut valides ; fusion tolérante des anciennes valeurs', () => {
    expect(contentSchema.safeParse(defaultContent).success).toBe(true);
    const merged = mergeContent({ hero: { titleHighlight: 'autre', inconnu: 'x' }, pirate: { a: 1 } });
    expect(merged.hero.titleHighlight).toBe('autre');
    expect(merged.hero.titleBefore).toBe(defaultContent.hero.titleBefore);
    expect(mergeContent({ hero: { ctaQuote: '' } })).toEqual(defaultContent);
  });

  it('typographie française à l’affichage : espaces insécables, liens et adresses intacts', () => {
    expect(frTypo('Une question ? Oui ! Voici : « ceci » ; fin')).toBe('Une question\u202F? Oui\u202F! Voici\u00A0: «\u00A0ceci\u00A0»\u202F; fin');
    expect(frTypo('https://cal.com/nexora')).toBe('https://cal.com/nexora');
    const shown = displayContent({ ...defaultContent, contact: { ...defaultContent.contact, bookingUrl: 'https://cal.com/x', text: 'Écrivez-nous : merci' } });
    expect(shown.contact.text).toBe('Écrivez-nous\u00A0: merci');
    expect(shown.contact.bookingUrl).toBe('https://cal.com/x');
    expect(shown.faq.q1Question.endsWith('\u202F?')).toBe(true);
  });
});

describe('serverless (Netlify)', () => {
  it('refuse les réglages non persistants ou contournables', () => {
    const secret = { SESSION_SECRET: 's'.repeat(48) };
    expect(serverlessProblems({ ...secret, DATABASE_URL: 'pglite:./data/db', STORAGE_DRIVER: 'local' })).toHaveLength(2);
    expect(serverlessProblems({})).toHaveLength(3);
    expect(serverlessProblems({ ...secret, DATABASE_URL: 'postgres://u:p@h/db', STORAGE_DRIVER: 's3', TRUST_PROXY: 'true' })).toHaveLength(1);
    // Secret absent ou trop court : chaque instance aurait le sien.
    expect(serverlessProblems({ SESSION_SECRET: 'court', DATABASE_URL: 'postgres://u:p@h/db', STORAGE_DRIVER: 's3' })).toHaveLength(1);
    expect(serverlessProblems({ ...secret, DATABASE_URL: 'postgresql://u:p@h/db?sslmode=require', STORAGE_DRIVER: 's3' })).toEqual([]);
  });
});

describe('journal', () => {
  it('masque mots de passe, jetons, cookies et e-mails', () => {
    const lines: string[] = [];
    const log = createLogger('info', { write: (chunk: string) => void lines.push(chunk) });
    log.info({ password: 'secret1', token: 'tok', email: 'x@y.fr', headers: { cookie: 'nx_session=abc' } }, 'test');
    const out = lines.join('');
    expect(out).toContain('[masqué]');
    expect(out).not.toContain('secret1');
    expect(out).not.toContain('tok"');
    expect(out).not.toContain('x@y.fr');
    expect(out).not.toContain('nx_session=abc');
  });
});
