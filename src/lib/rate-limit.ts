/**
 * In-memory sliding-window rate limiter.
 * Suitable for single-instance deployments (Cloud Run with maxInstances=1-4).
 * For multi-instance scaling, swap to Redis-backed (e.g. @upstash/ratelimit).
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds to prevent memory leaks
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

export type RateLimitConfig = {
  /** Maximum number of requests in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * Check if a request is within rate limits.
 * Returns { allowed, limit, remaining, resetAt }.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  // No existing entry or window expired — start fresh
  if (!entry || now > entry.resetAt) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt };
  }

  // Within window — increment
  entry.count++;

  if (entry.count > config.limit) {
    return { allowed: false, limit: config.limit, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, limit: config.limit, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

/** Pre-built rate limit tiers */
export const RATE_LIMITS = {
  /** Auth endpoints: 10 requests per minute */
  auth: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /** Standard API endpoints: 60 requests per minute */
  api: { limit: 60, windowMs: 60_000 } as RateLimitConfig,
  /** AI generation endpoints: 10 requests per minute */
  ai: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /** Worker tick: 5 requests per minute */
  worker: { limit: 5, windowMs: 60_000 } as RateLimitConfig,
} as const;
