import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8788';
const resource = base + '/mcp';
const workerDir = fileURLToPath(new URL('../../worker', import.meta.url));
const run = randomBytes(4).toString('hex');
const testIp = `2001:db8:${run.slice(0, 4)}:${run.slice(4)}::1`;
const org = `mcp-${run}.test`;
const read = 'solutions:read';
const write = read + ' solutions:write';
const redirect = 'http://127.0.0.1:6276/oauth/callback';
const clients: string[] = [];
const sha = (text: string, encoding: 'hex' | 'base64url' = 'hex') =>
  createHash('sha256').update(text).digest(encoding);

const user = (name: string, domain: string | null) => ({
  id: randomUUID(),
  username: `test-${name}-${run}`,
  session: randomBytes(32).toString('base64url'),
  domain,
});
const owner = user('owner', org);
const member = user('member', org);
const outsider = user('outsider', `other-${run}.test`);
const personal = user('personal', null);
const users = [owner, member, outsider, personal];

function d1(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sh-mcp-test-'));
  const file = join(dir, 'query.sql');
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'solutionhub', '--local', `--file=${file}`], { cwd: workerDir, stdio: 'ignore' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const consentHeaders = (account: typeof owner) => ({
  cookie: `sh_session=${account.session}`,
  origin: base,
  'x-solutionhub-csrf': '1',
});

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', testIp);
  const response = await fetch(base + path, { ...init, headers });
  const text = await response.text();
  const events = response.headers.get('content-type')?.includes('text/event-stream');
  const data = events ? text.match(/^data: (.+)$/m)?.[1] : text;
  return { status: response.status, headers: response.headers, data: data ? JSON.parse(data) : null };
}

const jsonPost = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const form = (params: Record<string, string>, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers,
  body: new URLSearchParams(params),
});

async function register(params: Record<string, unknown> = {}) {
  const registered = await request('/oauth/register', jsonPost({
    client_name: 'SolutionHub integration test', redirect_uris: [redirect], token_endpoint_auth_method: 'none', ...params,
  }));
  assert.equal(registered.status, 201);
  const id = registered.data.client_id as string;
  assert.match(id, /^shc_[A-Za-z0-9_-]+$/);
  clients.push(id);
  return registered.data as { client_id: string; client_secret?: string };
}

function authorization(client: string, scope = write, callback = redirect) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: client, redirect_uri: callback, resource, scope, state,
    code_challenge: sha(verifier, 'base64url'), code_challenge_method: 'S256',
  });
  return { client, verifier, query, state, callback };
}

async function approve(auth: ReturnType<typeof authorization>, account: typeof owner, allowWrite: boolean) {
  const response = await request('/api/oauth/authorize?' + auth.query, jsonPost({ approve: true, write: allowWrite }, consentHeaders(account)));
  assert.equal(response.status, 200, JSON.stringify(response.data?.error ?? ''));
  const callback = new URL(response.data.redirectTo);
  assert.equal(callback.origin + callback.pathname, auth.callback);
  assert.equal(callback.searchParams.get('state'), auth.state);
  assert.equal(callback.searchParams.get('iss'), base);
  const code = callback.searchParams.get('code');
  assert.ok(code);
  return code;
}

function exchange(auth: ReturnType<typeof authorization>, code: string, overrides: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return request('/oauth/token', form({
    grant_type: 'authorization_code', code, client_id: auth.client, redirect_uri: auth.callback,
    resource, code_verifier: auth.verifier, ...overrides,
  }, headers));
}

async function connect(client: string, account: typeof owner, allowWrite: boolean, scope = write) {
  const auth = authorization(client, scope);
  const response = await exchange(auth, await approve(auth, account, allowWrite));
  assert.equal(response.status, 200, JSON.stringify(response.data?.error ?? ''));
  return response.data as { access_token: string; refresh_token: string; scope: string };
}

