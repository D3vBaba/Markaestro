import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionCookieAsync } from '@/lib/session-cookie';

/** Routes that don't require authentication. */
const PUBLIC_PATHS = ['/login', '/terms', '/privacy', '/contact', '/features', '/channels', '/ai-studio', '/pricing', '/developers/api', '/api/health', '/onboarding', '/onboarding/success'];

/** Prefixes that are always public (static assets, auth callbacks). */
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/markaestro-logo', '/api/oauth/callback', '/__/auth', '/api/stripe', '/api/onboarding'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Auth guard for protected pages ---
  if (!isPublicPath(pathname) && !pathname.startsWith('/api/')) {
    const cookie = req.cookies.get('__session')?.value;
    if (!cookie || !(await verifySessionCookieAsync(cookie))) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
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
