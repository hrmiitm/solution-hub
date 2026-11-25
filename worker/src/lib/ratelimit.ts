import { AppError } from './errors.ts';

/**
 * Fixed-window rate limiter backed by D1 (one upsert per checked request).
 * Used for sign-in and write operations, where a database write happens
 * anyway. Reads are limited by a cheaper per-isolate limiter below.
 */
export async function enforceRateLimit(db: D1Database, key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  // Occasionally drop stale windows so the table stays small without a cron job.
  if (Math.random() < 0.02) {
    await db.prepare(`DELETE FROM rate_limits WHERE window_start < ?1`).bind(now - 86_400).run();
  }
  if ((row?.count ?? 0) > limit) {
    throw new AppError('rate_limited', 'Too many requests, please slow down');
  }
}

/**
 * Best-effort in-memory limiter (per Worker isolate). It cannot see traffic on
 * other isolates, so it only blunts bursts; Cloudflare's edge protections
 * handle volumetric abuse.
 */
const buckets = new Map<string, { windowStart: number; count: number }>();

export function enforceMemoryRateLimit(key: string, limit: number, windowSeconds: number): void {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const bucket = buckets.get(key);
  if (!bucket || bucket.windowStart !== windowStart) {
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(key, { windowStart, count: 1 });
    return;
  }
  bucket.count++;
  if (bucket.count > limit) throw new AppError('rate_limited', 'Too many requests, please slow down');
}