function rpc(token: string, method: string, params?: Record<string, unknown>, id: number | null = 1) {
  return request('/mcp', jsonPost(
    { jsonrpc: '2.0', ...(id !== null ? { id } : {}), method, ...(params ? { params } : {}) },
    { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
  ));
}

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(token, 'tools/call', { name, arguments: args });
  assert.equal(response.status, 200, name);
  assert.ok(response.data.result, JSON.stringify(response.data.error ?? ''));
  const result = response.data.result;
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

function refresh(clientId: string, value: string, scope?: string) {
  return request('/oauth/token', form({
    grant_type: 'refresh_token', client_id: clientId, refresh_token: value, resource,
    ...(scope !== undefined ? { scope } : {}),
  }));
}

describe('remote MCP and OAuth', { skip: process.env.D1_TARGET === 'remote' }, () => {
  before(() => {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 864e5).toISOString();
    d1(users.map((u) => `
      INSERT INTO users (id, username, name, org_domain, created_at, updated_at)
        VALUES ('${u.id}', '${u.username}', 'Integration user', ${u.domain ? `'${u.domain}'` : 'NULL'}, '${now}', '${now}');
      INSERT INTO sessions (id, user_id, client, created_at, expires_at)
        VALUES ('${sha(u.session)}', '${u.id}', 'web', '${now}', '${expires}');
    `).join('\n'));
  });

  after(() => {
    d1(`DELETE FROM users WHERE id IN (${users.map((u) => `'${u.id}'`).join(',')});` +
      `DELETE FROM rate_limits WHERE key LIKE '%:${testIp}';` +
      (clients.length ? `DELETE FROM oauth_clients WHERE id IN (${clients.map((id) => `'${id}'`).join(',')});` : ''));
  });

  test('discovery, explicit consent, exact callback, cookie CSRF and PKCE', async () => {
    const unauthenticated = await request('/mcp');
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate') ?? '', /resource_metadata=".*oauth-protected-resource\/mcp"/);
    const metadata = await request('/.well-known/oauth-protected-resource/mcp');
    assert.equal(metadata.status, 200);
    assert.equal(metadata.data.resource, resource);
    assert.deepEqual(metadata.data.authorization_servers, [base]);
    const server = await request('/.well-known/oauth-authorization-server');
    assert.equal(server.data.issuer, base);
    assert.equal(server.data.authorization_endpoint, base + '/oauth/authorize');
    assert.deepEqual(server.data.code_challenge_methods_supported, ['S256']);
    assert.equal((await request('/mcp', { headers: { origin: 'https://example.invalid' } })).status, 403);
    const preflight = await request('/mcp', { method: 'OPTIONS', headers: { origin: base } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), base);
    assert.equal((await rpc(owner.session, 'tools/list')).status, 401);

    const bad = await request('/oauth/register', jsonPost({ redirect_uris: ['http://example.invalid/callback'] }));
    assert.equal(bad.data.error, 'invalid_redirect_uri');
    const client = (await register()).client_id;
    const auth = authorization(client, read, 'http://127.0.0.1:5678/oauth/callback');
    const path = '/api/oauth/authorize?' + auth.query;
    assert.equal((await request(path)).data.writeRequested, false);
    assert.equal((await request(path, jsonPost({ approve: true }))).status, 403);
    assert.equal((await request(path, jsonPost({ approve: true }, { ...consentHeaders(owner), cookie: '' }))).status, 401);
    assert.equal((await request(path, jsonPost({ approve: true }, { ...consentHeaders(owner), origin: 'https://example.invalid' }))).status, 403);
    const denied = await request(path, jsonPost({ approve: false }, consentHeaders(owner)));
    assert.equal(new URL(denied.data.redirectTo).searchParams.get('error'), 'access_denied');
    const badRedirect = authorization(client, read, 'http://127.0.0.1:5678/another');
    const invalid = await request('/api/oauth/authorize?' + badRedirect.query);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error.details?.redirectTo, undefined);
    const code = await approve(auth, owner, true);
    const wrongClient = (await register()).client_id;
    assert.equal((await exchange(auth, code, { client_id: wrongClient })).data.error, 'invalid_grant');
    assert.equal((await exchange(auth, code, { code_verifier: randomBytes(32).toString('base64url') })).data.error, 'invalid_grant');
    assert.equal((await exchange(auth, code, { redirect_uri: redirect })).data.error, 'invalid_grant');
    assert.equal((await exchange(auth, code, { resource: base + '/api' })).data.error, 'invalid_target');
    const raced = await Promise.all([exchange(auth, code), exchange(auth, code)]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 400]);
    const token = raced.find((r) => r.status === 200)!.data;
    assert.equal(token.scope, read);
    assert.equal((await rpc(token.access_token, 'tools/call', { name: 'create_solution' })).status, 403);
    assert.equal((await rpc(token.refresh_token, 'tools/list')).status, 401);
    assert.equal((await request('/api/me', { headers: { authorization: `Bearer ${token.access_token}` } })).status, 401);
    assert.equal((await request('/mcp', { headers: { authorization: `Bearer ${token.access_token}` } })).status, 405);

    const alternate = new URL(resource);
    alternate.hostname = alternate.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    const wrongAudience = await fetch(alternate, { headers: { authorization: `Bearer ${token.access_token}` } });
    assert.equal(wrongAudience.status, 401);
  });

  test('trusted metadata identifiers and confidential client credentials', async () => {
    const codex = authorization('https://chatgpt.com/oauth/codex/client.json', read, 'http://127.0.0.1:6000/callback');
    const chatgpt = authorization('https://chatgpt.com/oauth/client.json', read, 'https://chatgpt.com/connector_platform_oauth_redirect');
    for (const [auth, name] of [[codex, 'Codex'], [chatgpt, 'ChatGPT']] as const) {
      const result = await request('/api/oauth/authorize?' + auth.query);
      assert.equal(result.status, 200);
      assert.equal(result.data.client.name, name);
      assert.equal(result.data.client.verified, true);
    }
    const unknown = authorization('https://example.invalid/unreviewed.json');
    assert.equal((await request('/api/oauth/authorize?' + unknown.query)).status, 400);

    const registered = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    assert.equal(typeof registered.client_secret, 'string');
    const auth = authorization(registered.client_id, read);
    const code = await approve(auth, owner, false);
    assert.equal((await exchange(auth, code)).status, 401);
    assert.equal((await exchange(auth, code, { client_secret: registered.client_secret! })).status, 401);
    const basic = 'Basic ' + Buffer.from(registered.client_id + ':' + registered.client_secret).toString('base64');
    const result = await exchange(auth, code, {}, { authorization: basic });
    assert.equal(result.status, 200);
    assert.equal(result.data.scope, read);
  });

  test('tools, history, prompts and categories enforce visibility and ownership', async () => {
    const client = (await register()).client_id;
    const [own, same, other, outside] = await Promise.all([
      connect(client, owner, true), connect(client, member, true), connect(client, outsider, true), connect(client, personal, true),
    ]);
    const access = own.access_token;
    assert.equal(own.scope, write);
    const initialized = await rpc(access, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(initialized.data.result.serverInfo.name, 'solutionhub');
    assert.match(initialized.data.result.instructions, /untrusted data/);
    assert.equal((await rpc(access, 'notifications/initialized', undefined, null)).status, 202);
    assert.equal((await rpc(access, 'tools/list')).data.result.tools.length, 9);
    assert.equal((await rpc(access, 'prompts/list')).data.result.prompts.length, 4);
    const prompt = await rpc(access, 'prompts/get', { name: 'discover_solutions', arguments: { topic: 'translation' } });
    assert.match(prompt.data.result.messages[0].content.text, /translation/);
    const resources = (await rpc(access, 'resources/list')).data.result.resources;
    assert.equal(resources.length, 3);
    for (const r of resources) {
      assert.equal((await rpc(access, 'resources/read', { uri: r.uri })).data.result.contents[0].uri, r.uri);
    }
    const missingResource = await rpc(outside.access_token, 'resources/read', { uri: 'solutionhub://solutions/private' });
    assert.equal(missingResource.data.error.code, -32602);
    assert.deepEqual(missingResource.data.error.data, { uri: 'solutionhub://solutions/private' }, missingResource.data.error.message);

    const sample = {
      title: `MCP fixture ${run}`, descriptionMd: `Original content ${run}`,
      resources: [{ url: 'https://example.invalid/source', label: 'Source' }],
    };
    const pub = await tool(access, 'create_solution', { ...sample, visibility: 'public' });
    const sharedTag = `mcp-shared-${run}`;
    const shared = await tool(access, 'create_solution', { ...sample, visibility: 'organization', category: [sharedTag] });
    const priv = await tool(access, 'create_solution', sample);
    assert.equal(priv.visibility, 'private');
    assert.equal(priv.owner.username, owner.username);
    assert.equal(priv.owner.email, undefined);
    assert.equal((await tool(outside.access_token, 'create_solution', { ...sample, visibility: 'organization' })).error.code, 'validation_failed');
    assert.equal((await tool(access, 'create_solution', { ...sample, owner: outsider.username })).error.code, 'validation_failed');
    assert.equal((await tool(access, 'get_solution', { solution: 'https://example.invalid/' + priv.ref })).error.code, 'validation_failed');
    assert.equal((await tool(same.access_token, 'get_solution', { solution: shared.url })).id, shared.id);
    assert.equal((await tool(other.access_token, 'get_solution', { solution: shared.id })).error.code, 'not_found');
    assert.equal((await tool(other.access_token, 'get_solution', { solution: pub.ref })).resources[0].url, sample.resources[0]!.url);
    assert.equal((await tool(same.access_token, 'get_solution', { solution: priv.id })).error.code, 'not_found');
    assert.equal((await tool(same.access_token, 'get_solution_updates', { solution: priv.id })).error.code, 'not_found');
    assert.equal((await tool(other.access_token, 'get_solution_updates', { solution: shared.id })).error.code, 'not_found');
    assert.equal((await tool(same.access_token, 'update_solution', { solution: pub.id, title: 'Unauthorised' })).error.code, 'forbidden');
    assert.equal((await tool(same.access_token, 'update_solution', { solution: priv.id, title: 'Unauthorised' })).error.code, 'not_found');
    for (const [token, total] of [[access, 3], [same.access_token, 2], [other.access_token, 1]] as const) {
      const results = await tool(token, 'search_solutions', { query: run, owner: owner.username, limit: 1 });
      assert.equal(results.total, total);
      assert.equal(results.items.length, 1);
      const profile = await tool(token, 'get_profile', { username: owner.username });
      assert.equal(profile.counts.total, total);
      assert.equal(profile.email, undefined);
    }
    const seesTag = async (token: string) =>
      (await tool(token, 'list_categories')).category.some((item: { value: string }) => item.value === sharedTag);
    assert.equal(await seesTag(same.access_token), true);
    assert.equal(await seesTag(other.access_token), false);

    assert.equal((await tool(access, 'update_solution', {
      solution: priv.ref,
      summary: 'Polished description',
      changeNote: 'Clarified what the demo covers.',
    })).summary, 'Polished description');
    await tool(access, 'add_progress_update', { solution: priv.id, message: 'Tests passed' });
    assert.equal((await tool(access, 'change_solution_status', {
      solution: priv.id,
      status: 'completed',
      changeNote: 'The demo passed its acceptance checks.',
      message: 'Delivered',
    })).status, 'completed');
    const history = (await tool(access, 'get_solution_updates', { solution: priv.id })).items;
    assert.deepEqual(new Set(history.map((event: { eventType: string }) => event.eventType)), new Set(['created', 'edited', 'progress_updated', 'status_changed']));
    assert.ok(history.some((event: { message: string }) => event.message === 'Delivered'));
    assert.equal(history.find((event: { eventType: string }) => event.eventType === 'edited').changes.note, 'Clarified what the demo covers.');
    assert.equal(history.find((event: { eventType: string }) => event.eventType === 'status_changed').changes.note, 'The demo passed its acceptance checks.');
    assert.equal((await tool(access, 'get_solution', { solution: priv.id, history_limit: 2 })).history.length, 2);
    const reopened = await tool(access, 'change_solution_status', {
      solution: priv.id,
      status: 'ongoing',
      changeNote: 'A note supplied to a reopen request',
      message: 'A progress message supplied to a reopen request',
    });
    assert.equal(reopened.status, 'ongoing');
    assert.equal(reopened.completedAt, null);
    assert.deepEqual((await tool(access, 'get_solution_updates', { solution: priv.id })).items, history);
  });

  test('scope downgrade, refresh rotation, revocation, and expiration', async () => {
    const name = `Scope lifecycle ${run}`;
    const client = (await register({ client_name: name })).client_id;
    const initial = await connect(client, owner, true);
    const headers = consentHeaders(owner);
    const connections = await request('/api/mcp/connections', { headers });
    const grant = connections.data.items.find((item: { clientName: string }) => item.clientName === name);
    assert.ok(grant);
    const id = grant.id;
    assert.equal((await request('/api/mcp/connections/' + id, { method: 'DELETE', headers: consentHeaders(outsider) })).status, 404);
    assert.equal((await request('/api/mcp/connections/' + id, { method: 'PATCH', headers: { cookie: headers.cookie } })).status, 403);
    assert.equal((await request('/api/mcp/connections/' + id, { method: 'PATCH', headers })).status, 204);
    const writeArgs = { name: 'create_solution', arguments: { title: 'Scope test', descriptionMd: 'Test' } };
    const blocked = await rpc(initial.access_token, 'tools/call', writeArgs);
    assert.equal(blocked.status, 403);
    assert.match(blocked.headers.get('www-authenticate') ?? '', /insufficient_scope/);
    assert.equal((await rpc(initial.access_token, 'tools/list')).status, 200);

    const fresh = await connect(client, owner, true);
    assert.equal((await rpc(initial.access_token, 'tools/call', writeArgs)).status, 403);
    assert.equal((await refresh(client, initial.refresh_token, write)).data.error, 'invalid_scope');
    const rotation = await Promise.all([refresh(client, initial.refresh_token), refresh(client, initial.refresh_token)]);
    assert.deepEqual(rotation.map((r) => r.status).sort(), [200, 400]);
    const rotated = rotation.find((r) => r.status === 200)!;
    assert.equal(rotated.data.scope, read);
    assert.equal((await refresh(client, initial.refresh_token)).data.error, 'invalid_grant');
    assert.equal((await rpc(rotated.data.access_token, 'tools/list')).status, 401);
    assert.equal((await rpc(fresh.access_token, 'tools/list')).status, 200);

    const wrongClient = (await register()).client_id;
    assert.equal((await request('/oauth/revoke', form({ client_id: wrongClient, token: fresh.access_token }))).status, 200);
    assert.equal((await rpc(fresh.access_token, 'tools/list')).status, 200);
    assert.equal((await request('/oauth/revoke', form({ client_id: client, token: fresh.access_token }))).status, 200);
    assert.equal((await rpc(fresh.access_token, 'tools/list')).status, 401);
    const active = await refresh(client, fresh.refresh_token);
    assert.equal(active.status, 200);
    d1(`UPDATE oauth_tokens SET expires_at = '2000-01-01' WHERE id = '${sha(active.data.access_token)}';`);
    assert.equal((await rpc(active.data.access_token, 'tools/list')).status, 401);
    const latest = await refresh(client, active.data.refresh_token);
    assert.equal(latest.status, 200);
    assert.equal((await request('/api/mcp/connections/' + id, { method: 'DELETE', headers })).status, 204);
    assert.equal((await rpc(latest.data.access_token, 'tools/list')).status, 401);
    assert.equal((await refresh(client, latest.data.refresh_token)).data.error, 'invalid_grant');
  });
});
