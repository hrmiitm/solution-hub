/**
 * REST API routing. Handlers are thin: they authenticate, parse/validate HTTP
 * input, then call services/*, which own business rules and authorization.
 */
import { GoogleTokenVerifier } from './auth/google.ts';
import { SESSION_TTL_SECONDS, createSession, resolveSession, revokeSession, type SessionClient } from './auth/sessions.ts';
import { listConnections, makeConnectionReadOnly, revokeConnection } from './auth/oauth.ts';
import type { Actor, Env } from './env.ts';
import { assertCsrfSafe, json, readCookie, readJson, sessionCookie, sessionCookieName } from './http.ts';
import { AppError } from './lib/errors.ts';
import { clientIp, enforceClientLimit } from './lib/ratelimit.ts';
import { splitList } from './lib/util.ts';
import { searchQuery, validateConsentDecision, validateSolutionInput, validateUpdateMessage, visibilityQuery } from './lib/validation.ts';
import { checkAuthorizationRequest, decideAuthorization, describeAuthorizationRequest, mcpResource } from './oauth.ts';
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
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * auth: 'required' (default) needs a session; 'optional' also serves anonymous
 * visitors (services then only expose public data); 'none' skips session lookup.
 */
type AuthMode = 'required' | 'optional' | 'none';
interface RouteOptions {
  auth?: AuthMode;
  sameOrigin?: boolean;
  /** Sign-in and consent endpoints use the per-IP auth rate limit instead of the user/anonymous one. */
  authEndpoint?: boolean;
}
const routes: ({ method: Method; pattern: RegExp; keys: string[]; handler: Handler; auth: AuthMode } & RouteOptions)[] = [];

function route(method: Method, path: string, handler: Handler, opts: RouteOptions = {}) {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
      keys.push(k);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ ...opts, method, pattern, keys, handler, auth: opts.auth ?? 'required' });
}

const authEndpoint = { auth: 'none', authEndpoint: true } as const;

// --- auth ------------------------------------------------------------------

route(
  'POST',
  '/api/auth/google',
  async ({ request, env }) => {
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
  authEndpoint,
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
  authEndpoint,
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

route('GET', '/api/me/liked-solutions', async ({ env, actor, url }) =>
  json(await solutions.searchSolutions(env.DB, actor(), searchQuery(url.searchParams), true)),
);

// --- MCP connector consent and management -----------------------------------

route('GET', '/api/oauth/authorize', async ({ env, url }) =>
  json(describeAuthorizationRequest(await checkAuthorizationRequest(env, url))), authEndpoint);

route('POST', '/api/oauth/authorize', async ({ env, url, request }) => {
  if (request.headers.get('origin') !== url.origin) throw new AppError('forbidden', 'Cross-origin request rejected');
  assertCsrfSafe(request, env);
  const cookie = readCookie(request, sessionCookieName(request));
  const actor = cookie ? await resolveSession(env.DB, cookie) : null;
  if (!actor) throw new AppError('unauthorized', 'Sign in with Google to connect');
  const decision = validateConsentDecision(await readJson(request));
  const authorization = await checkAuthorizationRequest(env, url);
  return json({ redirectTo: await decideAuthorization(env.DB, url, actor, authorization, decision.approve, decision.write) });
}, authEndpoint);

route('GET', '/api/mcp/connections', async ({ env, actor, url }) => json({ items: await listConnections(env.DB, actor(), mcpResource(url)) }));

route('DELETE', '/api/mcp/connections/:id', async ({ env, actor, params, url }) => {
  await revokeConnection(env.DB, actor(), params.id!, mcpResource(url));
  return new Response(null, { status: 204 });
});

route('PATCH', '/api/mcp/connections/:id', async ({ env, actor, params, url }) => {
  await makeConnectionReadOnly(env.DB, actor(), params.id!, mcpResource(url));
  return new Response(null, { status: 204 });
});

// --- users -----------------------------------------------------------------

const optional = { auth: 'optional' } as const;

route('GET', '/api/users/:username', async ({ env, viewer, params }) => json(await getProfile(env.DB, viewer, params.username!)), optional);

route(
  'GET',
  '/api/users/:username/solutions',
  async ({ env, viewer, params, url }) => {
    await getProfile(env.DB, viewer, params.username!); // 404 for unknown users
    return json(await solutions.searchSolutions(env.DB, viewer, { ...searchQuery(url.searchParams), owner: params.username! }));
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

route('GET', '/api/solutions', async ({ env, viewer, url }) => json(await solutions.searchSolutions(env.DB, viewer, searchQuery(url.searchParams))), optional);

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

route('PUT', '/api/solutions/:id/like', async ({ env, actor, params }) =>
  json(await solutions.setSolutionLike(env.DB, actor(), params.id!, true)), { sameOrigin: true },
);

route('DELETE', '/api/solutions/:id/like', async ({ env, actor, params }) =>
  json(await solutions.setSolutionLike(env.DB, actor(), params.id!, false)), { sameOrigin: true },
);

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
  async ({ env, viewer, url }) => json(await solutions.listCategories(env.DB, viewer, visibilityQuery(url.searchParams))),
  optional,
);

// --- helpers ---------------------------------------------------------------

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
  const ip = clientIp(request);

  const candidates = routes.filter((r) => r.pattern.test(url.pathname));
  const match = candidates.find((r) => r.method === request.method);
  if (!match) {
    enforceClientLimit(env, 'anonymous', ip);
    throw candidates.length ? new AppError('method_not_allowed', 'Method not allowed') : new AppError('not_found', 'Endpoint not found');
  }

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
  if (match.authEndpoint) enforceClientLimit(env, 'auth', ip);
  else if (match.auth !== 'none') {
    const auth = await authenticate(request, env);
    actor = auth.actor;
    // One shared allowance per user across REST and MCP; per IP otherwise.
    if (actor) enforceClientLimit(env, 'user', actor.userId);
    else enforceClientLimit(env, 'anonymous', ip);
    if (!actor && match.auth === 'required') throw new AppError('unauthorized', 'Sign in required');
    if (actor && request.method !== 'GET') {
      if (auth.viaCookie && (match.sameOrigin || url.pathname.startsWith('/api/mcp/')) && request.headers.get('origin') !== url.origin) {
        throw new AppError('forbidden', 'Cross-origin request rejected');
      }
      if (auth.viaCookie) assertCsrfSafe(request, env);
    }
  } else enforceClientLimit(env, 'anonymous', ip);

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
