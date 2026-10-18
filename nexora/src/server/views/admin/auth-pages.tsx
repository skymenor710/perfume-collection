import type { Assets } from '../../lib/assets';
import type { Base } from './base';
import { Field } from './field';
import { AdminDocument, AdminShell, Csrf } from './layout';

/* ---------------------------------------------------------------- Connexion */
export const LoginPage = ({ assets, preToken, error, email, next }: { assets: Assets; preToken: string; error?: string; email?: string; next?: string }) => (
  <AdminDocument title="Connexion" assets={assets} bodyClass="admin admin--login">
    <main class="login" id="contenu">
      <div class="login__card">
        <img class="login__logo" src="/brand/symbol-96.webp" srcset="/brand/symbol-192.webp 2x" width="46" height="48" alt="" />
        <img class="login__wordmark" src="/brand/wordmark.svg" width="133" height="22" alt="Nexora" />
        <h1>Administration</h1>
        {error ? (
          <div class="flash flash--error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        <form method="post" action="/admin/connexion" class="form">
          <input type="hidden" name="_pre" value={preToken} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div class="field">
            <label for="email">Adresse e-mail</label>
            <input id="email" name="email" type="email" autocomplete="username" required maxlength={160} value={email ?? ''} autofocus />
          </div>
          <div class="field">
            <label for="password">Mot de passe</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required maxlength={256} />
          </div>
          <button class="btn btn--primary btn--block" type="submit">
            Se connecter
          </button>
        </form>
        <p class="login__hint">Accès réservé. Aucun compte ne peut être créé depuis cette page.</p>
      </div>
    </main>
  </AdminDocument>
);

/* ---------------------------------------------------------------- Compte */
export const AccountPage = ({
  session,
  assets,
  flash,
  newRequests,
  errors,
  config,
}: Base & {
  errors?: Record<string, string>;
  config: { mail: { configured: boolean; provider: string; missing: string[] }; storage: string; database: string };
}) => (
  <AdminShell title="Compte et configuration" section="account" session={session} assets={assets} flash={flash} newRequests={newRequests}>
    <div class="grid-2">
      <section class="panel" aria-labelledby="pw-title">
        <h2 id="pw-title">Changer le mot de passe</h2>
        <form method="post" action="/admin/compte/mot-de-passe" class="form" novalidate>
          <Csrf token={session.csrfToken} />
          <input type="text" name="username" value={session.email} autocomplete="username" hidden />
          <Field label="Mot de passe actuel" name="current" type="password" value="" required max={256} error={errors?.current} autocomplete="current-password" />
          <Field label="Nouveau mot de passe" name="next" type="password" value="" required max={256} error={errors?.next} hint="12 caractères minimum." autocomplete="new-password" />
          <Field label="Confirmer le nouveau mot de passe" name="confirm" type="password" value="" required max={256} error={errors?.confirm} autocomplete="new-password" />
          <button class="btn btn--primary" type="submit">
            Mettre à jour
          </button>
          <p class="muted small">Les autres sessions ouvertes seront déconnectées.</p>
        </form>
      </section>
      <section class="panel" aria-labelledby="cfg-title">
        <h2 id="cfg-title">Configuration du serveur</h2>
        <dl class="dl">
          <dt>Notification e-mail</dt>
          <dd>
            {config.mail.configured ? (
              <span class="tag tag--ok">Active ({config.mail.provider})</span>
            ) : (
              <>
                <span class="tag tag--draft">Non configurée</span>
                <span class="muted small block">Variables manquantes : {config.mail.missing.join(', ')}</span>
              </>
            )}
          </dd>
          <dt>Stockage des images</dt>
          <dd>{config.storage}</dd>
          <dt>Base de données</dt>
          <dd>{config.database}</dd>
        </dl>
        <p class="muted small">Ces réglages se modifient dans les variables d’environnement du serveur (voir README), jamais depuis le navigateur.</p>
      </section>
    </div>
  </AdminShell>
);

export const AdminErrorPage = ({ assets, title, message }: { assets: Assets; title: string; message: string }) => (
  <AdminDocument title={title} assets={assets} bodyClass="admin admin--login">
    <main class="login" id="contenu">
      <div class="login__card">
        <h1>{title}</h1>
        <p>{message}</p>
        <a class="btn btn--primary btn--block" href="/admin">
          Retour à l’administration
        </a>
      </div>
    </main>
  </AdminDocument>
);
