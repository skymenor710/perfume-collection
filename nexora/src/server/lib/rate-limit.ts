import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';

/**
 * Limitation de débit à fenêtre fixe, stockée dans PostgreSQL (fonctionne avec plusieurs instances).
 * Les clés ne contiennent jamais d'IP ni d'e-mail en clair : l'appelant passe une empreinte HMAC.
 */
export interface RateResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

export async function hit(db: Db, key: string, limit: number, windowSec: number): Promise<RateResult> {
  const rows = await db.execute<{ count: number; window_start: string | Date }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count, window_start`);
  const row = (rows as unknown as { rows?: { count: number; window_start: string | Date }[] }).rows?.[0] ??
    (rows as unknown as { count: number; window_start: string | Date }[])[0];
  const count = Number(row.count);
  const start = new Date(row.window_start).getTime();
  const retryAfterSec = Math.max(1, Math.ceil((start + windowSec * 1000 - Date.now()) / 1000));
  return { allowed: count <= limit, count, retryAfterSec };
}

/** Lecture sans incrément (ex. : verrouillage d'un compte après N échecs). */
export async function peek(db: Db, key: string, windowSec: number): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count from rate_limits where key = ${key} and window_start >= now() - make_interval(secs => ${windowSec})`);
  const list = (rows as unknown as { rows?: { count: number }[] }).rows ?? (rows as unknown as { count: number }[]);
  return list.length ? Number(list[0].count) : 0;
}

export async function reset(db: Db, key: string) {
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}

export async function purgeOld(db: Db) {
  await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}
