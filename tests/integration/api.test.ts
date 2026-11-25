/**
 * End-to-end API tests against a running local server (`wrangler pages dev`
 * on BASE_URL, default http://127.0.0.1:8788) with a migrated local D1.
 * Run via scripts/test-integration.sh, which starts and stops the server.
 *
 * Test users get sessions by inserting hashed tokens directly into the local
 * database: there is no authentication bypass in application code.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8788';
// D1_TARGET=remote runs the suite against a deployed app (post-deploy check);
// the temporary test users and everything they own are deleted afterwards.
const D1_FLAG = process.env.D1_TARGET === 'remote' ? '--remote' : '--local';
const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker');
const run = randomBytes(3).toString('hex');

interface TestUser {
  id: string;
  username: string;
  token: string;
  org: string | null;
}

const ORG = `acme-${run}.test`;
function makeUser(name: string, org: string | null): TestUser {
  return { id: randomUUID(), username: `t-${name}-${run}`, token: randomBytes(32).toString('base64url'), org };
}
const alice = makeUser('alice', ORG); // Workspace account
const carol = makeUser('carol', ORG); // same organization as alice
const dave = makeUser('dave', `other-${run}.test`); // different organization
const bob = makeUser('bob', null); // personal account
const testUsers = [alice, bob, carol, dave];

before(() => {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const sql = testUsers
    .flatMap((u) => [
      `INSERT INTO users (id, google_id, username, name, email, avatar_url, org_domain, created_at, updated_at) VALUES ('${u.id}', NULL, '${u.username}', 'Test ${u.username}', '${u.username}@example.test', NULL, ${u.org ? `'${u.org}'` : 'NULL'}, '${now}', '${now}');`,
      `INSERT INTO sessions (id, user_id, client, created_at, expires_at) VALUES ('${createHash('sha256').update(u.token).digest('hex')}', '${u.id}', 'native', '${now}', '${later}');`,
    ])
    .join('\n');
  d1(sql);
});

after(() => {
  // ON DELETE CASCADE removes their sessions, solutions and history.
  d1(`DELETE FROM users WHERE id IN (${testUsers.map((u) => `'${u.id}'`).join(', ')});`);
});

function d1(sql: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'sh-test-')), 'q.sql');
  writeFileSync(file, sql);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'solutionhub', D1_FLAG, `--file=${file}`], { cwd: workerDir, stdio: 'ignore' });
}

async function api(user: TestUser | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(user ? { authorization: `Bearer ${user.token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const tag = `zq${run}`; // unique token so searches only see this run's data
const sample = (over: Record<string, unknown> = {}) => ({
  title: `Speech Translator ${tag}`,
  descriptionMd: `# Live speech\nTranslate meetings in real time. ${tag}`,
  type: 'demo',
  keywords: ['translation', tag],
  technologies: ['Whisper'],
  industry: ['Healthcare'],
  resources: [{ label: 'Repo', url: 'https://github.com/openai/whisper' }],
  visibility: 'public',
  ...over,
});

describe('authentication and authorization', () => {
  test('anonymous visitors can read but not write or see their identity', async () => {
    assert.equal((await api(null, 'GET', '/api/me')).status, 401);
    for (const path of ['/api/solutions', '/api/categories']) {
      assert.equal((await api(null, 'GET', path)).status, 200, path);
    }
    assert.equal((await api(null, 'POST', '/api/solutions', sample())).status, 401);
    assert.equal((await api({ ...alice, token: 'x'.repeat(43) }, 'GET', '/api/me')).status, 401);
  });

  test('bearer session resolves the current user', async () => {
    const me = await api(alice, 'GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, alice.username);
  });

  test('Google sign-in rejects invalid tokens and cross-origin web logins', async () => {
    const native = await api(null, 'POST', '/api/auth/google', { idToken: 'a.b.c', client: 'native' });
    assert.equal(native.status, 401);
    const crossSite = await api(null, 'POST', '/api/auth/google', { idToken: 'a.b.c' }, { origin: 'https://evil.example' });
    assert.equal(crossSite.status, 403);
  });

  test('/api/me reports the verified organization', async () => {
    assert.equal((await api(alice, 'GET', '/api/me')).body.user.orgDomain, ORG);
    assert.equal((await api(bob, 'GET', '/api/me')).body.user.orgDomain, null);
  });

  test('cookie-authenticated mutations require same origin and CSRF header', async () => {
    const cookie = `${BASE.startsWith('https:') ? '__Host-sh_session' : 'sh_session'}=${alice.token}`;
    const noOrigin = await api(null, 'POST', '/api/solutions', sample(), { cookie });
    assert.equal(noOrigin.status, 403);
    const evil = await api(null, 'POST', '/api/solutions', sample(), { cookie, origin: 'https://evil.example', 'x-solutionhub-csrf': '1' });
    assert.equal(evil.status, 403);
    const noHeader = await api(null, 'POST', '/api/solutions', sample(), { cookie, origin: BASE });
    assert.equal(noHeader.status, 403);
    const ok = await api(null, 'GET', '/api/me', undefined, { cookie });
    assert.equal(ok.status, 200, 'cookie GET works without CSRF header');
    const created = await api(null, 'POST', '/api/solutions', sample({ title: `Cookie ${tag}` }), { cookie, origin: BASE, 'x-solutionhub-csrf': '1' });
    assert.equal(created.status, 201);
    await api(alice, 'DELETE', `/api/solutions/${created.body.id}`);
  });

  test('CORS is not granted to arbitrary origins', async () => {
    const res = await fetch(`${BASE}/api/solutions`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('solution lifecycle', () => {
  let id = '';
  let slug = '';

  test('validation errors are reported', async () => {
    const r = await api(alice, 'POST', '/api/solutions', { title: '', descriptionMd: '', resources: [{ label: 'x', url: 'javascript:alert(1)' }], thumbnailUrl: 'data:image/png;base64,AAA' });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.details.title && r.body.error.details['resources[0].url'] && r.body.error.details.thumbnailUrl);
    const notJson = await fetch(`${BASE}/api/solutions`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(notJson.status, 400);
    const huge = await api(alice, 'POST', '/api/solutions', { title: 'x', descriptionMd: 'y'.repeat(300_000) });
    assert.equal(huge.status, 413);
  });

  test('create starts ongoing with history, slug and derived summary', async () => {
    const r = await api(alice, 'POST', '/api/solutions', sample({ status: 'completed', ownerId: bob.id }));
    assert.equal(r.status, 201);
    id = r.body.id;
    slug = r.body.slug;
    assert.equal(r.body.status, 'ongoing', 'new solutions always start ongoing');
    assert.equal(r.body.owner.username, alice.username, 'owner comes from the session, not the body');
    assert.equal(r.body.path, `/${alice.username}/${slug}`);
    assert.match(r.body.summary, /^Translate meetings in real time/, "headings are not part of the summary");
    assert.equal(r.body.resources[0].type, 'repository');
    const h = await api(alice, 'GET', `/api/solutions/${id}/updates`);
    assert.deepEqual(h.body.items.map((e: any) => e.eventType), ['created']);
  });

  test('slugs are unique per owner and URLs resolve', async () => {
    const dup = await api(alice, 'POST', '/api/solutions', sample());
    assert.equal(dup.body.slug, `${slug}-2`);
    const byPath = await api(bob, 'GET', `/api/users/${alice.username}/solutions/${slug}`);
    assert.equal(byPath.status, 200);
    assert.equal(byPath.body.id, id);
    assert.equal(byPath.body.isOwner, false);
    await api(alice, 'DELETE', `/api/solutions/${dup.body.id}`);
  });

  test('non-owners cannot modify, delete, or post updates', async () => {
    assert.equal((await api(bob, 'PATCH', `/api/solutions/${id}`, { title: 'pwned' })).status, 403);
    assert.equal((await api(bob, 'DELETE', `/api/solutions/${id}`)).status, 403);
    assert.equal((await api(bob, 'POST', `/api/solutions/${id}/updates`, { message: 'hi' })).status, 403);
    assert.equal((await api(alice, 'GET', `/api/solutions/${id}`)).body.title, `Speech Translator ${tag}`);
  });

  test('edits and completion record notes while reopening leaves history intact', async () => {
    const before = (await api(alice, 'GET', `/api/solutions/${id}`)).body.updatedAt;
    const noop = await api(alice, 'PATCH', `/api/solutions/${id}`, {
      title: `Speech Translator ${tag}`,
      changeNote: 'No fields changed',
    });
    assert.equal(noop.body.updatedAt, before, 'no-op edits do not bump updated_at');

    const blank = await api(alice, 'PATCH', `/api/solutions/${id}`, { status: 'completed', changeNote: '  \n  ' });
    assert.equal(blank.status, 422);
    assert.equal(blank.body.error.details.changeNote, 'Required');

    const edit = await api(alice, 'PATCH', `/api/solutions/${id}`, {
      title: `Speech Translator Pro ${tag}`,
      resources: [{ label: 'Paper', url: 'https://arxiv.org/pdf/2212.04356' }],
      primaryResource: 'https://arxiv.org/pdf/2212.04356',
      changeNote: '  Replaced the repository link with the reference paper.  ',
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.slug, slug, 'slug is stable across title edits');
    assert.equal(edit.body.primaryResource, 'https://arxiv.org/pdf/2212.04356');
    assert.ok(edit.body.updatedAt > before);

    assert.equal((await api(alice, 'POST', `/api/solutions/${id}/updates`, { message: 'Halfway there' })).status, 201);
    const done = await api(alice, 'PATCH', `/api/solutions/${id}`, {
      status: 'completed',
      changeNote: 'Verified the demo and finished the handoff.',
    });
    assert.equal(done.body.status, 'completed');
    assert.ok(done.body.completedAt);
    assert.equal((await api(alice, 'POST', `/api/solutions/${id}/updates`, { message: 'Post-launch fix' })).status, 201);
    const beforeReopen = (await api(alice, 'GET', `/api/solutions/${id}/updates`)).body.items;
    const reopened = await api(alice, 'PATCH', `/api/solutions/${id}`, {
      status: 'ongoing',
      changeNote: 'A note supplied to a reopen request',
    });
    assert.equal(reopened.body.status, 'ongoing');
    assert.equal(reopened.body.completedAt, null);

    const h = await api(alice, 'GET', `/api/solutions/${id}/updates`);
    assert.deepEqual(h.body.items, beforeReopen);
    assert.deepEqual(
      h.body.items.map((e: any) => e.eventType),
      ['progress_updated', 'status_changed', 'progress_updated', 'edited', 'created'],
    );
    assert.deepEqual(h.body.items[3].changes.resources, { added: ['Paper'], removed: ['Repo'] });
    assert.equal(h.body.items[3].changes.note, 'Replaced the repository link with the reference paper.');
    assert.deepEqual(h.body.items[1].changes, {
      from: 'ongoing', to: 'completed', note: 'Verified the demo and finished the handoff.',
    });
    assert.equal((await api(bob, 'GET', `/api/solutions/${id}/updates`)).status, 200, 'public history is readable');
  });

  test('private solutions are hidden from other users everywhere', async () => {
    const vis = await api(alice, 'PATCH', `/api/solutions/${id}`, {
      visibility: 'private',
      changeNote: 'Keep the review internal.',
    });
    assert.equal(vis.body.visibility, 'private');
    const event = (await api(alice, 'GET', `/api/solutions/${id}/updates`)).body.items[0];
    assert.equal(event.eventType, 'visibility_changed');
    assert.equal(event.changes.note, 'Keep the review internal.');
    const edit = await api(alice, 'PATCH', `/api/solutions/${id}`, { industry: [`Secret${tag}`] });
    assert.deepEqual(edit.body.industry, [`Secret${tag}`]);

    assert.equal((await api(bob, 'GET', `/api/solutions/${id}`)).status, 404);
    assert.equal((await api(bob, 'GET', `/api/solutions/${id}/updates`)).status, 404);
    assert.equal((await api(bob, 'GET', `/api/users/${alice.username}/solutions/${slug}`)).status, 404);
    assert.equal((await api(bob, 'PATCH', `/api/solutions/${id}`, { title: 'x' })).status, 404);
    assert.equal((await api(bob, 'GET', `/api/solutions?q=${tag}`)).body.total, 0);
    assert.equal((await api(bob, 'GET', `/api/users/${alice.username}/solutions`)).body.total, 0);
    const profile = await api(bob, 'GET', `/api/users/${alice.username}`);
    assert.deepEqual(profile.body.counts, { ongoing: 0, completed: 0, total: 0, private: 0 });
    const cats = await api(bob, 'GET', '/api/categories');
    assert.ok(!cats.body.industry.some((c: any) => c.value === `Secret${tag}`), 'categories do not leak');

    assert.equal((await api(alice, 'GET', `/api/solutions?q=${tag}`)).body.total, 1, 'owner still finds it');
    assert.equal((await api(alice, 'GET', `/api/users/${alice.username}`)).body.counts.private, 1);
    assert.equal((await api(alice, 'GET', `/api/solutions?q=${tag}&visibility=public`)).body.total, 0);
    await api(alice, 'PATCH', `/api/solutions/${id}`, { visibility: 'public' });
  });

  test('delete requires ownership and cascades history', async () => {
    assert.equal((await api(alice, 'DELETE', `/api/solutions/${id}`)).status, 204);
    assert.equal((await api(alice, 'GET', `/api/solutions/${id}`)).status, 404);
    assert.equal((await api(alice, 'GET', `/api/solutions/${id}/updates`)).status, 404);
  });
});

describe('search, filters, sorting and pagination', () => {
  const ids: string[] = [];
  before(async () => {
    const specs = [
      { title: `Invoice parser ${tag}`, descriptionMd: 'Extracts totals from scanned PDFs', keywords: ['ocr'], technologies: ['Tesseract'], type: 'document' },
      { title: `Receipt OCR mobile ${tag}`, descriptionMd: 'Android app reading receipts with an invoice-style layout', keywords: ['android'], technologies: ['Kotlin'], type: 'demo' },
      { title: `Forecasting ${tag}`, descriptionMd: 'Quarterly revenue forecasting', keywords: ['finance'], client: 'Acme Invoice Corp', type: 'other' },
    ];
    for (const s of specs) {
      const r = await api(alice, 'POST', '/api/solutions', { ...s, keywords: [...s.keywords, tag], visibility: 'public' });
      ids.push(r.body.id);
    }
    await api(alice, 'PATCH', `/api/solutions/${ids[2]}`, { status: 'completed' });
  });

  test('ranks title matches above description/client matches', async () => {
    const r = await api(bob, 'GET', `/api/solutions?sort=relevance&q=${encodeURIComponent(`  INVOICE   ${tag} `)}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.items[0].id, ids[0]);
    assert.equal(r.body.items[0].descriptionMd, undefined, 'list results omit the full description');
  });

  test('multi-term AND and partial matching', async () => {
    assert.equal((await api(bob, 'GET', `/api/solutions?q=recei+andro+${tag}`)).body.total, 1);
    assert.equal((await api(bob, 'GET', `/api/solutions?q=tesser+${tag}`)).body.total, 1, 'matches technologies');
    assert.equal((await api(bob, 'GET', `/api/solutions?q=${alice.username}+${tag}`)).body.total, 3, 'matches owner username');
    assert.equal((await api(bob, 'GET', `/api/solutions?q=nomatchxyz+${tag}`)).body.total, 0);
  });

  test('filters combine with search', async () => {
    assert.equal((await api(bob, 'GET', `/api/solutions?q=${tag}&status=completed`)).body.total, 1);
    assert.equal((await api(bob, 'GET', `/api/solutions?q=${tag}&type=demo,document`)).body.total, 2);
    assert.equal((await api(bob, 'GET', `/api/solutions?q=${tag}&technology=kotlin`)).body.total, 1, 'filters are case-insensitive');
  });

  test('sorting and pagination', async () => {
    const oldest = await api(bob, 'GET', `/api/solutions?q=${tag}&sort=oldest`);
    assert.deepEqual(oldest.body.items.map((s: any) => s.id), ids);
    const updated = await api(bob, 'GET', `/api/solutions?q=${tag}&sort=updated`);
    assert.equal(updated.body.items[0].id, ids[2], 'most recently updated first');
    const p1 = await api(bob, 'GET', `/api/solutions?q=${tag}&sort=created&limit=2&page=1`);
    const p2 = await api(bob, 'GET', `/api/solutions?q=${tag}&sort=created&limit=2&page=2`);
    assert.equal(p1.body.items.length, 2);
    assert.equal(p2.body.items.length, 1);
    assert.equal(p1.body.total, 3);
    assert.ok(!p1.body.items.some((a: any) => p2.body.items.some((b: any) => a.id === b.id)));
  });

  test('SQL injection payloads are treated as plain text', async () => {
    for (const q of ["' OR 1=1 --", '%', '_', '") UNION SELECT * FROM users --', `${tag}' OR '1'='1`]) {
      const r = await api(bob, 'GET', `/api/solutions?q=${encodeURIComponent(q)}&industry=${encodeURIComponent("x') OR 1=1 --")}`);
      assert.equal(r.status, 200, q);
      assert.equal(r.body.total, 0, q);
    }
    const r = await api(bob, 'GET', `/api/solutions?sort=${encodeURIComponent('created_at; DROP TABLE solutions')}&q=${tag}`);
    assert.equal(r.body.total, 3);
  });

  test('stored markup is returned verbatim as JSON data', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const r = await api(alice, 'POST', '/api/solutions', { title: `${xss} ${tag}`, descriptionMd: `[click](javascript:alert(1)) ${xss}` });
    assert.equal(r.status, 201);
    assert.ok(r.headers.get('content-type')?.startsWith('application/json'));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.body.title, /<script>/, 'stored as text; the client renders it inertly');
    assert.equal(r.body.slug, 'img-src-x-onerror-alert-1-script-alert-1-script-' + tag);
    ids.push(r.body.id);
  });

  test('categories reflect visible data', async () => {
    const r = await api(bob, 'GET', '/api/categories?visibility=public');
    assert.ok(r.body.technology.some((c: any) => c.value === 'Tesseract'));
    assert.ok(Array.isArray(r.body.type));
  });

  test('cleanup', async () => {
    for (const sid of ids) assert.equal((await api(alice, 'DELETE', `/api/solutions/${sid}`)).status, 204);
  });
});

describe('solution likes', () => {
  const likedList = '/api/me/liked-solutions';
  const likePath = (id: string) => `/api/solutions/${id}/like`;
  const fixtures: string[] = [];

  async function create(title: string, visibility = 'public') {
    const res = await api(alice, 'POST', '/api/solutions', sample({ title, visibility }));
    assert.equal(res.status, 201);
    fixtures.push(res.body.id);
    return res.body as { id: string; slug: string; updatedAt: string };
  }

  after(async () => {
    for (const id of fixtures) await api(alice, 'DELETE', `/api/solutions/${id}`);
  });

  test('likes are unique, visible as counts, and saved only to the acting account', async () => {
    const solution = await create(`Like ${run}`);
    const path = likePath(solution.id);
    const cookie = `${BASE.startsWith('https:') ? '__Host-sh_session' : 'sh_session'}=${bob.token}`;
    assert.equal((await api(null, 'PUT', path)).status, 401);
    assert.equal((await api(null, 'GET', likedList)).status, 401);
    assert.equal((await api(null, 'PUT', path, undefined, { cookie, origin: BASE })).status, 403);

    const [one, two] = await Promise.all([
      api(null, 'PUT', path, undefined, { cookie, origin: BASE, 'x-solutionhub-csrf': '1' }),
      api(bob, 'PUT', path),
    ]);
    for (const res of [one, two]) {
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { likeCount: 1, likedByMe: true });
    }
    assert.deepEqual((await api(carol, 'PUT', path)).body, { likeCount: 2, likedByMe: true });

    const publicDetail = await api(null, 'GET', `/api/users/${alice.username}/solutions/${solution.slug}`);
    assert.equal(publicDetail.body.likeCount, 2);
    assert.equal(publicDetail.body.likedByMe, false);
    assert.equal(publicDetail.body.updatedAt, solution.updatedAt);
    assert.equal((await api(dave, 'GET', likedList)).body.total, 0);
    assert.equal((await api(dave, 'GET', `/api/users/${bob.username}/liked-solutions`)).status, 404);
    const saved = await api(bob, 'GET', likedList);
    assert.equal(saved.body.total, 1);
    assert.equal(saved.body.items[0].id, solution.id);
    assert.equal(saved.body.items[0].likedByMe, true);

    for (const moment of ['first', 'retry']) {
      assert.deepEqual((await api(bob, 'DELETE', path)).body, { likeCount: 1, likedByMe: false }, moment);
    }
    assert.equal((await api(bob, 'GET', likedList)).body.total, 0);
    assert.equal((await api(carol, 'GET', likedList)).body.total, 1);
    assert.equal((await api(alice, 'DELETE', `/api/solutions/${solution.id}`)).status, 204);
    assert.equal((await api(carol, 'GET', likedList)).body.total, 0);
  });

  test('like changes and saved lists respect current solution visibility', async () => {
    const org = await create(`Like organization ${run}`, 'organization');
    const owned = await create(`Like private ${run}`, 'private');
    for (const [viewer, id] of [[dave, org.id], [carol, owned.id]] as const) {
      assert.equal((await api(viewer, 'PUT', likePath(id))).status, 404);
      assert.equal((await api(viewer, 'DELETE', likePath(id))).status, 404);
    }
    assert.equal((await api(alice, 'PUT', likePath(owned.id))).status, 200);
    assert.equal((await api(carol, 'PUT', likePath(org.id))).status, 200);
    assert.equal((await api(carol, 'GET', likedList)).body.items[0].id, org.id);
    assert.equal((await api(alice, 'PATCH', `/api/solutions/${org.id}`, { visibility: 'private' })).status, 200);
    assert.equal((await api(carol, 'GET', likedList)).body.total, 0);
    assert.equal((await api(carol, 'DELETE', likePath(org.id))).status, 404);
  });

  test('default order uses last updated, then likes, before applying pagination', async () => {
    const marker = `likeorder${run}`;
    const [newer, tied] = [await create(`First tie ${marker}`), await create(`Second tie ${marker}`)]
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.ok(newer && tied);
    const older = await create(`Older ${marker}`);
    d1(`UPDATE solutions SET created_at = '2019-01-01T00:00:00.000Z', updated_at = '2020-01-02T00:00:00.000Z' WHERE id IN ('${newer.id}', '${tied.id}');
        UPDATE solutions SET created_at = '2019-12-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = '${older.id}';`);
    assert.equal((await api(bob, 'PUT', likePath(tied.id))).status, 200);
    assert.equal((await api(bob, 'PUT', likePath(older.id))).status, 200);
    assert.equal((await api(carol, 'PUT', likePath(older.id))).status, 200);

    const list = `/api/solutions?q=${marker}&limit=1`;
    for (const [i, solution] of [tied, newer, older].entries()) {
      const res = await api(null, 'GET', `${list}&page=${i + 1}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 3);
      assert.equal(res.body.items[0].id, solution.id);
      assert.equal(res.body.items[0].likeCount, [1, 0, 2][i]);
    }
    const saved = await api(bob, 'GET', `${likedList}?limit=1&page=2`);
    assert.equal(saved.body.total, 2);
    assert.equal(saved.body.items[0].id, older.id);
    assert.equal((await api(null, 'GET', `${list}&sort=created`)).body.items[0].id, older.id);
  });
});

describe('three visibility levels', () => {
  const ids: Record<string, string> = {};
  const vtag = `vz${run}`;
  before(async () => {
    for (const visibility of ['public', 'organization', 'private']) {
      const r = await api(alice, 'POST', '/api/solutions', sample({ title: `${visibility} ${vtag}`, visibility, category: [`Cat${vtag}${visibility}`] }));
      assert.equal(r.status, 201, visibility);
      ids[visibility] = r.body.id;
    }
  });

  const who = { anonymous: null, owner: alice, colleague: carol, outsider: dave, personal: bob } as const;
  const expected: Record<string, string[]> = {
    anonymous: ['public'],
    owner: ['public', 'organization', 'private'],
    colleague: ['public', 'organization'],
    outsider: ['public'],
    personal: ['public'],
  };

  test('detail, path, history, search, profile and categories agree for every viewer', async () => {
    for (const [name, viewer] of Object.entries(who)) {
      const allowed = expected[name]!;
      for (const [vis, id] of Object.entries(ids)) {
        const want = allowed.includes(vis) ? 200 : 404;
        assert.equal((await api(viewer, 'GET', `/api/solutions/${id}`)).status, want, `${name} detail ${vis}`);
        assert.equal((await api(viewer, 'GET', `/api/solutions/${id}/updates`)).status, want, `${name} history ${vis}`);
        assert.equal((await api(viewer, 'GET', `/api/users/${alice.username}/solutions/${vis}-${vtag}`)).status, want, `${name} path ${vis}`);
      }
      const found = (await api(viewer, 'GET', `/api/solutions?q=${vtag}`)).body.items.map((s: any) => s.visibility).sort();
      assert.deepEqual(found, [...allowed].sort(), `${name} search`);
      const listed = (await api(viewer, 'GET', `/api/users/${alice.username}/solutions`)).body.total;
      assert.equal(listed, allowed.length, `${name} profile list`);
      const profile = (await api(viewer, 'GET', `/api/users/${alice.username}`)).body;
      assert.equal(profile.counts.total, allowed.length, `${name} profile counts`);
      const cats = (await api(viewer, 'GET', '/api/categories')).body.category.map((c: any) => c.value);
      for (const vis of Object.keys(ids)) {
        assert.equal(cats.includes(`Cat${vtag}${vis}`), allowed.includes(vis), `${name} category ${vis}`);
      }
    }
  });

  test('organization solutions expose the domain only to those who can see them', async () => {
    assert.equal((await api(carol, 'GET', `/api/solutions/${ids.organization}`)).body.orgDomain, ORG);
    assert.equal((await api(null, 'GET', `/api/solutions/${ids.public}`)).body.orgDomain, null);
  });

  test('visibility filter narrows but never widens', async () => {
    const r = await api(dave, 'GET', `/api/solutions?q=${vtag}&visibility=organization,private`);
    assert.equal(r.body.total, 0);
    const own = await api(alice, 'GET', `/api/solutions?q=${vtag}&visibility=public,organization`);
    assert.equal(own.body.total, 2);
  });

  test('only the owner can modify; colleagues and anonymous cannot', async () => {
    assert.equal((await api(carol, 'PATCH', `/api/solutions/${ids.organization}`, { title: 'x' })).status, 403);
    assert.equal((await api(carol, 'DELETE', `/api/solutions/${ids.organization}`)).status, 403);
    assert.equal((await api(carol, 'POST', `/api/solutions/${ids.organization}/updates`, { message: 'x' })).status, 403);
    assert.equal((await api(null, 'PATCH', `/api/solutions/${ids.public}`, { title: 'x' })).status, 401);
    assert.equal((await api(dave, 'PATCH', `/api/solutions/${ids.organization}`, { title: 'x' })).status, 404);
  });

  test('personal accounts cannot use organization visibility', async () => {
    const created = await api(bob, 'POST', '/api/solutions', sample({ visibility: 'organization' }));
    assert.equal(created.status, 422);
    assert.ok(created.body.error.details.visibility);
    const mine = await api(bob, 'POST', '/api/solutions', sample({ title: `Bob ${vtag}`, visibility: 'public' }));
    assert.equal((await api(bob, 'PATCH', `/api/solutions/${mine.body.id}`, { visibility: 'organization' })).status, 422);
    await api(bob, 'DELETE', `/api/solutions/${mine.body.id}`);
  });

  test('omitted visibility defaults to private; changes are recorded', async () => {
    const r = await api(alice, 'POST', '/api/solutions', { title: `Default ${vtag}`, descriptionMd: 'x' });
    assert.equal(r.body.visibility, 'private');
    const shared = await api(alice, 'PATCH', `/api/solutions/${r.body.id}`, { visibility: 'organization' });
    assert.equal(shared.body.visibility, 'organization');
    const h = (await api(alice, 'GET', `/api/solutions/${r.body.id}/updates`)).body.items[0];
    assert.equal(h.eventType, 'visibility_changed');
    assert.deepEqual(h.changes, { from: 'private', to: 'organization' });
    await api(alice, 'DELETE', `/api/solutions/${r.body.id}`);
  });

  test('cleanup', async () => {
    for (const id of Object.values(ids)) assert.equal((await api(alice, 'DELETE', `/api/solutions/${id}`)).status, 204);
  });
});

describe('profiles, logout and web app routing', () => {
  test('profiles expose no private fields', async () => {
    const r = await api(bob, 'GET', `/api/users/${alice.username}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.email, undefined);
    assert.equal(r.body.isSelf, false);
    assert.equal((await api(bob, 'GET', '/api/users/does-not-exist-xyz')).status, 404);
  });

  test('deep links serve the SPA shell with security headers', async () => {
    const res = await fetch(`${BASE}/${alice.username}/some-solution`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal((await api(bob, 'GET', '/api/nope')).status, 404);
    assert.equal((await api(bob, 'PUT', '/api/solutions')).status, 405);
  });

  test('logout revokes the session', async () => {
    assert.equal((await api(bob, 'POST', '/api/auth/logout')).status, 200);
    assert.equal((await api(bob, 'GET', '/api/me')).status, 401);
  });
});
