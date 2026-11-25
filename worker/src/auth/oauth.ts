/**
 * OAuth 2.1 authorization server state for MCP connectors, stored in D1.
 *
 *  - Clients: dynamic registration (RFC 7591) or Client ID Metadata Documents.
 *  - Grants: one per (user, client), holding the scopes the user consented to.
 *  - Codes: single-use, PKCE S256, five minutes.
 *  - Tokens: opaque random strings; only SHA-256 hashes are stored. Access
 *    tokens last an hour, refresh tokens 30 days and rotate on every use.
 *
 * Scopes only narrow what a connector may do for its user; they never grant
 * more than the user has. Authorization of solution data stays in
 * services/access.ts. HTTP concerns live in ../oauth.ts.
 */
import type { Actor } from '../env.ts';
import { AppError } from '../lib/errors.ts';
import { base64UrlEncode, newId, nowIso, parseJsonArray, randomToken, sha256Hex } from '../lib/util.ts';
import { isLoopbackHost, validRedirectUri, validateClientMetadata, ClientMetadataError, type ClientAuthMethod, type ClientMetadata } from '../lib/validation.ts';

export const SCOPE_READ = 'solutions:read';
export const SCOPE_WRITE = 'solutions:write';
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;
export type Scope = (typeof SUPPORTED_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const CIMD_CACHE_SECONDS = 60 * 60;
const CIMD_MAX_BYTES = 16 * 1024;

/** Token prefixes make leaked tokens recognisable (scripts/check-secrets.sh). */
const ACCESS_PREFIX = 'shmcp_at_';
const REFRESH_PREFIX = 'shmcp_rt_';

/** An OAuth protocol error (RFC 6749 §5.2 / RFC 7009 / RFC 7591). */
export class OAuthError extends Error {
  readonly error: string;
  readonly status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

/** Known scopes from a space-separated list, in canonical order. Unknown ones are ignored (RFC 6749 §3.3). */
export function parseScopes(raw: unknown): Scope[] {
  const requested = new Set(typeof raw === 'string' ? raw.split(/\s+/) : []);
  return SUPPORTED_SCOPES.filter((s) => requested.has(s));
}

/** Read access is the base of every grant; write is the only optional extra. */
export function grantableScopes(write: boolean): Scope[] {
  return write ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}

export const formatScopes = (scopes: readonly string[]) => scopes.join(' ');

// ---------------------------------------------------------------------------
// Clients

export interface OAuthClient {
  id: string;
  kind: 'dcr' | 'cimd';
  name: string;
  clientUri: string | null;
  redirectUris: string[];
  authMethod: ClientAuthMethod;
  /** Set for confidential DCR clients; the token endpoint then requires the secret. */
  secretHash: string | null;
}

interface ClientRow {
  id: string;
  kind: 'dcr' | 'cimd';
  name: string;
  client_uri: string | null;
  redirect_uris: string;
  auth_method: ClientAuthMethod;
  secret_hash: string | null;
  created_at: string;
  fetched_at: string | null;
}

const toClient = (r: ClientRow): OAuthClient => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  clientUri: r.client_uri,
  redirectUris: parseJsonArray<string>(r.redirect_uris),
  authMethod: r.auth_method,
  secretHash: r.secret_hash,
});

