import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from '@/lib/rate-limit';

/**
 * Determine the rate limit tier for a given pathname.
 */
function getTier(pathname: string): RateLimitConfig | null {
  // Public pages — no rate limiting
  if (!pathname.startsWith('/api/')) return null;

  // Health check — no rate limiting
  if (pathname === '/api/health') return null;

  // Auth-related endpoints — strict limits
  if (pathname.startsWith('/api/oauth/')) return RATE_LIMITS.auth;

  // AI generation — strict limits
  if (pathname.startsWith('/api/ai/')) return RATE_LIMITS.ai;

  // Worker — strict limits
  if (pathname.startsWith('/api/worker/')) return RATE_LIMITS.worker;

  // All other API routes
  return RATE_LIMITS.api;
}

/**
 * Extract client IP for rate limit key.
 */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function middleware(req: NextRequest) {
  const tier = getTier(req.nextUrl.pathname);
  if (!tier) return NextResponse.next();

  const ip = getClientIp(req);
  const key = `${ip}:${req.nextUrl.pathname}`;
  const result = checkRateLimit(key, tier);

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(result.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
