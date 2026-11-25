import type { Actor } from '../env.ts';
import { nowIso, randomToken, sha256Hex } from '../lib/util.ts';

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export type SessionClient = 'web' | 'native';

/** Creates a session and returns the opaque bearer token (only its hash is stored). */
export async function createSession(db: D1Database, userId: string, client: SessionClient): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.batch([
    // Opportunistic cleanup keeps the table small without a cron job.
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(new Date(now).toISOString()),
    db
      .prepare(`INSERT INTO sessions (id, user_id, client, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(await sha256Hex(token), userId, client, new Date(now).toISOString(), expiresAt),
  ]);
  return { token, expiresAt };
}

export async function resolveSession(db: D1Database, token: string): Promise<Actor | null> {
  if (!token || token.length > 128) return null;
  const row = await db
    .prepare(
      `SELECT s.user_id, u.username, u.org_domain
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?1 AND s.expires_at > ?2`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<{ user_id: string; username: string; org_domain: string | null }>();
  if (!row) return null;
  return { userId: row.user_id, username: row.username, orgDomain: row.org_domain };
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(await sha256Hex(token)).run();
}
