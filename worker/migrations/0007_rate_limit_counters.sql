-- Rate limiting moved to in-memory per-client counters (worker/src/lib/ratelimit.ts).
-- rate_limits now holds a single row: the app-wide daily request budget
-- ('global:requests', window_start = start of the UTC day in epoch seconds).
-- The old per-IP and per-user counters are obsolete and only contain counts.
DELETE FROM rate_limits;
