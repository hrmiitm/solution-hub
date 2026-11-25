/**
 * REST API routing. Handlers are thin: they authenticate, parse/validate HTTP
 * input, then call services/*, which own business rules and authorization.
 */
import { GoogleTokenVerifier } from './auth/google.ts';
import { SESSION_TTL_SECONDS, createSession, resolveSession, revokeSession, type SessionClient } from './auth/sessions.ts';
import type { Actor, Env } from './env.ts';
import { assertCsrfSafe, json, readCookie, readJson, sessionCookie, sessionCookieName } from './http.ts';
import { AppError } from './lib/errors.ts';
import { enforceMemoryRateLimit, enforceRateLimit } from './lib/ratelimit.ts';
import { splitList } from './lib/util.ts';
import { STATUSES, VISIBILITIES, validateSolutionInput, validateUpdateMessage, type Status, type Visibility } from './lib/validation.ts';
import type { Viewer } from './services/access.ts';
import * as solutions from './services/solutions.ts';
import { getProfile, upsertGoogleUser, type UserRow } from './services/users.ts';

const verifier = new GoogleTokenVerifier();

interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** The signed-in actor, or null for anonymous visitors (optional-auth routes). */
  viewer: Viewer;
  /** Authenticated actor; throws 401 if absent. */
  actor: () => Actor;
}

type Handler = (ctx: Ctx) => Promise<Response>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * auth: 'required' (default) needs a session; 'optional' also serves anonymous
 * visitors (services then only expose public data); 'none' skips session lookup.
 */
type AuthMode = 'required' | 'optional' | 'none';
const routes: { method: Method; pattern: RegExp; keys: string[]; handler: Handler; auth: AuthMode }[] = [];

function route(method: Method, path: string, handler: Handler, opts: { auth?: AuthMode } = {}) {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
      keys.push(k);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, pattern, keys, handler, auth: opts.auth ?? 'required' });
}

const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'local';

// --- auth ------------------------------------------------------------------

route(
  'POST',
  '/api/auth/google',
  async ({ request, env }) => {
    await enforceRateLimit(env.DB, `auth:${clientIp(request)}`, 60, 600);
    const body = (await readJson(request)) as { idToken?: unknown; client?: unknown };
    const client: SessionClient = body.client === 'native' ? 'native' : 'web';
    // Web logins set a cookie, so they get the same origin checks as other
    // cookie-based mutations (prevents login CSRF).
    if (client === 'web' || request.headers.get('origin')) assertCsrfSafe(request, env);
    if (typeof body.idToken !== 'string') throw new AppError('bad_request', 'idToken is required');

    const identity = await verifier.verify(body.idToken, splitList(env.GOOGLE_CLIENT_IDS));
    const user = await upsertGoogleUser(env.DB, identity);
    const session = await createSession(env.DB, user.id, client);
    const payload = { user: meBody(user), ...(client === 'native' ? { token: session.token, expiresAt: session.expiresAt } : {}) };
    return json(payload, 200, client === 'web' ? { 'set-cookie': sessionCookie(request, session.token, SESSION_TTL_SECONDS) } : {});
  },
  { auth: 'none' },
);

route(
  'POST',
  '/api/auth/logout',
  async ({ request, env }) => {
    const bearer = bearerToken(request);
    const cookie = readCookie(request, sessionCookieName(request));
    if (!bearer && cookie) assertCsrfSafe(request, env);
    const token = bearer ?? cookie;
    if (token) await revokeSession(env.DB, token);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  },
  { auth: 'none' },
);

const meBody = (u: Pick<UserRow, 'username' | 'name' | 'email' | 'avatar_url' | 'org_domain'>) => ({
  username: u.username,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatar_url,
  /** Verified Google Workspace domain; null means organization visibility is unavailable. */
  orgDomain: u.org_domain,
});

