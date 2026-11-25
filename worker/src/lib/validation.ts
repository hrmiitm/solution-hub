import { AppError } from './errors.ts';
import { RESOURCE_TYPES, detectResourceType, safeHttpUrl, type Resource, type ResourceType } from './resources.ts';

export const SOLUTION_TYPES = ['demo', 'design', 'document', 'video', 'other'] as const;
export type SolutionType = (typeof SOLUTION_TYPES)[number];
export const VISIBILITIES = ['public', 'organization', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const STATUSES = ['ongoing', 'completed'] as const;
export type Status = (typeof STATUSES)[number];

export const LIMITS = {
  title: 120,
  summary: 300,
  description: 50_000,
  client: 120,
  tagItems: 10,
  tagLength: 50,
  keywordItems: 20,
  keywordLength: 40,
  resources: 20,
  resourceLabel: 100,
  updateMessage: 5_000,
} as const;

/** Fields a client may set on a solution. All optional for PATCH. */
export interface SolutionInput {
  title?: string;
  summary?: string;
  descriptionMd?: string;
  client?: string | null;
  type?: SolutionType;
  industry?: string[];
  function?: string[];
  category?: string[];
  technologies?: string[];
  keywords?: string[];
  resources?: Resource[];
  thumbnailUrl?: string | null;
  primaryResource?: string | null;
  visibility?: Visibility;
  status?: Status;
}

type Errors = Record<string, string>;

// Remove control characters (except newline/tab in long text) and trim.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CONTROL_ALL = /[\u0000-\u001F\u007F]/g;

function cleanLine(value: string): string {
  return value.replace(CONTROL_ALL, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
}

function str(body: Record<string, unknown>, key: string, max: number, errors: Errors, opts: { multiline?: boolean; required?: boolean } = {}): string | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (opts.required) errors[key] = 'Required';
    return raw === null ? '' : undefined;
  }
  if (typeof raw !== 'string') {
    errors[key] = 'Must be a string';
    return undefined;
  }
  const value = opts.multiline ? cleanText(raw) : cleanLine(raw);
  if (opts.required && !value) errors[key] = 'Required';
  else if (value.length > max) errors[key] = `Must be at most ${max} characters`;
  return value;
}

function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[], errors: Errors): T | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    errors[key] = `Must be one of: ${allowed.join(', ')}`;
    return undefined;
  }
  return raw as T;
}

/** Trims, dedupes (case-insensitively) and bounds a list of short labels. */
export function cleanTagList(raw: unknown, maxItems: number, maxLength: number, key: string, errors: Errors, lowercase = false): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[key] = 'Must be an array of strings';
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      errors[key] = 'Must be an array of strings';
      return undefined;
    }
    let value = cleanLine(item);
    if (lowercase) value = value.toLowerCase();
    if (!value) continue;
    if (value.length > maxLength) {
      errors[key] = `Each value must be at most ${maxLength} characters`;
      return undefined;
    }
    const k = value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  if (out.length > maxItems) {
    errors[key] = `At most ${maxItems} values`;
    return undefined;
  }
  return out;
}

function resources(raw: unknown, errors: Errors): Resource[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.resources = 'Must be an array';
    return undefined;
  }
  if (raw.length > LIMITS.resources) {
    errors.resources = `At most ${LIMITS.resources} resources`;
    return undefined;
  }
  const out: Resource[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null) {
      errors[`resources[${i}]`] = 'Must be an object';
      continue;
    }
    const r = item as Record<string, unknown>;
    const url = safeHttpUrl(r.url);
    if (!url) {
      errors[`resources[${i}].url`] = 'Must be a valid http(s) URL';
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const label = typeof r.label === 'string' ? cleanLine(r.label).slice(0, LIMITS.resourceLabel) : '';
    const type: ResourceType =
      typeof r.type === 'string' && (RESOURCE_TYPES as readonly string[]).includes(r.type)
        ? (r.type as ResourceType)
        : detectResourceType(url);
    out.push({ label: label || new URL(url).hostname, url, type });
  }
  return out;
}

function optionalUrl(body: Record<string, unknown>, key: string, errors: Errors): string | null | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const url = safeHttpUrl(raw);
  if (!url) errors[key] = 'Must be a valid http(s) URL';
  return url;
}

