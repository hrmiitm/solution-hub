/**
 * Centralized rate limiting for REST, MCP and OAuth.
 *
 * Every request the Worker handles is charged here, from one of three places
 * (index.ts, api.ts, mcp/server.ts, oauth.ts), always through these functions:
 *
 *   bucket       key             default        counter
 *   user         user id         2,000 / 5 min  per Worker isolate (REST + MCP share the key)
 *   anonymous    client IP       300 / 5 min    per Worker isolate
 *   auth         client IP       50 / 5 min     per Worker isolate (sign-in, consent, OAuth register/token/revoke)
 *   global       whole app       80,000 / day   global, approximate (isolates sync through one D1 row)
 *
 * Per-client counters live in memory: no D1 reads or writes. They are local
 * to one isolate in one Cloudflare location, so they are best effort, not
 * global. (Cloudflare Pages cannot bind the Workers Rate Limiting API, whose
 * counters are per location anyway.) The global budget counts locally and
 * adds the counts to a single D1 row at most every 50 requests or 30 seconds
 * per isolate, off the request path (waitUntil).
 *
 * Windows are fixed and aligned to the clock: allowances renew automatically
 * when a window ends. A rejected request gets HTTP 429 with Retry-After.
 * All values come from Worker vars (wrangler.jsonc); see rateLimitSettings.
 */
import type { Env } from '../env.ts';
import { AppError } from './errors.ts';

export type RateLimitEnv = Pick<
  Env,
  'RATE_LIMITS_ENABLED' | 'RATE_LIMIT_WINDOW_SECONDS' | 'RATE_LIMIT_USER' | 'RATE_LIMIT_ANONYMOUS' | 'RATE_LIMIT_AUTH' | 'RATE_LIMIT_GLOBAL_PER_DAY'
>;

export type ClientBucket = 'user' | 'anonymous' | 'auth';

export interface RateLimitSettings {
  /** RATE_LIMITS_ENABLED: "false" turns off the per-client (user, anonymous, auth) limits. */
  enabled: boolean;
  windowSeconds: number;
  user: number;
  anonymous: number;
  auth: number;
  /** Requests per UTC day across the whole app; 0 turns the budget off. Independent of `enabled`. */
  globalPerDay: number;
}

const DAY_MS = 86_400_000;

