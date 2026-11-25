/**
 * OAuth 2.1 HTTP endpoints for MCP connectors.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728 resource metadata
 *   GET  /.well-known/oauth-authorization-server      RFC 8414 server metadata
 *   POST /oauth/register                              RFC 7591 dynamic registration
 *   GET  /oauth/authorize                             consent page (Flutter route; it calls /api/oauth/authorize)
 *   POST /oauth/token                                 authorization_code (PKCE S256) and refresh_token
 *   POST /oauth/revoke                                RFC 7009 revocation
 *
 * The consent page signs people in with the existing Google sign-in, so
 * identity always comes from a verified Google ID token.
 */
import {
  OAuthError,
  SCOPE_READ,
  SCOPE_WRITE,
  SUPPORTED_SCOPES,
  authorize,
  exchangeCode,
  getClient,
  grantableScopes,
  parseScopes,
  redirectUriAllowed,
  refreshTokens,
  registerClient,
  revokeToken,
  validCodeChallenge,
  verifyClientSecret,
  type OAuthClient,
  type Scope,
} from './auth/oauth.ts';
import type { Actor, Env } from './env.ts';
import { readBoundedText } from './http.ts';
import { AppError } from './lib/errors.ts';
import { enforceRateLimit } from './lib/ratelimit.ts';
import { splitList } from './lib/util.ts';
import { ClientMetadataError, isLoopbackHost, redirectHost, validateClientMetadata, type ClientAuthMethod } from './lib/validation.ts';

export const MCP_PATH = '/mcp';

export const mcpResource = (url: URL) => `${url.origin}${MCP_PATH}`;
export const resourceMetadataUrl = (url: URL) => `${url.origin}/.well-known/oauth-protected-resource${MCP_PATH}`;

// The published client documents use stable callbacks (loopback port may vary
// for Codex). Keep these trusted registrations available when the metadata
// host blocks machine-to-machine fetches.
const BUILTIN_CLIENTS = {
  'https://chatgpt.com/oauth/client.json': {
    client_name: 'ChatGPT',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  },
  'https://chatgpt.com/oauth/codex/client.json': {
    client_name: 'Codex',
    redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
  },
};

const PUBLIC_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-expose-headers': 'www-authenticate',
  'access-control-max-age': '600',
};

function oauthJson(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', ...PUBLIC_CORS, ...headers },
  });
}

const oauthError = (err: OAuthError) =>
  oauthJson({ error: err.error, error_description: err.message }, err.status, err.status === 401 ? { 'www-authenticate': 'Basic realm="SolutionHub"' } : {});

export function protectedResourceMetadata(url: URL) {
  return {
    resource: mcpResource(url),
    authorization_servers: [url.origin],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'SolutionHub',
    resource_documentation: `${url.origin}/`,
  };
}

