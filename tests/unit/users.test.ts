import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { GoogleIdentity } from '../../worker/src/auth/google.ts';
import { getProfile, upsertGoogleUser } from '../../worker/src/services/users.ts';

/** Minimal D1 stand-in over node:sqlite, running the real migrations in order. */
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'migrations');
  for (const f of readdirSync(dir).sort()) sqlite.exec(readFileSync(join(dir, f), 'utf8'));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...p: unknown[]) => ((params = p), stmt),
      first: async () => (sqlite.prepare(sql).get(...(params as never[])) as never) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])) }),
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(params as never[])).changes) } }),
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, sqlite };
}

const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: 'sub-1', email: 'Jane.Doe@acme.test', name: 'Jane Doe', picture: 'https://lh3.googleusercontent.com/a/jane', hd: 'acme.test', ...over,
});

test('first Google sign-in populates name, email, picture and organization, with a unique profile URL', async () => {
  const { db } = makeDb();
  const u = await upsertGoogleUser(db, identity());
  assert.equal(u.name, 'Jane Doe');
  assert.equal(u.email, 'Jane.Doe@acme.test');
  assert.equal(u.avatar_url, 'https://lh3.googleusercontent.com/a/jane');
  assert.equal(u.org_domain, 'acme.test');
  assert.equal(u.username, 'jane-doe');
  const profile = await getProfile(db, null, 'jane-doe');
  assert.deepEqual([profile.username, profile.name, profile.avatarUrl], ['jane-doe', 'Jane Doe', 'https://lh3.googleusercontent.com/a/jane']);
  assert.ok(!('email' in profile), 'the public profile never includes the email');
});

test('later sign-ins refresh name, email and picture on the same account', async () => {
  const { db } = makeDb();
  const first = await upsertGoogleUser(db, identity());
  const again = await upsertGoogleUser(db, identity({ name: 'Jane D. Doe', picture: 'https://lh3.googleusercontent.com/a/new', hd: null }));
  assert.equal(again.id, first.id);
  assert.equal(again.username, first.username, 'the shareable URL stays stable');
  assert.equal(again.name, 'Jane D. Doe');
  assert.equal(again.avatar_url, 'https://lh3.googleusercontent.com/a/new');
  assert.equal(again.org_domain, null, 'organization follows the verified hd claim');
});

test('usernames are unique and never collide with app routes', async () => {
  const { db } = makeDb();
  const a = await upsertGoogleUser(db, identity({ sub: 'a', email: 'sam@one.test', hd: null }));
  const b = await upsertGoogleUser(db, identity({ sub: 'b', email: 'sam@two.test', hd: null }));
  const c = await upsertGoogleUser(db, identity({ sub: 'c', email: 'explore@three.test', hd: null }));
  assert.equal(a.username, 'sam');
  assert.notEqual(b.username, a.username);
  assert.notEqual(c.username, 'explore');
});

test('a seeded account is taken over by the first sign-in with the same verified email and domain', async () => {
  const { db, sqlite } = makeDb();
  sqlite.exec(`INSERT INTO users (id, google_id, username, name, email, org_domain, created_at, updated_at)
    VALUES ('seed-1', NULL, 'sanand0', 'S. Anand', 's.anand@straive.test', 'straive.test', 'x', 'x')`);
  sqlite.exec(`INSERT INTO solutions (id, owner_id, title, slug, description_md, visibility, created_at, updated_at)
    VALUES ('sol-1', 'seed-1', 'T', 't', 'd', 'public', 'x', 'x')`);
  const u = await upsertGoogleUser(db, identity({ sub: 'g-anand', email: 'S.Anand@straive.test', name: 'S Anand', hd: 'straive.test' }));
  assert.equal(u.id, 'seed-1');
  assert.equal(u.username, 'sanand0');
  assert.equal(u.google_id, 'g-anand');
  assert.equal(u.name, 'S Anand');
  assert.equal(u.avatar_url, 'https://lh3.googleusercontent.com/a/jane');
  assert.equal(sqlite.prepare(`SELECT owner_id FROM solutions WHERE id = 'sol-1'`).get()!.owner_id, 'seed-1');
  // A repeat sign-in is the ordinary path; nothing is duplicated.
  assert.equal((await upsertGoogleUser(db, identity({ sub: 'g-anand', email: 's.anand@straive.test', hd: 'straive.test' }))).id, 'seed-1');
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM users`).get()!.n, 1);
});

test('a seeded account is not taken over without the matching organization domain', async () => {
  const { db, sqlite } = makeDb();
  sqlite.exec(`INSERT INTO users (id, google_id, username, name, email, org_domain, created_at, updated_at)
    VALUES ('seed-1', NULL, 'sanand0', 'S. Anand', 's.anand@straive.test', 'straive.test', 'x', 'x')`);
  for (const hd of [null, 'evil.test']) {
    const u = await upsertGoogleUser(db, identity({ sub: `g-${hd}`, email: 's.anand@straive.test', hd }));
    assert.notEqual(u.id, 'seed-1', `hd=${hd}`);
  }
  assert.equal(sqlite.prepare(`SELECT google_id FROM users WHERE id = 'seed-1'`).get()!.google_id, null);
});

test('a user without an email on file can never be claimed, and each account is claimed once', async () => {
  const { db, sqlite } = makeDb();
  sqlite.exec(`INSERT INTO users (id, google_id, username, name, email, org_domain, created_at, updated_at)
    VALUES ('no-email', NULL, 'fiction', 'Fiction', '', NULL, 'x', 'x'), ('seed-2', NULL, 'hritik', 'Hritik', 'h@ds.test', 'ds.test', 'x', 'x')`);
  assert.notEqual((await upsertGoogleUser(db, identity({ sub: 'g1', email: '', hd: null }))).id, 'no-email');
  const first = await upsertGoogleUser(db, identity({ sub: 'g2', email: 'h@ds.test', hd: 'ds.test' }));
  const second = await upsertGoogleUser(db, identity({ sub: 'g3', email: 'h@ds.test', hd: 'ds.test' }));
  assert.equal(first.id, 'seed-2');
  assert.notEqual(second.id, 'seed-2', 'a second Google account cannot take over an already claimed account');
});