/** Dynamic client registration. Returns the client and, for confidential clients, its secret (shown once). */
export async function registerClient(db: D1Database, meta: ClientMetadata): Promise<{ client: OAuthClient; secret: string | null; createdAt: string }> {
  const id = `shc_${randomToken().slice(0, 32)}`;
  const secret = meta.authMethod === 'none' ? null : randomToken();
  const now = nowIso();
  const secretHash = secret ? await sha256Hex(secret) : null;
  await db
    .prepare(`INSERT INTO oauth_clients (id, kind, name, client_uri, redirect_uris, auth_method, secret_hash, created_at)
              VALUES (?1, 'dcr', ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, meta.name, meta.clientUri, JSON.stringify(meta.redirectUris), meta.authMethod, secretHash, now)
    .run();
  return {
    client: { id, kind: 'dcr', name: meta.name, clientUri: meta.clientUri, redirectUris: meta.redirectUris, authMethod: meta.authMethod, secretHash },
    secret,
    createdAt: now,
  };
}

/** A client_id that is a Client ID Metadata Document URL: https, with a path, not an IP or local host. */
export function isMetadataDocumentUrl(clientId: string): boolean {
  if (!clientId.startsWith('https://') || clientId.length > 2048) return false;
  try {
    const url = new URL(clientId);
    const host = url.hostname;
    return (
      url.pathname.length > 1 &&
      !url.port &&
      !url.hash &&
      !url.username &&
      !url.password &&
      !isLoopbackHost(host) &&
      !/^[\d.]+$/.test(host) &&
      !host.startsWith('[') &&
      host.includes('.') &&
      !/\.(local|localhost|internal|test|invalid)$/i.test(host)
    );
  } catch {
    return false;
  }
}

export type MetadataFetcher = (url: string) => Promise<unknown>;

/** Fetches a Client ID Metadata Document: no redirects, 5 s timeout, 16 KB cap. */
export const fetchClientMetadataDocument: MetadataFetcher = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  } catch {
    throw new OAuthError('invalid_client', 'Could not fetch the client metadata document');
  }
  if (res.status !== 200) throw new OAuthError('invalid_client', `Client metadata document returned HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > CIMD_MAX_BYTES) throw new OAuthError('invalid_client', 'Client metadata document is too large');
  const reader = res.body?.getReader();
  if (!reader) throw new OAuthError('invalid_client', 'Client metadata document has no body');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CIMD_MAX_BYTES) throw new OAuthError('invalid_client', 'Client metadata document is too large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (err) {
    if (err instanceof OAuthError) throw err;
    throw new OAuthError('invalid_client', 'Client metadata document is not JSON');
  } finally {
    await reader.cancel().catch(() => {});
  }
};

/**
 * Looks up a client. A metadata-document URL is fetched (and cached for an
 * hour) when `refresh` is set, as on the authorization endpoint; the token
 * endpoint uses the cached copy validated during authorization.
 */