/**
 * Validates a create (partial=false) or update (partial=true) payload.
 * Unknown fields are ignored; ownership and ids are never read from input.
 */
export function validateSolutionInput(body: unknown, partial: boolean): SolutionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 'Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const errors: Errors = {};
  const input: SolutionInput = {
    title: str(b, 'title', LIMITS.title, errors, { required: !partial || b.title !== undefined }),
    summary: str(b, 'summary', LIMITS.summary, errors),
    descriptionMd: str(b, 'descriptionMd', LIMITS.description, errors, {
      multiline: true,
      required: !partial || b.descriptionMd !== undefined,
    }),
    type: oneOf(b, 'type', SOLUTION_TYPES, errors),
    industry: cleanTagList(b.industry, LIMITS.tagItems, LIMITS.tagLength, 'industry', errors),
    function: cleanTagList(b.function, LIMITS.tagItems, LIMITS.tagLength, 'function', errors),
    category: cleanTagList(b.category, LIMITS.tagItems, LIMITS.tagLength, 'category', errors),
    technologies: cleanTagList(b.technologies, LIMITS.tagItems, LIMITS.tagLength, 'technologies', errors),
    keywords: cleanTagList(b.keywords, LIMITS.keywordItems, LIMITS.keywordLength, 'keywords', errors, true),
    resources: resources(b.resources, errors),
    thumbnailUrl: optionalUrl(b, 'thumbnailUrl', errors),
    primaryResource: optionalUrl(b, 'primaryResource', errors),
    visibility: oneOf(b, 'visibility', VISIBILITIES, errors),
    status: oneOf(b, 'status', STATUSES, errors),
  };
  const client = str(b, 'client', LIMITS.client, errors);
  if (client !== undefined) input.client = client || null;

  if (Object.keys(errors).length) {
    throw new AppError('validation_failed', 'Some fields are invalid', errors);
  }
  for (const key of Object.keys(input) as (keyof SolutionInput)[]) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

export function validateUpdateMessage(body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Errors = {};
  const message = str(b, 'message', LIMITS.updateMessage, errors, { multiline: true, required: true });
  if (Object.keys(errors).length || !message) {
    throw new AppError('validation_failed', 'Some fields are invalid', errors);
  }
  return message;
}

/** Derives a plain-text summary from Markdown when none is supplied. */
export function deriveSummary(markdown: string, max = 200): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ') // headings are labels, not summary text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------
// MCP tool arguments. Tools reuse validateSolutionInput/validateUpdateMessage
// for solution fields; the helpers below cover the rest. Identity never comes
// from arguments: unknown keys (such as an "owner" on create) are rejected.

export const SORTS = ['relevance', 'updated', 'created', 'oldest'] as const;
export type Sort = (typeof SORTS)[number];

/** Search filters shared by the REST query string and the MCP search tool. */
export interface SearchInput {
  q?: string;
  status?: Status;
  visibility?: Visibility[];
  types?: string[];
  industry?: string[];
  function?: string[];
  category?: string[];
  technology?: string[];
  owner?: string;
  sort?: Sort;
  page?: number;
  limit?: number;
}

/** A reference to one solution: its id, or its owner's username and slug. */
export type SolutionRef = { id: string } | { username: string; slug: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9-]{2,40}$/;
const SLUG = /^[a-z0-9-]{1,80}$/;

export function toolArgs(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('validation_failed', 'Arguments must be an object');
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new AppError('validation_failed', `Unknown argument(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ') || 'none'}`);
  }
  return raw as Record<string, unknown>;
}

export function intArg(raw: unknown, key: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new AppError('validation_failed', 'Some fields are invalid', { [key]: `Must be an integer from ${min} to ${max}` });
  }
  return raw;
}

export function usernameArg(raw: unknown, key = 'username'): string {
  const value = typeof raw === 'string' ? raw.trim().replace(/^@/, '').toLowerCase() : '';
  if (!USERNAME.test(value)) throw new AppError('validation_failed', 'Some fields are invalid', { [key]: 'Must be a SolutionHub username' });
  return value;
}

/**
 * Parses a solution reference: an id, "username/slug", "/username/slug", a
 * SolutionHub URL (https://host/username/slug) or solutionhub://solutions/<ref>.
 */
