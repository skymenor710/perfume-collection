// Crée un compte administrateur, ou réinitialise son mot de passe (--reset).
//   npm run admin:create -- --email vous@exemple.fr
//   npm run admin:create -- --email vous@exemple.fr --reset
// Le mot de passe est demandé de façon masquée (jamais en argument : il resterait dans l'historique du shell).
// Sans terminal interactif (CI, conteneur), il est lu sur l'entrée standard : echo "$PASS" | npm run admin:create -- --email …
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bootstrap } from '../src/server/bootstrap';
import { admins, sessions } from '../src/server/db/schema';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from '../src/server/lib/crypto';

const args = process.argv.slice(2);
const emailArg = args[args.indexOf('--email') + 1];
const reset = args.includes('--reset');
const email = z.string().trim().toLowerCase().email().safeParse(args.includes('--email') ? emailArg : '');
if (!email.success) {
  console.error('Usage : npm run admin:create -- --email vous@exemple.fr [--reset]');
  process.exit(1);
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = await readHidden('Mot de passe (12 caractères minimum) : ');
if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
  console.error(`Mot de passe refusé : ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`);
  process.exit(1);
}
if (process.stdin.isTTY) {
  const confirm = await readHidden('Confirmez le mot de passe : ');
  if (confirm !== password) {
    console.error('Les deux saisies ne correspondent pas.');
    process.exit(1);
  }
}

const rt = await bootstrap({ migrate: true });
const db = rt.deps.db;
const existing = await db.select().from(admins).where(eq(admins.email, email.data)).limit(1);
const hash = await hashPassword(password);
if (existing[0]) {
  if (!reset) {
    console.error('Ce compte existe déjà. Ajoutez --reset pour changer son mot de passe.');
    await rt.close();
    process.exit(1);
  }
  await db.update(admins).set({ passwordHash: hash, passwordChangedAt: new Date() }).where(eq(admins.id, existing[0].id));
  await db.delete(sessions).where(eq(sessions.adminId, existing[0].id));
  console.log('Mot de passe réinitialisé ; toutes les sessions de ce compte ont été fermées.');
} else {
  await db.insert(admins).values({ email: email.data, passwordHash: hash });
  console.log(`Administrateur créé : ${email.data}`);
}
await rt.close();
