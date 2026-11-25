import { AppError } from './lib/errors.ts';
import { splitList } from './lib/util.ts';
import type { Env } from './env.ts';

export const MAX_BODY_BYTES = 256 * 1024;
export const CSRF_HEADER = 'x-solutionhub-csrf';
const COOKIE_SECURE = '__Host-sh_session';
const COOKIE_DEV = 'sh_session';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status);
  }
  // Never echo internal errors to clients; log without request data or secrets.
  console.error('Unhandled error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
  return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
}

export async function readBoundedText(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new AppError('payload_too_large', 'Request body is too large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new AppError('payload_too_large', 'Request body is too large');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new AppError('bad_request', 'Content-Type must be application/json');
  }
  const text = await readBoundedText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('bad_request', 'Malformed JSON');
  }
}

// ---------------------------------------------------------------------------
// Cookies

export function sessionCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? COOKIE_SECURE : COOKIE_DEV;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:';
  // __Host- prefix (on HTTPS) pins the cookie to this exact host, path=/, Secure.
  return [
    `${sessionCookieName(request)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

// ---------------------------------------------------------------------------
// Origins, CORS and CSRF

export function allowedOrigins(request: Request, env: Env): Set<string> {
  return new Set([new URL(request.url).origin, ...splitList(env.ALLOWED_ORIGINS)]);
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *  - the Origin header must be our own origin (or an explicitly allowed one);
 *  - a custom header must be present. Browsers cannot add custom headers to
 *    cross-site requests without a CORS preflight, which we do not grant.
 * Combined with SameSite=Lax cookies this blocks cross-site form/fetch attacks.
 */
export function assertCsrfSafe(request: Request, env: Env): void {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(request, env).has(origin)) {
    throw new AppError('forbidden', 'Cross-origin request rejected');
  }
  if (request.headers.get(CSRF_HEADER) !== '1') {
    throw new AppError('forbidden', 'Missing CSRF header');
  }
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  const extra = new Set(splitList(env.ALLOWED_ORIGINS));
  if (!origin || !extra.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': `content-type, authorization, ${CSRF_HEADER}`,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

// ---------------------------------------------------------------------------
// Security headers

const CSP = [
  `default-src 'self'`,
  // Flutter's CanvasKit renderer needs WebAssembly compilation; Google
  // Identity Services provides the web sign-in button.
  `script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client`,
  `style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  // Fonts, Google sign-in, and client-side Markdown/text resource previews.
  `connect-src 'self' https:`,
  // Embedded previews (YouTube, Google Slides, PDFs) and the Google sign-in iframe.
  `frame-src https:`,
  `media-src 'self' https:`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
].join('; ');

export function withSecurityHeaders(response: Response, isApi: boolean): Response {
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('x-frame-options', 'DENY');
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Google sign-in uses popups that must be able to message back to this page.
  h.set('cross-origin-opener-policy', 'same-origin-allow-popups');
  // Static assets need no cross-origin access; API CORS is added explicitly.
  h.delete('access-control-allow-origin');
  if (isApi) h.set('content-security-policy', `default-src 'none'; frame-ancestors 'none'`);
  else h.set('content-security-policy', CSP);
  return res;
}
