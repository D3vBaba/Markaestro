import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionCookieAsync } from '@/lib/session-cookie';

/** Routes that don't require authentication. */
const PUBLIC_PATHS = ['/login', '/terms', '/privacy', '/contact', '/features', '/channels', '/ai-studio', '/pricing', '/developers/api', '/api/health', '/onboarding', '/onboarding/success', '/oauth/complete', '/auth/action'];

/** Prefixes that are always public (static assets, auth callbacks). */
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/markaestro-logo', '/api/oauth/callback', '/__/auth', '/api/stripe', '/api/onboarding'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function corsAllowList(): string[] {
  return (process.env.PUBLIC_API_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function attachCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin');
  if (!origin) return res;
  const allowed = corsAllowList();
  if (!allowed.length || !allowed.includes(origin)) return res;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.append('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Credentials', 'false');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- CORS for the public API surface only ---
  // We intentionally do NOT attach CORS to the private /api/* routes to
  // prevent browser-based clients on a foreign origin from riding a
  // session cookie via misconfiguration.
  if (pathname.startsWith('/api/public/v1/')) {
    if (req.method === 'OPTIONS') {
      return attachCors(req, new NextResponse(null, { status: 204 }));
    }
    return attachCors(req, NextResponse.next());
  }

  // --- Auth guard for protected pages ---
  if (!isPublicPath(pathname) && !pathname.startsWith('/api/')) {
    const cookie = req.cookies.get('__session')?.value;
    if (!cookie || !(await verifySessionCookieAsync(cookie))) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    // Defense-in-depth: every authenticated page gets X-Robots-Tag: noindex.
    // robots.txt tells well-behaved crawlers to skip these paths; this header
    // catches the rest (internal crawls, cache scraping, etc.).
    const res = NextResponse.next();
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res;
  }

  // Redirect authenticated users away from /login
  if (pathname === '/login') {
    const cookie = req.cookies.get('__session')?.value;
    if (cookie && (await verifySessionCookieAsync(cookie))) {
      const dashboardUrl = req.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      dashboardUrl.search = '';
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
