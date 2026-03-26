import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from '@/lib/rate-limit';

/** Routes that don't require authentication. */
const PUBLIC_PATHS = ['/login', '/terms', '/privacy', '/contact', '/features', '/channels', '/ai-studio', '/api/health'];

/** Prefixes that are always public (static assets, auth callbacks). */
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/markaestro-logo', '/api/oauth/callback'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Determine the rate limit tier for a given pathname.
 */
function getTier(pathname: string): RateLimitConfig | null {
  if (!pathname.startsWith('/api/')) return null;
  if (pathname === '/api/health') return null;
  if (pathname.startsWith('/api/oauth/')) return RATE_LIMITS.auth;
  if (pathname.startsWith('/api/ai/')) return RATE_LIMITS.ai;
  if (pathname.startsWith('/api/worker/')) return RATE_LIMITS.worker;
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
  const { pathname } = req.nextUrl;

  // --- Auth guard for protected pages ---
  if (!isPublicPath(pathname) && !pathname.startsWith('/api/')) {
    const session = req.cookies.get('__session')?.value;
    if (!session) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect authenticated users away from /login
  if (pathname === '/login') {
    const session = req.cookies.get('__session')?.value;
    if (session) {
      const dashboardUrl = req.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      dashboardUrl.search = '';
      return NextResponse.redirect(dashboardUrl);
    }
  }

  // --- Rate limiting for API routes ---
  const tier = getTier(pathname);
  if (!tier) return NextResponse.next();

  const ip = getClientIp(req);
  const key = `${ip}:${pathname}`;
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
