import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Deps } from '../context';
import { contactRequests } from '../db/schema';

type ContactRequest = typeof contactRequests.$inferSelect;
export const NOT_CONFIGURED = 'Notification e-mail non configurée';
const SENDING = 'Envoi en cours';

/**
 * Notification e-mail d'une demande DÉJÀ enregistrée : un échec d'envoi n'annule jamais la demande. Le résultat est
 * noté sur la demande (date d'envoi, ou erreur affichée dans l'admin et reprise par retryNotifications).
 */
export async function notifyRequest(deps: Deps, row: ContactRequest): Promise<boolean> {
  const { db, config } = deps;
  if (!deps.mailer.configured) {
    await db.update(contactRequests).set({ notifyError: NOT_CONFIGURED }).where(eq(contactRequests.id, row.id));
    return false;
  }
  try {
    await deps.mailer.send({
      subject: `Nouvelle demande de contact — ${row.projectType}`,
      replyTo: row.email,
      text: [
        'Nouvelle demande reçue sur le site Nexora.',
        '',
        `Nom : ${row.name}`,
        `Entreprise : ${row.company || '—'}`,
        `E-mail : ${row.email}`,
        `Téléphone : ${row.phone || '—'}`,
        `Type de projet : ${row.projectType}`,
        `Budget estimatif : ${row.budget || '—'}`,
        `Délai souhaité : ${row.timeline || '—'}`,
        '',
        row.message,
        '',
        `Consulter dans l'administration : ${config.publicUrl}/admin/demandes/${row.id}`,
      ].join('\n'),
    });
    await db.update(contactRequests).set({ notifiedAt: new Date(), notifyError: null }).where(eq(contactRequests.id, row.id));
    return true;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    deps.log.warn({ requestId: row.id, error: msg }, 'contact: notification e-mail non envoyée');
    await db.update(contactRequests).set({ notifyError: msg }).where(eq(contactRequests.id, row.id));
    return false;
  }
}

/**
 * Nouvel essai (tâche horaire) des notifications non envoyées des dernières 24 h : panne passagère du fournisseur,
 * ou e-mail configuré après coup. Plus anciennes d'abord, au plus `limit` envois et ~20 s par passage (la fonction
 * planifiée est courte). Chaque demande est réservée avant l'envoi : deux passages simultanés (plusieurs serveurs)
 * n'envoient pas deux fois le même e-mail.
 */
export async function retryNotifications(deps: Deps, limit = 10, budgetMs = 20_000): Promise<number> {
  if (!deps.mailer.configured) return 0;
  const deadline = Date.now() + budgetMs;
  const pending = await deps.db
    .select()
    .from(contactRequests)
    .where(and(isNull(contactRequests.notifiedAt), isNotNull(contactRequests.notifyError), gt(contactRequests.createdAt, sql`now() - interval '24 hours'`)))
    .orderBy(asc(contactRequests.createdAt))
    .limit(limit);
  let sent = 0;
  for (const row of pending) {
    if (Date.now() > deadline) break;
    const claimed = await deps.db
      .update(contactRequests)
      .set({ notifyError: SENDING })
      .where(and(eq(contactRequests.id, row.id), isNull(contactRequests.notifiedAt), eq(contactRequests.notifyError, row.notifyError ?? '')))
      .returning({ id: contactRequests.id });
    if (claimed.length && (await notifyRequest(deps, row))) sent++;
  }
  return sent;
}
