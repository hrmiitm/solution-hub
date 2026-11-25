import { AppError } from '../lib/errors.ts';
import { base64UrlDecode } from '../lib/util.ts';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  /** Google Workspace domain from the signed `hd` claim; null for personal accounts. */
  hd: string | null;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

export type JwksFetcher = () => Promise<{ keys: Jwk[]; maxAgeSeconds: number }>;

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;

export const fetchGoogleJwks: JwksFetcher = async () => {
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  return { keys: body.keys, maxAgeSeconds: Math.min(Math.max(maxAge, 60), 86_400) };
};

/** Caches Google's signing keys per isolate, refreshing on expiry or unknown kid. */
export class GoogleTokenVerifier {
  private keys = new Map<string, CryptoKey>();
  private expiresAt = 0;
  private lastRefresh = 0;
  private readonly fetchJwks: JwksFetcher;
  private readonly now: () => number;

  constructor(fetchJwks: JwksFetcher = fetchGoogleJwks, now: () => number = Date.now) {
    this.fetchJwks = fetchJwks;
    this.now = now;
  }

  private async refresh(): Promise<void> {
    const { keys, maxAgeSeconds } = await this.fetchJwks();
    const next = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      next.set(jwk.kid, key);
    }
    this.keys = next;
    this.lastRefresh = this.now();
    this.expiresAt = this.now() + maxAgeSeconds * 1000;
  }

  private async key(kid: string): Promise<CryptoKey | undefined> {
    const expired = this.now() >= this.expiresAt;
    // Unknown kid may mean Google rotated keys; refetch, but at most once a minute.
    const unknownKid = !this.keys.has(kid) && this.now() - this.lastRefresh > 60_000;
    if (expired || unknownKid) await this.refresh();
    return this.keys.get(kid);
  }

  /**
   * Verifies a Google ID token: RS256 signature against Google's published
   * keys, issuer, audience (must be one of our client IDs), expiry, and a
   * verified email. Throws AppError('unauthorized') on any failure.
   */
  async verify(idToken: string, audiences: readonly string[]): Promise<GoogleIdentity> {
    const fail = (why: string): never => {
      throw new AppError('unauthorized', `Invalid Google credential (${why})`);
    };
    if (!audiences.length) throw new AppError('internal', 'Google sign-in is not configured');
    if (typeof idToken !== 'string' || idToken.length > 4096) fail('format');
    const parts = idToken.split('.');
    if (parts.length !== 3) fail('format');
    const [h, p, s] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h)));
      claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(p)));
    } catch {
      return fail('format');
    }
    if (header.alg !== 'RS256' || !header.kid) fail('algorithm');

    const key = await this.key(header.kid!);
    if (!key) fail('unknown key');
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key!,
      base64UrlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) fail('signature');

    const nowSec = Math.floor(this.now() / 1000);
    if (!ISSUERS.has(String(claims.iss))) fail('issuer');
    const aud = claims.aud;
    const audOk = Array.isArray(aud) ? aud.some((a) => audiences.includes(String(a))) : audiences.includes(String(aud));
    if (!audOk) fail('audience');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSec) fail('expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSec) fail('issued in future');
    if (typeof claims.sub !== 'string' || !claims.sub) fail('subject');
    if (claims.email_verified !== true && claims.email_verified !== 'true') fail('email not verified');

    const hd = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '';
    return {
      hd: /^[a-z0-9.-]{1,253}$/.test(hd) ? hd : null,
      sub: claims.sub as string,
      email: String(claims.email ?? ''),
      name: String(claims.name ?? claims.email ?? '').slice(0, 120),
      picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : null,
    };
  }
}