export function parseSolutionRef(raw: unknown, key = 'solution', origin?: string): SolutionRef {
  const invalid = () =>
    new AppError('validation_failed', 'Some fields are invalid', {
      [key]: 'Must be a solution id, "username/slug" or a SolutionHub solution URL',
    });
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw invalid();
  let value = raw.trim();
  if (value.startsWith('solutionhub://solutions/')) value = value.slice('solutionhub://solutions/'.length);
  else if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if ((origin && url.origin !== origin) || url.username || url.password) throw invalid();
      value = url.pathname;
    } catch {
      throw invalid();
    }
  }
  if (UUID.test(value)) return { id: value.toLowerCase() };
  const parts = value.replace(/^\/+|\/+$/g, '').split('/');
  let username: string | undefined;
  let slug: string | undefined;
  try {
    username = decodeURIComponent(parts[0] ?? '').replace(/^@/, '').toLowerCase();
    slug = decodeURIComponent(parts[1] ?? '').toLowerCase();
  } catch {
    throw invalid();
  }
  if (parts.length !== 2 || !USERNAME.test(username) || !SLUG.test(slug)) throw invalid();
  return { username, slug };
}

function listArg(raw: unknown, key: string, errors: Errors): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = cleanTagList(typeof raw === 'string' ? [raw] : raw, 10, LIMITS.tagLength, key, errors);
  return list?.length ? list : undefined;
}

export const SEARCH_ARGS = [
  'query', 'status', 'visibility', 'type', 'category', 'technology', 'industry', 'function', 'owner', 'sort', 'page', 'limit',
] as const;

/** Validates the search_solutions tool arguments. `me` is the caller's username, for owner: "me". */
export function validateSearchArgs(raw: unknown, me: string): SearchInput {
  const b = toolArgs(raw, SEARCH_ARGS);
  const errors: Errors = {};
  const q = str(b, 'query', 200, errors);
  const out: SearchInput = {
    q: q || undefined,
    status: oneOf(b, 'status', STATUSES, errors),
    types: listArg(b.type, 'type', errors),
    category: listArg(b.category, 'category', errors),
    technology: listArg(b.technology, 'technology', errors),
    industry: listArg(b.industry, 'industry', errors),
    function: listArg(b.function, 'function', errors),
    sort: oneOf(b, 'sort', SORTS, errors),
  };
  const vis = listArg(b.visibility, 'visibility', errors);
  if (vis?.some((v) => !(VISIBILITIES as readonly string[]).includes(v))) errors.visibility = `Must be any of: ${VISIBILITIES.join(', ')}`;
  else if (vis) out.visibility = vis as Visibility[];
  if (out.types?.some((t) => !(SOLUTION_TYPES as readonly string[]).includes(t))) errors.type = `Must be any of: ${SOLUTION_TYPES.join(', ')}`;
  if (b.owner !== undefined && b.owner !== null) {
    const owner = typeof b.owner === 'string' ? b.owner.trim().replace(/^@/, '').toLowerCase() : '';
    if (owner === 'me') out.owner = me;
    else if (USERNAME.test(owner)) out.owner = owner;
    else errors.owner = 'Must be a username or "me"';
  }
  if (Object.keys(errors).length) throw new AppError('validation_failed', 'Some fields are invalid', errors);
  out.page = intArg(b.page, 'page', 1, 1000, 1);
  out.limit = intArg(b.limit, 'limit', 1, 50, 10);
  for (const key of Object.keys(out) as (keyof SearchInput)[]) if (out[key] === undefined) delete out[key];
  return out;
}

export function validateStatus(raw: unknown): Status {
  if (typeof raw !== 'string' || !(STATUSES as readonly string[]).includes(raw)) {
    throw new AppError('validation_failed', 'Some fields are invalid', { status: `Must be one of: ${STATUSES.join(', ')}` });
  }
  return raw as Status;
}

export function validateConsentDecision(raw: unknown): { approve: boolean; write: boolean } {
  const { approve, write } = toolArgs(raw, ['approve', 'write']);
  if (typeof approve !== 'boolean' || (write !== undefined && typeof write !== 'boolean')) {
    throw new AppError('validation_failed', 'Submit an explicit consent decision');
  }
  return { approve, write: write === true };
}

