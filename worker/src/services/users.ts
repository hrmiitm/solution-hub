import type { GoogleIdentity } from '../auth/google.ts';
import { newId, nowIso, slugify } from '../lib/util.ts';
import { notFound } from '../lib/errors.ts';
import { visibleSql, type Viewer } from './access.ts';

export interface UserRow {
  id: string;
  google_id: string | null;
  username: string;
  name: string;
  email: string;
  avatar_url: string | null;
  org_domain: string | null;
  created_at: string;
  updated_at: string;
}

/** Public profile shape. Never includes email or internal ids. */
export interface PublicUser {
  username: string;
  name: string;
  avatarUrl: string | null;
}

export const toPublicUser = (u: Pick<UserRow, 'username' | 'name' | 'avatar_url'>): PublicUser => ({
  username: u.username,
  name: u.name,
  avatarUrl: u.avatar_url,
});

/** First path segments the web app uses for its own routes. */
export const RESERVED_USERNAMES = new Set([
  'api', 'new', 'explore', 'mcp', 'oauth', 'login', 'logout', 'signin', 'signup', 'settings', 'admin',
  'assets', 'canvaskit', 'icons', 'about', 'help', 'search', 'profile', 'me', 'users', 'solutions',
]);

export function baseUsername(identity: Pick<GoogleIdentity, 'email' | 'name'>): string {
  const local = identity.email.split('@')[0] ?? '';
  let base = slugify(local || identity.name, 30);
  if (base.length < 2) base = `user-${base}`.replace(/-$/, '');
  if (base.length < 2) base = 'user';
  return base;
}

async function availableUsername(db: D1Database, base: string): Promise<string> {
  const taken = await db
    .prepare(`SELECT username FROM users WHERE substr(username, 1, length(?1)) = ?1`)
    .bind(base)
    .all<{ username: string }>();
  const names = new Set(taken.results.map((r) => r.username));
  if (!names.has(base) && !RESERVED_USERNAMES.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Creates or refreshes the user for a verified Google identity (keyed by `sub`). */
export async function upsertGoogleUser(db: D1Database, identity: GoogleIdentity): Promise<UserRow> {
  const now = nowIso();
  const existing = await db.prepare(`SELECT * FROM users WHERE google_id = ?1`).bind(identity.sub).first<UserRow>();
  if (existing) {
    await db
      .prepare(`UPDATE users SET name = ?2, email = ?3, avatar_url = ?4, org_domain = ?5, updated_at = ?6 WHERE id = ?1`)
      .bind(existing.id, identity.name, identity.email, identity.picture, identity.hd, now)
      .run();
    return { ...existing, name: identity.name, email: identity.email, avatar_url: identity.picture, org_domain: identity.hd, updated_at: now };
  }
  // Seeded accounts (see scripts/import.mjs) have a verified-email identity but no Google subject yet.
  // The first sign-in whose *verified* email (and, for Workspace accounts, `hd` domain) matches takes
  // that account over, so the seeded profile and solutions simply belong to the person who signs in.
  // No `sub` is ever invented and no special privileges are granted.
  const claimable = await db
    .prepare(
      `SELECT * FROM users WHERE google_id IS NULL AND email <> '' AND lower(email) = lower(?1)
         AND (org_domain IS NULL OR org_domain = ?2)`,
    )
    .bind(identity.email, identity.hd ?? '')
    .first<UserRow>();
  if (claimable) {
    const claimed = await db
      .prepare(
        `UPDATE users SET google_id = ?2, name = ?3, email = ?4, avatar_url = ?5, org_domain = ?6, updated_at = ?7
         WHERE id = ?1 AND google_id IS NULL`,
      )
      .bind(claimable.id, identity.sub, identity.name, identity.email, identity.picture, identity.hd, now)
      .run();
    if (claimed.meta.changes > 0) {
      return { ...claimable, google_id: identity.sub, name: identity.name, email: identity.email, avatar_url: identity.picture, org_domain: identity.hd, updated_at: now };
    }
    const raced = await db.prepare(`SELECT * FROM users WHERE google_id = ?1`).bind(identity.sub).first<UserRow>();
    if (raced) return raced;
  }
  // Retry on the (rare) race where two sign-ins pick the same username.
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = await availableUsername(db, baseUsername(identity));
    const row: UserRow = {
      id: newId(),
      google_id: identity.sub,
      username,
      name: identity.name,
      email: identity.email,
      avatar_url: identity.picture,
      org_domain: identity.hd,
      created_at: now,
      updated_at: now,
    };
    try {
      await db
        .prepare(
          `INSERT INTO users (id, google_id, username, name, email, avatar_url, org_domain, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(row.id, row.google_id, row.username, row.name, row.email, row.avatar_url, row.org_domain, now, now)
        .run();
      return row;
    } catch (err) {
      if (!String(err).includes('UNIQUE')) throw err;
      const again = await db.prepare(`SELECT * FROM users WHERE google_id = ?1`).bind(identity.sub).first<UserRow>();
      if (again) return again;
    }
  }
  throw new Error('Could not allocate a username');
}

export async function getUserByUsername(db: D1Database, username: string): Promise<UserRow> {
  const user = await db.prepare(`SELECT * FROM users WHERE username = ?1`).bind(username.toLowerCase()).first<UserRow>();
  if (!user) throw notFound('User');
  return user;
}

/** Profile with solution counts, counting only solutions the viewer may see. */
export async function getProfile(db: D1Database, viewer: Viewer, username: string) {
  const user = await getUserByUsername(db, username);
  const binds: unknown[] = [user.id];
  const bind = (v: unknown) => `?${binds.push(v)}`;
  const counts = await db
    .prepare(
      `SELECT
         COALESCE(SUM(s.status = 'ongoing'), 0) AS ongoing,
         COALESCE(SUM(s.status = 'completed'), 0) AS completed,
         COALESCE(SUM(s.visibility = 'private'), 0) AS private
       FROM solutions s JOIN users u ON u.id = s.owner_id
       WHERE s.owner_id = ?1 AND ${visibleSql(viewer, bind)}`,
    )
    .bind(...binds)
    .first<{ ongoing: number; completed: number; private: number }>();
  const isSelf = user.id === viewer?.userId;
  return {
    ...toPublicUser(user),
    joinedAt: user.created_at,
    isSelf,
    counts: {
      ongoing: counts?.ongoing ?? 0,
      completed: counts?.completed ?? 0,
      total: (counts?.ongoing ?? 0) + (counts?.completed ?? 0),
      private: isSelf ? (counts?.private ?? 0) : 0,
    },
  };
}
