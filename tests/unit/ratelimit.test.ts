/**
 * Rate limiter logic, tested in-process with fixed clocks and a fake D1.
 * Nothing here sends requests, so it never touches a deployed allowance.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { AppError } from '../../worker/src/lib/errors.ts';
import { errorResponse } from '../../worker/src/http.ts';
import {
  chargeGlobalBudget, enforceClientLimit, rateLimitSettings, resetRateLimitState, type RateLimitEnv,
} from '../../worker/src/lib/ratelimit.ts';

const WINDOW = 300_000;
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % WINDOW); // start of a 5-minute window
const env: RateLimitEnv = {
  RATE_LIMITS_ENABLED: 'true', RATE_LIMIT_WINDOW_SECONDS: '300',
  RATE_LIMIT_USER: '5', RATE_LIMIT_ANONYMOUS: '3', RATE_LIMIT_AUTH: '2', RATE_LIMIT_GLOBAL_PER_DAY: '0',
};

beforeEach(resetRateLimitState);

function rejected(fn: () => void): AppError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err;
  }
  assert.fail('expected a 429');
}

test('settings default to the documented limits; invalid values fall back; 0 disables', () => {
  assert.deepEqual(rateLimitSettings({}), { enabled: true, windowSeconds: 300, user: 2000, anonymous: 300, auth: 50, globalPerDay: 80_000 });
  const custom = rateLimitSettings({ RATE_LIMITS_ENABLED: 'FALSE', RATE_LIMIT_WINDOW_SECONDS: '0', RATE_LIMIT_USER: 'lots', RATE_LIMIT_AUTH: '0', RATE_LIMIT_GLOBAL_PER_DAY: '-1' });
  assert.equal(custom.enabled, false);
  assert.equal(custom.windowSeconds, 300);
  assert.equal(custom.user, 2000);
  assert.equal(custom.auth, 0);
  assert.equal(custom.globalPerDay, 80_000);
});

test('each bucket allows its limit per window, then returns 429 with Retry-After; the next window renews', async () => {
  for (let i = 0; i < 5; i++) enforceClientLimit(env, 'user', 'u1', T0 + i);
  const err = rejected(() => enforceClientLimit(env, 'user', 'u1', T0 + 60_000));
  assert.equal(err.status, 429);
  assert.equal(err.retryAfter, 240);
  const response = errorResponse(err);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '240');
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'rate_limited');

  enforceClientLimit(env, 'user', 'u1', T0 + WINDOW); // renewed
  enforceClientLimit(env, 'user', 'u2', T0 + 60_000); // other users unaffected
});

test('buckets are independent: auth limits do not consume the anonymous allowance', () => {
  enforceClientLimit(env, 'auth', '203.0.113.1', T0);
  enforceClientLimit(env, 'auth', '203.0.113.1', T0);
  rejected(() => enforceClientLimit(env, 'auth', '203.0.113.1', T0));
  for (let i = 0; i < 3; i++) enforceClientLimit(env, 'anonymous', '203.0.113.1', T0);
  rejected(() => enforceClientLimit(env, 'anonymous', '203.0.113.1', T0));
});

test('RATE_LIMITS_ENABLED=false or a limit of 0 disables per-client limits', () => {
  for (let i = 0; i < 50; i++) enforceClientLimit({ ...env, RATE_LIMITS_ENABLED: 'false' }, 'auth', 'ip', T0);
  for (let i = 0; i < 50; i++) enforceClientLimit({ ...env, RATE_LIMIT_ANONYMOUS: '0' }, 'anonymous', 'ip', T0);
});

/** A fake D1 holding the one budget row, implementing the upsert's semantics. */
function fakeDb(initial = 0) {
  const row = { window_start: 0, count: initial };
  const calls: number[] = [];
  const db = {
    prepare: () => ({
      bind: (_key: string, dayStart: number, n: number) => ({
        first: async () => {
          calls.push(n);
          if (row.window_start === dayStart) row.count += n;
          else if (row.window_start < dayStart) Object.assign(row, { window_start: dayStart, count: n });
          return { ...row };
        },
      }),
    }),
  };
  return { db: db as unknown as D1Database, row, calls };
}

test('global budget syncs in batches, learns other isolates\' usage, and blocks until 00:00 UTC', async () => {
  const day = Math.floor(T0 / 86_400_000);
  const { db, row, calls } = fakeDb();
  row.window_start = day * 86_400;
  row.count = 90; // used by other isolates today
  const pending: Promise<unknown>[] = [];
  const budgetEnv = { ...env, RATE_LIMIT_GLOBAL_PER_DAY: '100', DB: db };
  const charge = (at: number) => chargeGlobalBudget(budgetEnv, (p) => pending.push(p), at);

  charge(T0); // first request in an isolate syncs at once
  await Promise.all(pending);
  assert.deepEqual(calls, [1]);
  for (let i = 1; i < 9; i++) charge(T0 + i); // 91 + 8 = 99, no new sync within 30 s
  assert.equal(calls.length, 1);
  charge(T0 + 31_000); // 100th request: allowed, and the 30 s timer triggers a sync
  await Promise.all(pending);
  assert.deepEqual(calls, [1, 9]);
  assert.equal(row.count, 100);
  const err = rejected(() => charge(T0 + 32_000));
  assert.equal(err.status, 429);
  const midnight = (day + 1) * 86_400_000;
  assert.equal(err.retryAfter, Math.ceil((midnight - T0 - 32_000) / 1000));
  charge(midnight); // a new UTC day renews the budget
});

test('a failed sync keeps the requests counted locally', async () => {
  const pending: Promise<unknown>[] = [];
  const failing = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 down'); } }) }) } as unknown as D1Database;
  const budgetEnv = { ...env, RATE_LIMIT_GLOBAL_PER_DAY: '2', DB: failing };
  const error = console.error;
  console.error = () => {};
  try {
    chargeGlobalBudget(budgetEnv, (p) => pending.push(p), T0);
    await Promise.all(pending);
    chargeGlobalBudget(budgetEnv, (p) => pending.push(p), T0 + 1);
    rejected(() => chargeGlobalBudget(budgetEnv, (p) => pending.push(p), T0 + 2));
  } finally {
    console.error = error;
  }
});

test('the global budget is off at 0 and never touches D1', () => {
  const { db, calls } = fakeDb();
  for (let i = 0; i < 1000; i++) chargeGlobalBudget({ ...env, DB: db }, () => assert.fail('no sync'), T0 + i);
  assert.equal(calls.length, 0);
});