// ---------------------------------------------------------------------------
// OAuth client metadata (dynamic registration and Client ID Metadata Documents)

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname.toLowerCase());

/**
 * OAuth redirect URIs use HTTPS or loopback HTTP for desktop clients.
 * Return the original string for exact matching.
 */
export function validRedirectUri(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 2048 || value !== raw || /[\u0000-\u0020\u007F\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash || value.includes('#') || url.username || url.password ||
      ['code', 'state', 'error', 'error_description', 'iss'].some((key) => url.searchParams.has(key))) return null;
  if (url.protocol === 'https:' && /^https:\/\//i.test(value) && url.hostname) return value;
  if (url.protocol === 'http:' && /^http:\/\//i.test(value) && isLoopbackHost(url.hostname)) return value;
  return null;
}

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface ClientMetadata {
  name: string;
  clientUri: string | null;
  redirectUris: string[];
  authMethod: ClientAuthMethod;
}

/** Thrown as RFC 7591 `invalid_redirect_uri` / `invalid_client_metadata`. */
export class ClientMetadataError extends Error {
  readonly code: 'invalid_redirect_uri' | 'invalid_client_metadata';
  constructor(code: 'invalid_redirect_uri' | 'invalid_client_metadata', message: string) {
    super(message);
    this.code = code;
  }
}

/** Validates RFC 7591 registration metadata, or a CIMD document (`documentUrl` set). */
export function validateClientMetadata(body: unknown, documentUrl?: string): ClientMetadata {
  const fail = (message: string, code: ClientMetadataError['code'] = 'invalid_client_metadata'): never => {
    throw new ClientMetadataError(code, message);
  };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('Metadata must be a JSON object');
  const b = body as Record<string, unknown>;
  if (documentUrl !== undefined && b.client_id !== documentUrl) fail('client_id must equal the metadata document URL');

  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) fail('redirect_uris must list 1 to 10 URIs', 'invalid_redirect_uri');
  const redirectUris = (uris as unknown[]).map((u) => validRedirectUri(u) ?? fail('Redirect URIs must use HTTPS or loopback HTTP', 'invalid_redirect_uri'));

  const rawName = b.client_name;
  if (rawName !== undefined && typeof rawName !== 'string') fail('client_name must be a string');
  const name = cleanLine(typeof rawName === 'string' ? rawName : '').slice(0, 100);
  if (documentUrl !== undefined && !name) fail('client_name is required');

  const clientUri = b.client_uri === undefined || b.client_uri === null ? null : safeHttpUrl(b.client_uri);
  if (b.client_uri !== undefined && b.client_uri !== null && !clientUri?.startsWith('https://')) fail('client_uri must be an https URL');

  const methods = b.token_endpoint_auth_methods_supported;
  const publicDocument = documentUrl !== undefined && Array.isArray(methods) && methods.includes('none');
  const method = publicDocument ? 'none' : (b.token_endpoint_auth_method ?? (documentUrl ? 'none' : 'client_secret_basic'));
  const allowedMethods: string[] = documentUrl !== undefined ? ['none'] : ['none', 'client_secret_post', 'client_secret_basic'];
  if (typeof method !== 'string' || !allowedMethods.includes(method)) fail(`token_endpoint_auth_method must be one of: ${allowedMethods.join(', ')}`);

  const grants = b.grant_types ?? ['authorization_code'];
  if (!Array.isArray(grants) || !grants.includes('authorization_code') ||
      (documentUrl === undefined && grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))) {
    fail('grant_types must include authorization_code');
  }
  const responses = b.response_types ?? ['code'];
  if (!Array.isArray(responses) || responses.length !== 1 || responses[0] !== 'code') fail('response_types must contain code');

  return {
    name: name || (redirectUris[0] ? redirectHost(redirectUris[0]) : 'MCP client'),
    clientUri,
    redirectUris,
    authMethod: method as ClientAuthMethod,
  };
}

/** A short, human-readable origin for a redirect URI (shown on the consent screen). */
export function redirectHost(uri: string): string {
  try {
    const url = new URL(uri);
    return url.host || `${url.protocol}//`;
  } catch {
    return uri.slice(0, 60);
  }
}