export async function getClient(
  db: D1Database,
  clientId: string,
  opts: { refresh?: boolean; fetcher?: MetadataFetcher } = {},
): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 2048) return null;
  const row = await db.prepare(`SELECT * FROM oauth_clients WHERE id = ?1`).bind(clientId).first<ClientRow>();
  if (!isMetadataDocumentUrl(clientId)) return row && row.kind === 'dcr' ? toClient(row) : null;

  const fresh = row?.fetched_at && Date.parse(row.fetched_at) > Date.now() - CIMD_CACHE_SECONDS * 1000;
  if (row && (fresh || !opts.refresh)) return toClient(row);
  if (!opts.refresh) return null;

  let meta: ClientMetadata;
  try {
    meta = validateClientMetadata(await (opts.fetcher ?? fetchClientMetadataDocument)(clientId), clientId);
  } catch (err) {
    if (err instanceof ClientMetadataError) throw new OAuthError('invalid_client', `Invalid client metadata document: ${err.message}`);
    throw err;
  }
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO oauth_clients (id, kind, name, client_uri, redirect_uris, auth_method, secret_hash, created_at, fetched_at)
       VALUES (?1, 'cimd', ?2, ?3, ?4, 'none', NULL, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, client_uri = excluded.client_uri,
         redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at`,
    )
    .bind(clientId, meta.name, meta.clientUri, JSON.stringify(meta.redirectUris), now)
    .run();
  return { id: clientId, kind: 'cimd', name: meta.name, clientUri: meta.clientUri, redirectUris: meta.redirectUris, authMethod: 'none', secretHash: null };
}

/**
 * Exact string match against the registered redirect URIs, except that a
 * loopback http URI may use any port (RFC 8252 §7.3, OAuth 2.1 §8.4.2).
 */
export function redirectUriAllowed(client: Pick<OAuthClient, 'redirectUris'>, uri: string): boolean {
  if (!validRedirectUri(uri)) return false;
  if (client.redirectUris.includes(uri)) return true;
  let requested: URL;
  try {
    requested = new URL(uri);
  } catch {
    return false;
  }
  if (requested.protocol !== 'http:' || !isLoopbackHost(requested.hostname)) return false;
  return client.redirectUris.some((r) => {
    try {
      const reg = new URL(r);
      return reg.protocol === 'http:' && reg.hostname === requested.hostname && reg.pathname === requested.pathname && reg.search === requested.search;
    } catch {
      return false;
    }
  });
}

export async function verifyClientSecret(client: OAuthClient, secret: string | null): Promise<boolean> {
  if (!client.secretHash) return secret === null;
  if (!secret || secret.length > 256) return false;
  const encoder = new TextEncoder();
  return crypto.subtle.timingSafeEqual(encoder.encode(await sha256Hex(secret)), encoder.encode(client.secretHash));
}

// ---------------------------------------------------------------------------
// PKCE

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const validCodeChallenge = (c: unknown): c is string => typeof c === 'string' && CHALLENGE.test(c);

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function verifyPkce(verifier: unknown, challenge: string): Promise<boolean> {
  return typeof verifier === 'string' && VERIFIER.test(verifier) && (await pkceChallenge(verifier)) === challenge;
}

// ---------------------------------------------------------------------------
// Grants, codes and tokens

/** Records consent and its authorization code in the same D1 transaction. */
export async function authorize(
  db: D1Database,
  p: { userId: string; clientId: string; scopes: Scope[]; resource: string; redirectUri: string; codeChallenge: string },
): Promise<string> {
  const now = nowIso();
  const code = randomToken();
  const scopes = formatScopes(p.scopes);
  const grantId = `(SELECT id FROM oauth_grants WHERE user_id = ?1 AND client_id = ?2 AND resource = ?3)`;
  await db.batch([
    db.prepare(
      `INSERT INTO oauth_grants (id, user_id, client_id, scopes, resource, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(user_id, client_id, resource) DO UPDATE SET scopes = excluded.scopes, updated_at = excluded.updated_at`,
    ).bind(newId(), p.userId, p.clientId, scopes, p.resource, now),
    ...(!p.scopes.includes(SCOPE_WRITE) ? downgradeCredentials(db, grantId, p.userId, p.clientId, p.resource) : []),
    db.prepare(`DELETE FROM oauth_codes WHERE expires_at <= ?1`).bind(now),
    db.prepare(
      `INSERT INTO oauth_codes (grant_id, id, redirect_uri, code_challenge, scopes, resource, expires_at)
       VALUES (${grantId}, ?4, ?5, ?6, ?7, ?3, ?8)`,
    ).bind(p.userId, p.clientId, p.resource, await sha256Hex(code), p.redirectUri, p.codeChallenge, scopes,
      new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString()),
  ]);
  return code;
}

/** Strip write from outstanding credentials so a future consent cannot restore old write access. */
function downgradeCredentials(db: D1Database, grantId: string, ...keys: string[]): D1PreparedStatement[] {
  return ['oauth_codes', 'oauth_tokens'].map((table) =>
    db.prepare(`UPDATE ${table} SET scopes = 'solutions:read' WHERE grant_id = ${grantId}`).bind(...keys),
  );
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface Issuance {
  source: 'code' | 'refresh';
  credentialId: string;
  clientId: string;
  resource: string;
  familyId: string;
  write: boolean;
}

async function issueTokens(db: D1Database, issuance: Issuance): Promise<TokenResponse | null> {
  const access = ACCESS_PREFIX + randomToken();
  const refresh = REFRESH_PREFIX + randomToken();
  const now = Date.now();
  const at = new Date(now).toISOString();
  const table = issuance.source === 'code' ? 'oauth_codes' : 'oauth_tokens';
  const activeRefresh = issuance.source === 'refresh' ? `AND c.kind = 'refresh' AND c.spent_at IS NULL` : '';
  // The SELECT and consumption run in one transaction. A revoked, consumed or
  // expired credential cannot mint either token, even under concurrent requests.
  const insert = `INSERT INTO oauth_tokens (id, grant_id, kind, family_id, scopes, resource, created_at, expires_at)
    SELECT ?1, g.id, ?2, ?3,
      CASE WHEN c.scopes = ?10 AND g.scopes = ?10 AND ?4 = 1 THEN ?10 ELSE ?9 END,
      c.resource, ?5, ?6
    FROM ${table} c JOIN oauth_grants g ON g.id = c.grant_id
    WHERE c.id = ?7 AND c.expires_at > ?5 AND g.client_id = ?8 AND c.resource = ?11 AND g.resource = ?11 ${activeRefresh}
    RETURNING scopes`;
  const statements = await Promise.all([
    ['access', access, ACCESS_TOKEN_TTL_SECONDS] as const,
    ['refresh', refresh, REFRESH_TOKEN_TTL_SECONDS] as const,
  ].map(async ([kind, token, ttl]) =>
    db.prepare(insert).bind(
      await sha256Hex(token), kind, issuance.familyId, issuance.write ? 1 : 0, at, new Date(now + ttl * 1000).toISOString(),
      issuance.credentialId, issuance.clientId, SCOPE_READ, formatScopes(SUPPORTED_SCOPES), issuance.resource,
    )));
  statements.push(issuance.source === 'code'
    ? db.prepare(`DELETE FROM oauth_codes WHERE id = ?1 AND grant_id IN
        (SELECT id FROM oauth_grants WHERE client_id = ?2 AND resource = ?3)`).bind(issuance.credentialId, issuance.clientId, issuance.resource)
    : db.prepare(`UPDATE oauth_tokens SET spent_at = ?2 WHERE id = ?1 AND spent_at IS NULL AND grant_id IN
        (SELECT id FROM oauth_grants WHERE client_id = ?3 AND resource = ?4)`).bind(issuance.credentialId, at, issuance.clientId, issuance.resource));
  statements.push(db.prepare(`DELETE FROM oauth_tokens WHERE expires_at <= ?1`).bind(at));
  const [result] = await db.batch<{ scopes: string }>(statements);
  const issued = result?.results[0];
  return issued ? { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope: issued.scopes } : null;
}

/** authorization_code grant: single use, bound to client, redirect URI, PKCE verifier and resource. */
export async function exchangeCode(
  db: D1Database,
  p: { code: string; clientId: string; redirectUri: string | null; verifier: unknown; resource: string },
): Promise<TokenResponse> {
  const invalid = () => new OAuthError('invalid_grant', 'Invalid or expired authorization code');
  if (!p.code || p.code.length > 128) throw invalid();
  const id = await sha256Hex(p.code);
  const row = await db.prepare(
    `SELECT c.redirect_uri, c.code_challenge, c.resource
     FROM oauth_codes c JOIN oauth_grants g ON g.id = c.grant_id
     WHERE c.id = ?1 AND g.client_id = ?2 AND c.expires_at > ?3`,
  ).bind(id, p.clientId, nowIso()).first<{ redirect_uri: string; code_challenge: string; resource: string }>();
  if (!row || p.redirectUri !== row.redirect_uri || !(await verifyPkce(p.verifier, row.code_challenge))) throw invalid();
  if (p.resource !== row.resource) throw new OAuthError('invalid_target', 'resource does not match the authorization request');
  const tokens = await issueTokens(db, { source: 'code', credentialId: id, clientId: p.clientId, resource: p.resource, familyId: newId(), write: true });
  if (!tokens) throw invalid();
  return tokens;
}

/** refresh_token grant with rotation and family revocation on replay. */
export async function refreshTokens(
  db: D1Database,
  p: { refreshToken: string; clientId: string; scope: string | null; resource: string },
): Promise<TokenResponse> {
  const invalid = () => new OAuthError('invalid_grant', 'Refresh token is invalid, expired or revoked');
  if (!p.refreshToken.startsWith(REFRESH_PREFIX) || p.refreshToken.length > 128) throw invalid();
  const id = await sha256Hex(p.refreshToken);
  const row = await db.prepare(
    `SELECT t.family_id, t.resource, t.scopes, t.spent_at, g.scopes AS grant_scopes
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.id = ?1 AND t.kind = 'refresh' AND t.expires_at > ?2 AND g.client_id = ?3`,
  ).bind(id, nowIso(), p.clientId).first<{ family_id: string; resource: string; scopes: string; spent_at: string | null; grant_scopes: string }>();
  if (!row) throw invalid();
  if (p.resource !== row.resource) throw new OAuthError('invalid_target', 'resource does not match the grant');

  const granted = parseScopes(row.grant_scopes);
  const available = parseScopes(row.scopes).filter((scope) => granted.includes(scope));
  const requested = p.scope === null ? available : parseScopes(p.scope);
  if (!row.spent_at) {
    if (!requested.includes(SCOPE_READ) || requested.some((scope) => !available.includes(scope)) ||
        (p.scope !== null && p.scope.trim().split(/\s+/).some((scope) => !(SUPPORTED_SCOPES as readonly string[]).includes(scope)))) {
      throw new OAuthError('invalid_scope', 'Requested scope exceeds the refresh token');
    }
    const tokens = await issueTokens(db, {
      source: 'refresh', credentialId: id, clientId: p.clientId, resource: p.resource, familyId: row.family_id, write: requested.includes(SCOPE_WRITE),
    });
    if (tokens) return tokens;
  }

  // Includes a replay that raced a successful rotation.
  await db.prepare(
    `DELETE FROM oauth_tokens WHERE family_id = ?1 AND EXISTS
     (SELECT 1 FROM oauth_tokens old WHERE old.id = ?2 AND old.spent_at IS NOT NULL)`,
  ).bind(row.family_id, id).run();
  throw invalid();
}

/** The user and effective scopes behind a valid access token for `resource`. */
export interface McpPrincipal {
  actor: Actor;
  scopes: Scope[];
  grantId: string;
  clientId: string;
}

/**
 * Validates an access token on every MCP request: it must exist (not revoked),
 * be unexpired, be an access token, and have been issued for this resource.
 * Effective scopes are the token's scopes intersected with the grant's current
 * scopes, so narrowing a grant takes effect immediately.
 */
export async function resolveAccessToken(db: D1Database, token: string, resource: string): Promise<McpPrincipal | null> {
  if (!token.startsWith(ACCESS_PREFIX) || token.length > 128) return null;
  const now = nowIso();
  const row = await db
    .prepare(
      `SELECT t.scopes, t.resource, g.id AS grant_id, g.scopes AS grant_scopes, g.client_id, g.last_used_at,
              u.id AS user_id, u.username, u.org_domain
       FROM oauth_tokens t
       JOIN oauth_grants g ON g.id = t.grant_id
       JOIN users u ON u.id = g.user_id
       WHERE t.id = ?1 AND t.kind = 'access' AND t.expires_at > ?2 AND t.resource = ?3 AND g.resource = ?3`,
    )
    .bind(await sha256Hex(token), now, resource)
    .first<{ scopes: string; resource: string; grant_id: string; grant_scopes: string; client_id: string; last_used_at: string | null; user_id: string; username: string; org_domain: string | null }>();
  if (!row || row.resource !== resource) return null;
  const granted = parseScopes(row.grant_scopes);
  const scopes = parseScopes(row.scopes).filter((s) => granted.includes(s));
  if (!scopes.includes(SCOPE_READ)) return null;
  // "Last used" for the connections list, written at most every five minutes.
  if (!row.last_used_at || Date.parse(row.last_used_at) < Date.now() - 300_000) {
    await db.prepare(`UPDATE oauth_grants SET last_used_at = ?2 WHERE id = ?1`).bind(row.grant_id, now).run();
  }
  return {
    actor: { userId: row.user_id, username: row.username, orgDomain: row.org_domain },
    scopes,
    grantId: row.grant_id,
    clientId: row.client_id,
  };
}

/**
 * RFC 7009 revocation. Revoking a refresh token removes its token family.
 */
export async function revokeToken(db: D1Database, token: string, clientId: string, resource: string): Promise<void> {
  if (!token || token.length > 128) return;
  const row = await db.prepare(
    `SELECT t.id, t.kind, t.family_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.id = ?1 AND g.client_id = ?2 AND t.resource = ?3`,
  ).bind(await sha256Hex(token), clientId, resource).first<{ id: string; kind: string; family_id: string }>();
  if (!row) return;
  if (row.kind === 'refresh') await db.prepare(`DELETE FROM oauth_tokens WHERE family_id = ?1`).bind(row.family_id).run();
  else await db.prepare(`DELETE FROM oauth_tokens WHERE id = ?1`).bind(row.id).run();
}

// ---------------------------------------------------------------------------
// Connection management (the user's own grants only)

export interface Connection {
  id: string;
  clientName: string;
  /** For metadata-document clients: the verified client_id URL. */
  clientId: string | null;
  clientUri: string | null;
  verified: boolean;
  scopes: Scope[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export async function listConnections(db: D1Database, actor: Actor, resource: string): Promise<Connection[]> {
  const rows = await db
    .prepare(
      `SELECT g.id, g.scopes, g.created_at, g.updated_at, g.last_used_at, c.id AS client_id, c.kind, c.name, c.client_uri
       FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
       WHERE g.user_id = ?1 AND g.resource = ?2 ORDER BY coalesce(g.last_used_at, g.updated_at) DESC`,
    )
    .bind(actor.userId, resource)
    .all<{ id: string; scopes: string; created_at: string; updated_at: string; last_used_at: string | null; client_id: string; kind: string; name: string; client_uri: string | null }>();
  return rows.results.map((r) => ({
    id: r.id,
    clientName: r.name,
    clientId: r.kind === 'cimd' ? r.client_id : null,
    clientUri: r.client_uri,
    verified: r.kind === 'cimd',
    scopes: parseScopes(r.scopes),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
  }));
}

/** Disconnects a connector: deletes the grant and, by cascade, all its codes and tokens. */
export async function revokeConnection(db: D1Database, actor: Actor, grantId: string, resource: string): Promise<void> {
  const res = await db.prepare(`DELETE FROM oauth_grants WHERE id = ?1 AND user_id = ?2 AND resource = ?3`).bind(grantId, actor.userId, resource).run();
  if (!res.meta.changes) throw new AppError('not_found', 'Connection not found');
}

/** Removes write access from a connection. Scopes can only be added through a new consent. */
export async function makeConnectionReadOnly(db: D1Database, actor: Actor, grantId: string, resource: string): Promise<void> {
  const now = nowIso();
  const [res] = await db.batch([
    db.prepare(`UPDATE oauth_grants SET scopes = ?4, updated_at = ?5 WHERE id = ?1 AND user_id = ?2 AND resource = ?3`)
      .bind(grantId, actor.userId, resource, SCOPE_READ, now),
    ...downgradeCredentials(db, '(SELECT id FROM oauth_grants WHERE id = ?1 AND user_id = ?2 AND resource = ?3)', grantId, actor.userId, resource),
  ]);
  if (!res?.meta.changes) throw new AppError('not_found', 'Connection not found');
}