export function authorizationServerMetadata(url: URL) {
  const o = url.origin;
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${o}/`,
  };
}

/**
 * RFC 8707 resource indicator. This server has exactly one protected
 * resource, the MCP endpoint; its origin is accepted as an alias.
 * Returns the canonical resource, or null if the value names something else.
 */
export function canonicalResource(url: URL, raw: string | null): string | null {
  const canonical = mcpResource(url);
  if (raw === null) return canonical;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === canonical || trimmed === url.origin ? canonical : null;
}

export const isOAuthPath = (pathname: string) =>
  pathname.startsWith('/.well-known/oauth-') || pathname === '/oauth/register' || pathname === '/oauth/token' || pathname === '/oauth/revoke';

const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'local';

export async function handleOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PUBLIC_CORS });

  if (path === '/.well-known/oauth-protected-resource' || path === `/.well-known/oauth-protected-resource${MCP_PATH}`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return oauthJson({ error: 'method_not_allowed' }, 405);
    return oauthJson(protectedResourceMetadata(url), 200, { 'cache-control': 'public, max-age=3600' });
  }
  if (path === '/.well-known/oauth-authorization-server') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return oauthJson({ error: 'method_not_allowed' }, 405);
    return oauthJson(authorizationServerMetadata(url), 200, { 'cache-control': 'public, max-age=3600' });
  }
  if (!['/oauth/register', '/oauth/token', '/oauth/revoke'].includes(path)) return oauthJson({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return oauthJson({ error: 'invalid_request', error_description: 'Use POST' }, 405, { allow: 'POST' });

  try {
    if (path === '/oauth/register') return await register(request, env);
    if (path === '/oauth/token') return await token(request, env, url);
    return await revoke(request, env, url);
  } catch (err) {
    if (err instanceof OAuthError) return oauthError(err);
    if (err instanceof AppError && err.code === 'rate_limited') return oauthJson({ error: 'slow_down', error_description: err.message }, 429);
    if (err instanceof AppError && err.status < 500) return oauthJson({ error: 'invalid_request', error_description: err.message }, 400);
    console.error('SolutionHub OAuth request failed', path);
    return oauthJson({ error: 'server_error', error_description: 'Something went wrong' }, 500);
  }
}

/** Token and revocation requests are form-encoded (RFC 6749); JSON is accepted too. Repeated parameters are rejected. */
async function readParams(request: Request): Promise<Map<string, string>> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const text = await readBoundedText(request);
  const out = new Map<string, string>();
  if (type.startsWith('application/json')) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new OAuthError('invalid_request', 'Malformed JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new OAuthError('invalid_request', 'Body must be an object');
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out.set(k, v);
    return out;
  }
  if (!type.startsWith('application/x-www-form-urlencoded')) throw new OAuthError('invalid_request', 'Content-Type must be application/x-www-form-urlencoded');
  for (const [k, v] of new URLSearchParams(text)) {
    if (out.has(k)) throw new OAuthError('invalid_request', `Parameter ${k} is repeated`);
    out.set(k, v);
  }
  return out;
}

/** Client authentication: HTTP Basic (client_secret_basic), body secret (client_secret_post), or none (public + PKCE). */
async function authenticateClient(request: Request, db: D1Database, params: Map<string, string>): Promise<OAuthClient> {
  let clientId = params.get('client_id') ?? null;
  let secret = params.get('client_secret') ?? null;
  let method: ClientAuthMethod = secret === null ? 'none' : 'client_secret_post';
  const header = request.headers.get('authorization');
  if (header) {
    const basic = header.match(/^Basic +([A-Za-z0-9+/=]+)$/i);
    if (!basic || header.length > 4096) throw new OAuthError('invalid_client', 'Malformed client credentials', 401);
    if (secret !== null) throw new OAuthError('invalid_request', 'Use one client authentication method');
    try {
      const value = atob(basic[1]!);
      const separator = value.indexOf(':');
      if (separator < 0) throw new Error('Missing separator');
      const id = decodeURIComponent(value.slice(0, separator).replace(/\+/g, ' '));
      if (clientId !== null && clientId !== id) throw new Error('Mismatched client ids');
      clientId = id;
      secret = decodeURIComponent(value.slice(separator + 1).replace(/\+/g, ' '));
      method = 'client_secret_basic';
    } catch {
      throw new OAuthError('invalid_client', 'Malformed client credentials', 401);
    }
  }
  if (!clientId) throw new OAuthError('invalid_client', 'client_id is required', 401);
  const client = await getClient(db, clientId);
  if (!client || client.authMethod !== method || !(await verifyClientSecret(client, secret))) {
    throw new OAuthError('invalid_client', 'Unknown client or invalid client credentials', 401);
  }
  return client;
}

async function register(request: Request, env: Env): Promise<Response> {
  await enforceRateLimit(env.DB, `oauth-register:${clientIp(request)}`, 30, 3600);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new OAuthError('invalid_client_metadata', 'Content-Type must be application/json');
  }
  const text = await readBoundedText(request);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthJson({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400);
  }
  let meta;
  try {
    meta = validateClientMetadata(body);
  } catch (err) {
    if (err instanceof ClientMetadataError) return oauthJson({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
  const { client, secret, createdAt } = await registerClient(env.DB, meta);
  return oauthJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.parse(createdAt) / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: client.name,
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: meta.authMethod,
      scope: SUPPORTED_SCOPES.join(' '),
    },
    201,
  );
}

async function token(request: Request, env: Env, url: URL): Promise<Response> {
  await enforceRateLimit(env.DB, `oauth-token:${clientIp(request)}`, 300, 600);
  const params = await readParams(request);
  const client = await authenticateClient(request, env.DB, params);
  const resource = canonicalResource(url, params.get('resource') ?? null);
  if (!resource) throw new OAuthError('invalid_target', `Unknown resource; use ${mcpResource(url)}`);

  const grantType = params.get('grant_type');
  if (grantType === 'authorization_code') {
    return oauthJson(
      await exchangeCode(env.DB, {
        code: params.get('code') ?? '',
        clientId: client.id,
        redirectUri: params.get('redirect_uri') ?? null,
        verifier: params.get('code_verifier'),
        resource,
      }),
    );
  }
  if (grantType === 'refresh_token') {
    return oauthJson(
      await refreshTokens(env.DB, { refreshToken: params.get('refresh_token') ?? '', clientId: client.id, scope: params.get('scope') ?? null, resource }),
    );
  }
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

async function revoke(request: Request, env: Env, url: URL): Promise<Response> {
  await enforceRateLimit(env.DB, `oauth-token:${clientIp(request)}`, 300, 600);
  const params = await readParams(request);
  const token = params.get('token');
  if (!token) throw new OAuthError('invalid_request', 'token is required');
  const client = await authenticateClient(request, env.DB, params);
  await revokeToken(env.DB, token, client.id, mcpResource(url));
  return oauthJson({});
}

// ---------------------------------------------------------------------------
// Authorization requests, checked for the consent page (/api/oauth/authorize)

export interface AuthorizationRequest {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  /** Scopes that may be offered on the consent page. */
  requested: Scope[];
  resource: string;
}

/** Builds the redirect back to the client, with RFC 9207 `iss`. */
function redirectWith(url: URL, redirectUri: string, params: Record<string, string | null>): string {
  const target = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) target.searchParams.set(k, v);
  target.searchParams.set('iss', url.origin);
  return target.toString();
}

/**
 * Validates the query of /oauth/authorize. Problems with the client or its
 * redirect URI are shown to the user (never redirected, so we cannot be used
 * as an open redirector); everything else goes back to the client as an
 * OAuth error redirect (`details.redirectTo`).
 */
export async function checkAuthorizationRequest(env: Env, url: URL): Promise<AuthorizationRequest> {
  const query = url.searchParams;
  for (const key of new Set(query.keys())) {
    if (query.getAll(key).length > 1) throw new AppError('bad_request', `The ${key} parameter is repeated`);
  }
  const clientId = query.get('client_id') ?? '';
  // Fetch only exact reviewed URLs over public HTTPS. Other apps can use DCR.
  const builtin = Object.hasOwn(BUILTIN_CLIENTS, clientId) ? BUILTIN_CLIENTS[clientId as keyof typeof BUILTIN_CLIENTS] : undefined;
  const reviewed = !!builtin || splitList(env.OAUTH_CLIENT_METADATA_URLS).includes(clientId);
  let client: OAuthClient | null;
  try {
    client = await getClient(env.DB, clientId, {
      refresh: reviewed,
      ...(builtin ? { fetcher: async () => ({ client_id: clientId, ...builtin, token_endpoint_auth_method: 'none' }) } : {}),
    });
  } catch (err) {
    if (err instanceof OAuthError) throw new AppError('bad_request', err.message);
    throw err;
  }
  if (!client || (client.kind === 'cimd' && !reviewed)) {
    throw new AppError('bad_request', 'Unknown application (client_id). Use dynamic client registration or a supported client metadata document.');
  }
  const redirectUri = query.get('redirect_uri') ?? '';
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    throw new AppError('bad_request', 'The redirect_uri is not registered for this application.');
  }

  const rawState = query.get('state');
  if (rawState !== null && (rawState.length > 2048 || /[\u0000-\u001f\u007f]/.test(rawState))) {
    throw new AppError('bad_request', 'Invalid OAuth state');
  }
  const state = rawState;
  const fail = (error: string, description: string): never => {
    throw new AppError('bad_request', description, { redirectTo: redirectWith(url, redirectUri, { error, error_description: description, state }) });
  };
  if (query.get('response_type') !== 'code') fail('unsupported_response_type', 'response_type must be code');
  const codeChallenge = query.get('code_challenge');
  if (query.get('code_challenge_method') !== 'S256' || !validCodeChallenge(codeChallenge)) {
    fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  const resource = canonicalResource(url, query.get('resource'));
  if (!resource) fail('invalid_target', `Unknown resource; use ${mcpResource(url)}`);
  const rawScope = query.get('scope');
  const requested = rawScope === null ? [...SUPPORTED_SCOPES] : parseScopes(rawScope);
  if (!requested.length || (rawScope !== null && rawScope.split(' ').some((scope) => !(SUPPORTED_SCOPES as readonly string[]).includes(scope)))) {
    fail('invalid_scope', 'Unknown SolutionHub scope');
  }
  return { client, redirectUri, state, codeChallenge: codeChallenge!, requested, resource: resource! };
}

/** What the consent page shows. Client names are self-declared unless the client_id is a verified metadata URL. */
export function describeAuthorizationRequest(req: AuthorizationRequest) {
  let loopback = false;
  try {
    const u = new URL(req.redirectUri);
    loopback = u.protocol === 'http:' && isLoopbackHost(u.hostname);
  } catch {
    // validated earlier
  }
  return {
    client: {
      name: req.client.name,
      uri: req.client.clientUri,
      clientId: req.client.kind === 'cimd' ? req.client.id : null,
      verified: req.client.kind === 'cimd',
      redirectHost: redirectHost(req.redirectUri),
      /** Redirects to this computer (a CLI or desktop app). */
      loopback,
    },
    requestedScopes: req.requested,
    writeRequested: req.requested.includes(SCOPE_WRITE),
    resource: req.resource,
  };
}

/** Records the user's decision and returns where to send the browser. */
export async function decideAuthorization(db: D1Database, url: URL, actor: Actor, req: AuthorizationRequest, approve: boolean, write: boolean): Promise<string> {
  if (!approve) return redirectWith(url, req.redirectUri, { error: 'access_denied', error_description: 'The user denied access', state: req.state });
  const scopes = grantableScopes(write && req.requested.includes(SCOPE_WRITE));
  const code = await authorize(db, {
    userId: actor.userId,
    clientId: req.client.id,
    scopes,
    resource: req.resource,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
  });
  return redirectWith(url, req.redirectUri, { code, state: req.state });
}

export { SCOPE_READ, SCOPE_WRITE };
