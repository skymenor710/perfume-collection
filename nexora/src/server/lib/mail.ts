import type { Config } from '../config';

/**
 * Notification e-mail d'une nouvelle demande de contact, via un fournisseur HTTP configurable.
 *   resend : https://resend.com   (MAIL_API_KEY = clé API)
 *   brevo  : https://brevo.com    (fournisseur français ; MAIL_API_KEY = clé API v3)
 * Sans configuration, rien n'est envoyé (et rien n'est simulé) : la demande reste enregistrée en base et l'admin
 * affiche l'absence de configuration.
 */
export interface MailMessage {
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  configured: boolean;
  send(msg: MailMessage): Promise<void>;
}

export class MailNotConfigured extends Error {}

export function createMailer(mail: Config['mail'], fetchImpl: typeof fetch = fetch): Mailer {
  if (!mail.configured) {
    return {
      configured: false,
      async send() {
        throw new MailNotConfigured(`Notification e-mail non configurée (${mail.missing.join(', ')}).`);
      },
    };
  }
  const recipients = mail.to!.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    configured: true,
    async send(msg) {
      const signal = AbortSignal.timeout(10_000);
      let res: Response;
      if (mail.provider === 'resend') {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          signal,
          headers: { authorization: `Bearer ${mail.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: mail.from, to: recipients, subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
        });
      } else {
        const sender = parseAddress(mail.from!);
        res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          signal,
          headers: { 'api-key': mail.apiKey!, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender,
            to: recipients.map((email) => ({ email })),
            subject: msg.subject,
            textContent: msg.text,
            ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
          }),
        });
      }
      if (!res.ok) throw new Error(`Fournisseur e-mail : HTTP ${res.status}${await providerCode(res)}`);
    },
  };
}

function parseAddress(value: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: value.trim() };
}

/** Code d'erreur court renvoyé par le fournisseur (ex. « unauthorized ») pour le diagnostic dans l'admin. */
async function providerCode(res: Response) {
  try {
    const body = (await res.json()) as { code?: unknown; name?: unknown };
    const code = typeof body.code === 'string' ? body.code : typeof body.name === 'string' ? body.name : '';
    return /^[\w.-]{1,60}$/.test(code) ? ` (${code})` : '';
  } catch {
    return '';
  }
}
