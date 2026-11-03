/**
 * The one in-memory failure limiter (ADR-062, ADR-069).
 *
 * Sign-in and public-link passwords both need "ten tries per fifteen minutes per
 * key", and both used to grow a map that was never cleaned. One mechanism keeps the
 * window, the count and the sweep in one place. State is per process: a restart forgets
 * every bucket, which is an accepted limit of v1 (Redis is deferred).
 */
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
/** Beyond this many live keys the sweep is no longer enough; forget the oldest. */
const MAX_KEYS = 20_000;

const buckets = new Map();

/** True while `key` has spent its allowance inside the current window. */
export function isRateLimited(key, { limit = LIMIT, now = Date.now() } = {}) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count >= limit;
}

/** Count one failure and return the new count. */
export function recordFailure(key, { now = Date.now(), windowMs = WINDOW_MS } = {}) {
  const bucket = buckets.get(key);
  const next = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + windowMs };
  next.count += 1;
  buckets.set(key, next);
  if (buckets.size > MAX_KEYS) sweep(now);
  return next.count;
}

/** A success clears the key: the next wrong password starts a fresh window. */
export function clearFailures(key) {
  buckets.delete(key);
}

/** Forget expired buckets; called when the map grows, not on a timer. */
export function sweep(now = Date.now()) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test hook: forget every bucket. */
export function resetFailures() {
  buckets.clear();
}
