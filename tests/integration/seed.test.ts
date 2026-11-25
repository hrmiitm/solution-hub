/**
 * End-to-end tests against a running local server (`cd worker && npm run dev`) whose local D1 was seeded
 * with `node scripts/seed.mjs`. Sessions are inserted as hashed tokens directly into the test database;
 * there is no authentication bypass in application code. Throwaway viewers are deleted afterwards.
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
const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker');
const run = randomBytes(3).toString('hex');

interface U { id: string; username: string; token: string; org: string | null; seeded?: boolean }
const token = () => randomBytes(32).toString('base64url');
const viewer = (name: string, org: string | null): U => ({ id: randomUUID(), username: `t-${name}-${run}`, token: token(), org });
const straive = viewer('straive', 'straive.com');
const iitm = viewer('iitm', 'ds.study.iitm.ac.in');
const elsewhere = viewer('elsewhere', `other-${run}.test`);
const personal = viewer('personal', null);
// Seeded owners get a session only; their rows are the real seed data.
const seededOwner = (username: string, n: number): U => ({ id: `5eed1000-0000-4000-8000-00000000000${n}`, username, token: token(), org: null, seeded: true });
const anand = seededOwner('sanand0', 1);
const jivraj = seededOwner('jivraj-18', 2);
const sujal = seededOwner('sujalpradhan', 3);
const viewers = [straive, iitm, elsewhere, personal];

function d1(sql: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'sh-seed-')), 'q.sql');
  writeFileSync(file, sql);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'solutionhub', '--local', `--file=${file}`], { cwd: workerDir, stdio: 'ignore' });
}

async function api(user: U | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

before(() => {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const hash = (u: U) => createHash('sha256').update(u.token).digest('hex');
  d1(
    [
      ...viewers.map((u) => `INSERT INTO users (id, google_id, username, name, email, avatar_url, org_domain, created_at, updated_at) VALUES ('${u.id}', NULL, '${u.username}', 'Test', '${u.username}@example.test', NULL, ${u.org ? `'${u.org}'` : 'NULL'}, '${now}', '${now}');`),
      ...[...viewers, anand, jivraj, sujal].map((u) => `INSERT INTO sessions (id, user_id, client, created_at, expires_at) VALUES ('${hash(u)}', '${u.id}', 'native', '${now}', '${later}');`),
    ].join('\n'),
  );
});

after(() => {
  const hashes = [...viewers, anand, jivraj, sujal].map((u) => `'${createHash('sha256').update(u.token).digest('hex')}'`).join(', ');
  d1(`DELETE FROM sessions WHERE id IN (${hashes}); DELETE FROM users WHERE id IN (${viewers.map((u) => `'${u.id}'`).join(', ')});`);
});

const list = async (v: U | null, owner: string) => (await api(v, 'GET', `/api/users/${owner}/solutions?limit=50`)).body.items as { id: string; title: string; visibility: string; path: string }[];
const total = async (v: U | null, owner: string) => (await api(v, 'GET', `/api/users/${owner}`)).body.counts.total as number;

describe('initial dataset and visibility', () => {
  test('anonymous visitors see only the public cards; profile counts match', async () => {
    assert.deepEqual([await total(null, 'sanand0'), await total(null, 'jivraj-18'), await total(null, 'sujalpradhan'), await total(null, 'hrmiitm')], [6, 6, 6, 2]);
    for (const o of ['sanand0', 'jivraj-18', 'sujalpradhan', 'hrmiitm']) assert.ok((await list(null, o)).every((s) => s.visibility === 'public'), o);
    assert.equal((await api(null, 'GET', '/api/solutions?limit=1')).body.total, 20);
  });

  test('organization cards are visible only to signed-in members of the owner’s verified domain', async () => {
    assert.deepEqual([await total(straive, 'sanand0'), await total(straive, 'jivraj-18'), await total(straive, 'sujalpradhan')], [8, 8, 6]);
    assert.deepEqual([await total(iitm, 'sujalpradhan'), await total(iitm, 'hrmiitm'), await total(iitm, 'sanand0')], [8, 2, 6]);
    for (const v of [elsewhere, personal, null]) assert.deepEqual([await total(v, 'sanand0'), await total(v, 'sujalpradhan')], [6, 6]);
    const org = (await list(straive, 'sanand0')).find((s) => s.visibility === 'organization')!;
    assert.equal((await api(straive, 'GET', `/api/solutions/${org.id}`)).status, 200);
    for (const v of [null, iitm, elsewhere, personal]) assert.equal((await api(v, 'GET', `/api/solutions/${org.id}`)).status, 404);
  });

  test('private cards are a 404 for everyone but the owner, including history', async () => {
    const mine = await list(anand, 'sanand0');
    assert.equal(mine.length, 10);
    assert.equal((await api(anand, 'GET', '/api/users/sanand0')).body.counts.private, 2);
    const priv = mine.find((s) => s.visibility === 'private')!;
    for (const v of [null, straive, iitm, elsewhere, personal, jivraj]) {
      assert.equal((await api(v, 'GET', `/api/solutions/${priv.id}`)).status, 404);
      assert.equal((await api(v, 'GET', `/api/solutions/${priv.id}/updates`)).status, 404);
      assert.equal((await api(v, 'GET', `/api/users${priv.path}`)).status, 404);
    }
    assert.equal((await api(anand, 'GET', `/api/solutions/${priv.id}`)).status, 200);
  });

  test('search respects visibility', async () => {
    const hits = async (v: U | null, q: string) => ((await api(v, 'GET', `/api/solutions?q=${encodeURIComponent(q)}&limit=50`)).body.items as { title: string }[]).map((i) => i.title);
    assert.ok((await hits(null, 'pareto')).includes('LLM Pricing and Quality Explorer'));
    assert.ok(!(await hits(null, 'chatgpt-to-markdown')).includes('ChatGPT to Markdown Converter'));
    assert.ok((await hits(anand, 'chatgpt-to-markdown')).includes('ChatGPT to Markdown Converter'));
    assert.ok(!(await hits(null, 'skill mcp')).includes('Agent Skills MCP Server'));
    assert.ok((await hits(straive, 'skill mcp')).includes('Agent Skills MCP Server'));
    assert.ok(!(await hits(iitm, 'skill mcp')).includes('Agent Skills MCP Server'));
  });

  test('no email addresses appear in any public response', async () => {
    for (const path of ['/api/users/sanand0', '/api/users/sanand0/solutions?limit=50', '/api/solutions?limit=50', '/api/categories']) {
      const res = await api(null, 'GET', path);
      assert.ok(!/@[\w-]+\.\w/.test(res.text), `${path} leaks an email-like value`);
      assert.ok(!/"email"/.test(res.text), path);
    }
  });

  test('real repository timestamps; imported from GitHub; simulated history is labelled', async () => {
    const llm = (await list(null, 'sanand0')).find((s) => s.title === 'LLM Pricing and Quality Explorer')!;
    const detail = (await api(null, 'GET', `/api/solutions/${llm.id}`)).body;
    assert.match(detail.descriptionMd, /Imported from GitHub/);
    assert.equal(detail.resources[0].url, 'https://github.com/sanand0/llmpricing');
    assert.equal(detail.createdAt, '2024-07-28T' + detail.createdAt.slice(11), 'created date is the repository creation date');
    const kcb = (await list(null, 'jivraj-18')).find((s) => s.title === 'LLM Knowledge Cutoff Benchmark')!;
    const hist = (await api(null, 'GET', `/api/solutions/${kcb.id}/updates`)).body.items;
    const created = hist.find((h: any) => h.eventType === 'created');
    assert.match(created.message, /^Imported from GitHub/);
    assert.ok(!created.changes.simulated);
    const sim = hist.filter((h: any) => h.changes.simulated);
    assert.ok(sim.length >= 1 && sim.every((h: any) => h.message.startsWith('[Simulated test history]')));
    assert.equal(hist[0].eventType, 'progress_updated', 'updated after completion');
    const reopened = (await list(null, 'jivraj-18')).find((s) => s.title === 'Financial Document Retrieval Benchmark')!;
    assert.equal((await api(null, 'GET', `/api/solutions/${reopened.id}`)).body.status, 'completed');
    const messages = (await api(null, 'GET', `/api/solutions/${reopened.id}/updates`)).body.items.map((h: any) => h.message as string);
    assert.ok(messages.some((m: string) => m.includes('Reopened')), 'a reopened-then-completed-again history exists');
  });
});

describe('initial status: at most two Ongoing per user, the latest ones', () => {
  test('profile counts and which cards are ongoing', async () => {
    const counts = async (u: string) => (await api(null, 'GET', `/api/users/${u}`)).body.counts;
    const own = async (viewer: U, u: string) => (await api(viewer, 'GET', `/api/users/${u}`)).body.counts;
    for (const [viewer, u] of [[anand, 'sanand0'], [jivraj, 'jivraj-18'], [sujal, 'sujalpradhan']] as [U, string][]) {
      const c = await own(viewer, u);
      assert.deepEqual([c.ongoing, c.completed], [2, 8], u);
    }
    const names = async (v: U | null, u: string, status: string) => ((await api(v, 'GET', `/api/users/${u}/solutions?status=${status}&limit=50`)).body.items as { title: string }[]).map((i) => i.title).sort();
    assert.deepEqual(await names(anand, 'sanand0', 'ongoing'), ['Developer Productivity Scripts', 'Reusable Agent Skills']);
    assert.deepEqual(await names(null, 'jivraj-18', 'ongoing'), ['CAD Reconstruction Benchmark for Coding Agents', 'Compressor Fault Diagnosis from Sound']);
    assert.deepEqual(await names(null, 'sujalpradhan', 'ongoing'), ['Content DNA Analyzer'], 'the other ongoing card is organization-only');
    assert.deepEqual(await names(null, 'hrmiitm', 'ongoing'), ['Financial Sentiment Model Benchmark'], 'the other ongoing card is private');
    assert.equal((await counts('hrmiitm')).completed, 1);
  });

  test('completed cards carry a completion date and a labelled history entry', async () => {
    const item = (await list(null, 'sanand0')).find((s) => s.title === 'AI Pipe')!;
    const detail = (await api(null, 'GET', `/api/solutions/${item.id}`)).body;
    assert.equal(detail.status, 'completed');
    assert.ok(detail.completedAt, 'completed cards have a completion date');
    const hist = (await api(null, 'GET', `/api/solutions/${item.id}/updates`)).body.items;
    const done = hist.find((h: any) => h.eventType === 'status_changed' && !h.changes.simulated);
    assert.equal(done.message, 'Marked completed in the initial data (not derived from repository activity)');
    assert.equal(done.createdAt, detail.completedAt);
  });
});

describe('media on cards', () => {
  test('most cards have images, documents or videos; thumbnails and previews come through the API', async () => {
    const all = (await api(null, 'GET', '/api/solutions?limit=50')).body.items as { id: string; thumbnailUrl: string | null; primaryResource: string | null; resources: { type: string; url: string }[] }[];
    const withMedia = all.filter((s) => s.resources.some((r) => ['youtube', 'image', 'pdf'].includes(r.type)));
    assert.ok(withMedia.length / all.length >= 0.6, `${withMedia.length}/${all.length} public cards have media`);
    const tools = all.find((s) => s.resources.some((r) => r.url.includes('sanand0/tools')) && s.thumbnailUrl)!;
    assert.match(tools.thumbnailUrl!, /^https:\/\/raw\.githubusercontent\.com\/sanand0\/tools\//);
    assert.ok(tools.resources.some((r) => r.url === tools.primaryResource), 'primary preview is one of the resources');
    const yt = all.find((s) => s.primaryResource?.startsWith('https://www.youtube.com/watch'))!;
    assert.equal(yt.resources.find((r) => r.url === yt.primaryResource)!.type, 'youtube');
  });
});

describe('all users are equal: only owners edit and delete', () => {
  test('there is no admin or privileged surface, and /api/me carries no role', async () => {
    for (const p of ['/api/admin', '/api/admin/users', '/api/me/imports']) assert.equal((await api(anand, 'GET', p)).status, 404, p);
    const me = (await api(anand, 'GET', '/api/me')).body.user;
    assert.deepEqual(Object.keys(me).sort(), ['avatarUrl', 'email', 'name', 'orgDomain', 'username']);
  });

  test('a non-owner cannot edit or delete; anonymous gets 401; the owner can edit', async () => {
    const target = (await list(anand, 'sanand0')).find((s) => s.title === 'AI Pipe')!;
    const before = (await api(anand, 'GET', `/api/solutions/${target.id}`)).body;
    for (const v of [jivraj, sujal, straive, personal]) {
      assert.equal((await api(v, 'PATCH', `/api/solutions/${target.id}`, { summary: 'hijack' })).status, 403, v.username);
      assert.equal((await api(v, 'DELETE', `/api/solutions/${target.id}`)).status, 403, v.username);
      assert.equal((await api(v, 'POST', `/api/solutions/${target.id}/updates`, { message: 'x' })).status, 403);
    }
    assert.equal((await api(null, 'PATCH', `/api/solutions/${target.id}`, { summary: 'x' })).status, 401);
    assert.equal((await api(null, 'DELETE', `/api/solutions/${target.id}`)).status, 401);
    const edited = await api(anand, 'PATCH', `/api/solutions/${target.id}`, { summary: 'Edited by the owner.' });
    assert.equal(edited.body.summary, 'Edited by the owner.');
    await api(anand, 'PATCH', `/api/solutions/${target.id}`, { summary: before.summary }); // restore the seed value
    assert.equal((await api(null, 'GET', `/api/solutions/${target.id}`)).body.summary, before.summary);
  });

  test('a user can create, complete, reopen, update and delete their own solution; others cannot see a private one', async () => {
    const mine = (await api(personal, 'POST', '/api/solutions', { title: `Mine ${run}`, descriptionMd: 'x', visibility: 'private' })).body;
    assert.equal(mine.owner.username, personal.username);
    assert.equal((await api(null, 'GET', `/api/solutions/${mine.id}`)).status, 404);
    assert.equal((await api(personal, 'PATCH', `/api/solutions/${mine.id}`, { status: 'completed' })).body.status, 'completed');
    assert.equal((await api(personal, 'PATCH', `/api/solutions/${mine.id}`, { status: 'ongoing' })).body.status, 'ongoing');
    await api(personal, 'POST', `/api/solutions/${mine.id}/updates`, { message: 'progress' });
    // personal accounts cannot use organization visibility; org users can
    assert.equal((await api(personal, 'PATCH', `/api/solutions/${mine.id}`, { visibility: 'organization' })).status, 422);
    const orgOne = (await api(straive, 'POST', '/api/solutions', { title: `Org ${run}`, descriptionMd: 'x', visibility: 'organization' })).body;
    assert.equal((await api(iitm, 'GET', `/api/solutions/${orgOne.id}`)).status, 404);
    assert.equal((await api(jivraj, 'GET', `/api/solutions/${orgOne.id}`)).status, 200, 'a different person in the same verified domain can view it');
    assert.equal((await api(jivraj, 'PATCH', `/api/solutions/${orgOne.id}`, { summary: 'x' })).status, 403, 'but cannot edit it');
    assert.equal((await api(straive, 'DELETE', `/api/solutions/${orgOne.id}`)).status, 204);
    assert.equal((await api(personal, 'DELETE', `/api/solutions/${mine.id}`)).status, 204);
  });

  test('each profile has a unique shareable URL', async () => {
    const p = (await api(null, 'GET', '/api/users/sanand0')).body;
    assert.deepEqual([p.username, p.name], ['sanand0', 'S. Anand']);
    assert.equal((await api(null, 'GET', '/api/users/nobody-here')).status, 404);
    const page = await fetch(`${BASE}/sanand0`);
    assert.equal(page.status, 200, 'the SPA serves /<username> directly');
    assert.match(page.headers.get('content-type') ?? '', /html/);
  });
});

describe('pagination', () => {
  const page = (v: U | null, qs: string) => api(v, 'GET', `/api/solutions?${qs}`);

  test('pages are complete, disjoint and stable; total is constant', async () => {
    const seen: string[] = [];
    let totalSeen: number | null = null;
    for (let p = 1; p <= 4; p++) {
      const res = await page(null, `limit=12&page=${p}&sort=created`);
      assert.equal(res.status, 200);
      assert.equal(res.body.page, p);
      assert.equal(res.body.limit, 12);
      totalSeen ??= res.body.total;
      assert.equal(res.body.total, totalSeen);
      seen.push(...res.body.items.map((i: any) => i.id));
    }
    assert.equal(totalSeen, 20, 'anonymous total is the 20 public cards');
    assert.equal(seen.length, 20);
    assert.equal(new Set(seen).size, 20, 'no card appears on two pages');
    assert.equal((await page(null, 'limit=12&page=2')).body.items.length, 8);
    assert.equal((await page(null, 'limit=12&page=3')).body.items.length, 0, 'past the last page is empty, not an error');
  });

  test('signed-in viewers page over what they may see (more than anonymous)', async () => {
    const anon = (await page(null, 'limit=50')).body.total;
    const org = (await page(straive, 'limit=50')).body.total;
    assert.ok(org > anon, `${org} > ${anon}`);
    const first = await page(straive, 'limit=10&page=1&sort=created');
    const second = await page(straive, 'limit=10&page=2&sort=created');
    assert.equal(first.body.total, org);
    assert.ok(!first.body.items.some((a: any) => second.body.items.some((b: any) => a.id === b.id)));
  });

  test('limit and page are clamped; junk falls back to defaults', async () => {
    assert.equal((await page(null, 'limit=1000')).body.limit, 50);
    assert.equal((await page(null, 'limit=0')).body.limit, 24);
    assert.equal((await page(null, 'limit=-5')).body.limit, 1);
    assert.equal((await page(null, 'page=0')).body.page, 1);
    assert.equal((await page(null, 'page=abc&limit=xyz')).body.page, 1);
    assert.equal((await page(null, 'page=99999')).body.page, 1000);
  });

  test('profile lists paginate too', async () => {
    const one = await api(anand, 'GET', '/api/users/sanand0/solutions?limit=4&page=1&sort=created');
    const three = await api(anand, 'GET', '/api/users/sanand0/solutions?limit=4&page=3&sort=created');
    assert.equal(one.body.total, 10);
    assert.equal(one.body.items.length, 4);
    assert.equal(three.body.items.length, 2);
  });
});