function count(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

/** Reads the limits from Worker vars. Missing or invalid values fall back to the defaults; 0 disables one limit. */
export function rateLimitSettings(env: RateLimitEnv): RateLimitSettings {
  return {
    enabled: env.RATE_LIMITS_ENABLED?.trim().toLowerCase() !== 'false',
    windowSeconds: count(env.RATE_LIMIT_WINDOW_SECONDS, 300, 86_400) || 300,
    user: count(env.RATE_LIMIT_USER, 2000, 10_000_000),
    anonymous: count(env.RATE_LIMIT_ANONYMOUS, 300, 10_000_000),
    auth: count(env.RATE_LIMIT_AUTH, 50, 10_000_000),
    globalPerDay: count(env.RATE_LIMIT_GLOBAL_PER_DAY, 80_000, 1_000_000_000),
  };
}

/** The caller's IP as Cloudflare reports it (clients cannot set this header through Cloudflare). */
export const clientIp = (request: Request): string => request.headers.get('cf-connecting-ip') ?? 'local';

function rateLimited(retryAfterSeconds: number, message: string): AppError {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new AppError('rate_limited', message, { retryAfter: String(seconds) }, seconds);
}

function waitText(seconds: number): string {
  return seconds < 90 ? `${Math.max(1, Math.ceil(seconds))} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

// ---------------------------------------------------------------------------
// Per-client limits (in memory, per isolate)

const windows = new Map<string, { resetAt: number; count: number }>();
const MAX_KEYS = 20_000;

/** Counts one request for `id` in `bucket`; throws 429 once the window's allowance is used up. */
export function enforceClientLimit(env: RateLimitEnv, bucket: ClientBucket, id: string, now = Date.now()): void {
  const settings = rateLimitSettings(env);
  const limit = settings[bucket];
  if (!settings.enabled || limit === 0) return;
  const key = `${bucket}:${id}`;
  let entry = windows.get(key);
  if (!entry || now >= entry.resetAt) {
    if (!entry && windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    const windowMs = settings.windowSeconds * 1000;
    entry = { resetAt: (Math.floor(now / windowMs) + 1) * windowMs, count: 0 };
    windows.set(key, entry);
  }
  entry.count++;
  if (entry.count > limit) {
    const wait = (entry.resetAt - now) / 1000;
    throw rateLimited(wait, `Too many requests. Try again in ${waitText(wait)}.`);
  }
}

// ---------------------------------------------------------------------------
// Global daily budget (local counts, periodically added to one D1 row)

const SYNC_EVERY_REQUESTS = 50;
const SYNC_EVERY_MS = 30_000;
const GLOBAL_KEY = 'global:requests';

interface BudgetState {
  day: number;
  /** Today's total across all isolates, as last reported by D1. */
  total: number;
  /** Counted here and being added to D1 right now. */
  inflight: number;
  /** Counted here, not yet sent to D1. */
  pending: number;
  lastSync: number;
}

let budget: BudgetState = { day: -1, total: 0, inflight: 0, pending: 0, lastSync: 0 };

/** Adds `n` requests to today's row and returns the new total; a stale (earlier-day) write never resets a newer day. */
async function addToDailyTotal(db: D1Database, day: number, n: number): Promise<number | null> {
  const dayStart = day * 86_400;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + excluded.count
                      WHEN window_start < excluded.window_start THEN excluded.count
                      ELSE count END,
         window_start = max(window_start, excluded.window_start)
       RETURNING count, window_start`,
    )
    .bind(GLOBAL_KEY, dayStart, n)
    .first<{ count: number; window_start: number }>();
  return row && row.window_start === dayStart ? row.count : null;
}

/**
 * Charges one request to the app's daily budget. Throws 429 (until 00:00 UTC)
 * once the budget is spent. Never waits for D1: syncing runs in `waitUntil`.
 */
export function chargeGlobalBudget(
  env: RateLimitEnv & Pick<Env, 'DB'>,
  waitUntil: (promise: Promise<unknown>) => void,
  now = Date.now(),
): void {
  const limit = rateLimitSettings(env).globalPerDay;
  if (limit === 0) return;
  const day = Math.floor(now / DAY_MS);
  if (budget.day !== day) budget = { day, total: 0, inflight: 0, pending: 0, lastSync: 0 };
  const state = budget;
  if (state.total + state.inflight + state.pending >= limit) {
    const wait = ((day + 1) * DAY_MS - now) / 1000;
    throw rateLimited(wait, `SolutionHub has reached its daily request budget. Try again in ${waitText(wait)} (after 00:00 UTC).`);
  }
  state.pending++;
  if (state.inflight || (state.pending < SYNC_EVERY_REQUESTS && now - state.lastSync < SYNC_EVERY_MS)) return;

  const n = state.pending;
  state.pending = 0;
  state.inflight = n;
  state.lastSync = now;
  waitUntil(
    addToDailyTotal(env.DB, day, n)
      .then((total) => {
        if (total !== null) state.total = Math.max(state.total, total);
        else state.pending += n;
      })
      .catch(() => {
        // Keep the requests counted locally and retry on a later sync.
        state.pending += n;
        console.error('SolutionHub rate limit sync failed');
      })
      .finally(() => {
        state.inflight = 0;
      }),
  );
}

/** Test helper: forgets all in-memory counters. */
export function resetRateLimitState(): void {
  windows.clear();
  budget = { day: -1, total: 0, inflight: 0, pending: 0, lastSync: 0 };
}
