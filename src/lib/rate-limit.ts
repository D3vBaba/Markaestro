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

export type RateLimitCheck = {
  key: string;
  config: RateLimitConfig;
};

/**
 * Check if a request is within rate limits using Firestore atomic increment.
 * Returns { allowed, limit, remaining, resetAt }.
 */
export async function checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  return (await checkRateLimits([{ key, config }]))[0];
}

/**
 * Evaluate several independent limits in one Firestore transaction. Public API
 * authentication needs both a global client limit and a per-route limit; one
 * transaction halves transaction round trips without weakening either rule.
 */
export async function checkRateLimits(checks: RateLimitCheck[]): Promise<RateLimitResult[]> {
  if (checks.length === 0) return [];
  const windows = checks.map(({ key, config }) => {
    const windowId = Math.floor(Date.now() / config.windowMs);
    const resetAt = (windowId + 1) * config.windowMs;
    const docId = Buffer.from(`${key}:${windowId}`).toString('base64url');
    return {
      config,
      resetAt,
      ref: adminDb.collection('_rateLimits').doc(docId),
    };
  });

  return adminDb.runTransaction(async (tx) => {
    // Firestore requires all transaction reads to finish before writes begin.
    const snapshots = await tx.getAll(...windows.map(({ ref }) => ref));
    return windows.map(({ config, resetAt, ref }, index) => {
      const snap = snapshots[index];
      if (!snap.exists) {
        tx.set(ref, {
          count: 1,
          expiresAt: new Date(resetAt + config.windowMs),
        });
        return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt };
      }

      const count = ((snap.data()?.count as number) || 0) + 1;
      if (count > config.limit) {
        return { allowed: false, limit: config.limit, remaining: 0, resetAt };
      }
      tx.update(ref, { count });
      return { allowed: true, limit: config.limit, remaining: config.limit - count, resetAt };
    });
  });
}

/** Pre-built rate limit tiers */
export const RATE_LIMITS = {
  /** Auth endpoints: 10 requests per minute */
  auth: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /** Standard API endpoints: 60 requests per minute */
  api: { limit: 60, windowMs: 60_000 } as RateLimitConfig,
  /** AI generation endpoints: 10 requests per minute */
  ai: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /**
   * Strategist: 5 requests per minute. Lower than `ai` because the handler
   * holds a Cloud Run worker open for the whole model call, so the cost of a
   * burst is a busy instance as well as Vertex spend.
   */
  strategist: { limit: 5, windowMs: 60_000 } as RateLimitConfig,
  /** Worker tick: 5 requests per minute */
  worker: { limit: 5, windowMs: 60_000 } as RateLimitConfig,
  /**
   * In-app publishing: 10 per minute per workspace. Workspace-scoped, not
   * uid-scoped, so a team cannot multiply the limit by adding seats.
   */
  publish: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /**
   * Per connected account per channel: 30 publishes per hour. Platform-abuse
   * insurance; the platforms restrict app credentials on sustained bursts long
   * before our own per-minute ceiling would notice.
   */
  publishPerAccount: { limit: 30, windowMs: 3_600_000 } as RateLimitConfig,
  /**
   * Media proxies: 60 per minute per IP. Generous enough for a platform
   * fetcher (TikTok pulls the URL itself) and tight enough to bound the CPU
   * and bandwidth amplification these unauthenticated routes otherwise offer.
   */
  mediaProxy: { limit: 60, windowMs: 60_000 } as RateLimitConfig,
  /**
   * Deep health probe: 10 per minute even when authenticated. An uptime
   * monitor polls once a minute; anything faster is not a monitor.
   */
  health: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /**
   * Conversion ingest: 300 events per minute per workspace. A real store sends
   * single-digit conversions per minute, so this is generous while still
   * bounding what a leaked ingest key can write.
   */
  ingest: { limit: 300, windowMs: 60_000 } as RateLimitConfig,
  /**
   * Link-shortener click recording: 60 per minute per IP per code. Limits only
   * the analytics write, never the redirect itself.
   */
  redirect: { limit: 60, windowMs: 60_000 } as RateLimitConfig,
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