route('GET', '/api/me', async ({ env, actor }) => {
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?1`).bind(actor().userId).first<UserRow>();
  if (!user) throw new AppError('unauthorized', 'Not signed in');
  return json({ user: meBody(user) });
});

// --- users -----------------------------------------------------------------

const optional = { auth: 'optional' } as const;

route('GET', '/api/users/:username', async ({ env, viewer, params }) => json(await getProfile(env.DB, viewer, params.username!)), optional);

route(
  'GET',
  '/api/users/:username/solutions',
  async ({ env, viewer, params, url }) => {
    await getProfile(env.DB, viewer, params.username!); // 404 for unknown users
    return json(await solutions.searchSolutions(env.DB, viewer, { ...searchParams(url), owner: params.username! }));
  },
  optional,
);

// Resolves the shareable /:username/:slug URL of a solution.
route(
  'GET',
  '/api/users/:username/solutions/:slug',
  async ({ env, viewer, params }) => json(await solutions.getSolutionByPath(env.DB, viewer, params.username!, params.slug!)),
  optional,
);

// --- solutions -------------------------------------------------------------

route('GET', '/api/solutions', async ({ env, viewer, url }) => json(await solutions.searchSolutions(env.DB, viewer, searchParams(url))), optional);

route('POST', '/api/solutions', async ({ request, env, actor }) => {
  const input = validateSolutionInput(await readJson(request), false);
  return json(await solutions.createSolution(env.DB, actor(), input), 201);
});

route('GET', '/api/solutions/:id', async ({ env, viewer, params }) => json(await solutions.getSolution(env.DB, viewer, params.id!)), optional);

route('PATCH', '/api/solutions/:id', async ({ request, env, actor, params }) => {
  const input = validateSolutionInput(await readJson(request), true);
  return json(await solutions.updateSolution(env.DB, actor(), params.id!, input));
});

route('DELETE', '/api/solutions/:id', async ({ env, actor, params }) => {
  await solutions.deleteSolution(env.DB, actor(), params.id!);
  return new Response(null, { status: 204 });
});

route(
  'GET',
  '/api/solutions/:id/updates',
  async ({ env, viewer, params }) => json({ items: await solutions.listUpdates(env.DB, viewer, params.id!) }),
  optional,
);

route('POST', '/api/solutions/:id/updates', async ({ request, env, actor, params }) => {
  const message = validateUpdateMessage(await readJson(request));
  return json({ items: await solutions.addProgressUpdate(env.DB, actor(), params.id!, message) }, 201);
});

route(
  'GET',
  '/api/categories',
  async ({ env, viewer, url }) => json(await solutions.listCategories(env.DB, viewer, visibilityParam(url))),
  optional,
);

// --- helpers ---------------------------------------------------------------

function listParam(url: URL, key: string): string[] | undefined {
  const values = url.searchParams
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim().slice(0, 50))
    .filter(Boolean)
    .slice(0, 10);
  return values.length ? values : undefined;
}

function visibilityParam(url: URL): Visibility[] | undefined {
  const values = (listParam(url, 'visibility') ?? []).filter((v): v is Visibility => (VISIBILITIES as readonly string[]).includes(v));
  return values.length ? values : undefined;
}

function searchParams(url: URL): solutions.SearchParams {
  const q = url.searchParams;
  const status = q.get('status');
  const sort = q.get('sort');
  return {
    q: (q.get('q') ?? '').slice(0, 200),
    status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as Status) : undefined,
    visibility: visibilityParam(url),
    types: listParam(url, 'type'),
    industry: listParam(url, 'industry'),
    function: listParam(url, 'function'),
    category: listParam(url, 'category'),
    technology: listParam(url, 'technology'),
    sort: ['relevance', 'updated', 'created', 'oldest'].includes(sort ?? '') ? (sort as solutions.SearchParams['sort']) : undefined,
    page: Number.parseInt(q.get('page') ?? '1', 10) || 1,
    limit: Number.parseInt(q.get('limit') ?? '24', 10) || 24,
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const m = header?.match(/^Bearer\s+([A-Za-z0-9_-]{20,128})$/);
  return m?.[1] ?? null;
}

/** Resolves the session from a bearer token (native app) or cookie (web). */
async function authenticate(request: Request, env: Env): Promise<{ actor: Actor | null; viaCookie: boolean }> {
  const bearer = bearerToken(request);
  if (bearer) return { actor: await resolveSession(env.DB, bearer), viaCookie: false };
  const cookie = readCookie(request, sessionCookieName(request));
  if (cookie) return { actor: await resolveSession(env.DB, cookie), viaCookie: true };
  return { actor: null, viaCookie: false };
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  enforceMemoryRateLimit(`ip:${clientIp(request)}`, 1800, 60);

  const candidates = routes.filter((r) => r.pattern.test(url.pathname));
  if (!candidates.length) throw new AppError('not_found', 'Endpoint not found');
  const match = candidates.find((r) => r.method === request.method);
  if (!match) throw new AppError('method_not_allowed', 'Method not allowed');

  const values = match.pattern.exec(url.pathname)!.slice(1);
  const params: Record<string, string> = {};
  try {
    match.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(values[i] ?? '');
    });
  } catch {
    throw new AppError('bad_request', 'Malformed URL');
  }

  let actor: Actor | null = null;
  if (match.auth !== 'none') {
    const auth = await authenticate(request, env);
    actor = auth.actor;
    if (!actor && match.auth === 'required') throw new AppError('unauthorized', 'Sign in required');
    if (actor && request.method !== 'GET') {
      if (auth.viaCookie) assertCsrfSafe(request, env);
      await enforceRateLimit(env.DB, `write:${actor.userId}`, 360, 600);
    }
  }

  return match.handler({
    request,
    env,
    url,
    params,
    viewer: actor,
    actor: () => {
      if (!actor) throw new AppError('unauthorized', 'Sign in required');
      return actor;
    },
  });
}
