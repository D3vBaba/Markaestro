/**
 * Firestore-backed sliding-window rate limiter.
 * Safe for multi-instance deployments (Cloud Run with maxInstances > 1).
 *
 * Each window is a single Firestore doc in `_rateLimits/{docId}`.
 * Set a Firestore TTL policy on the `expiresAt` field to auto-cleanup.
 */

import { adminDb } from '@/lib/firebase-admin';
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
 * Check if a request is within rate limits using Firestore atomic increment.
 * Returns { allowed, limit, remaining, resetAt }.
 */
export async function checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / config.windowMs);
  const resetAt = (windowId + 1) * config.windowMs;

  // Encode key to be a valid Firestore doc ID (no slashes, reasonable length)
  const docId = Buffer.from(`${key}:${windowId}`).toString('base64url');
  const docRef = adminDb.collection('_rateLimits').doc(docId);

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      tx.set(docRef, {
        count: 1,
        expiresAt: new Date(resetAt + config.windowMs), // TTL: one extra window for safety
      });
      return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt };
    }

    const count = ((snap.data()?.count as number) || 0) + 1;

    if (count > config.limit) {
      return { allowed: false, limit: config.limit, remaining: 0, resetAt };
    }

    tx.update(docRef, { count });
    return { allowed: true, limit: config.limit, remaining: config.limit - count, resetAt };
  });

  return result;
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

export type ApplyRateLimitOptions = {
  /**
   * Explicit rate-limit key. When omitted, the key is `${ip}:${pathname}`.
   * Pass a uid-scoped key for post-auth routes so limits follow the user
   * across devices/IPs.
   */
  key?: string;
};

/**
 * Helper to apply rate limiting inside an API route handler.
 * By default extracts client IP from headers and uses `${ip}:${pathname}`.
 * Throws a Response (429) if rate limited.
 *
 * Usage:
 *   const rl = await applyRateLimit(req, RATE_LIMITS.ai, { key: `ai:${ctx.uid}` });
 */
export async function applyRateLimit(
  req: Request,
  config: RateLimitConfig,
  opts: ApplyRateLimitOptions = {},
): Promise<{ headers: Record<string, string> }> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const pathname = new URL(req.url).pathname;
  const key = opts.key ? `${opts.key}:${pathname}` : `${ip}:${pathname}`;

  const result = await checkRateLimit(key, config);

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    throw new Response(
      JSON.stringify({ error: 'RATE_LIMITED', retryAfter }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), ...headers },
      },
    );
  }

  return { headers };
}
