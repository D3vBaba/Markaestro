import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionCookieAsync } from '@/lib/session-cookie';

/** Routes that don't require authentication. */
const PUBLIC_PATHS = [
  '/login',
  '/terms',
  '/privacy',
  '/contact',
  '/features',
  '/channels',
  '/pricing',
  '/developers/api',
  '/api/health',
  '/onboarding',
  '/onboarding/success',
  '/oauth/complete',
  '/auth/action',
  '/site.webmanifest',
];

/** Prefixes that are always public (static assets, auth callbacks). */
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/markaestro-logo', '/api/oauth/callback', '/__/auth', '/api/stripe', '/api/onboarding'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Domain split (marketing vs. app)
//
// markaestro.com        → public marketing surface
// app.markaestro.com    → the application
//
// The apex→subdomain redirect is the only behaviour that can take the live
// app down (if it activates before app.markaestro.com is fully provisioned).
// It is therefore gated behind APP_DOMAIN_SPLIT_ENABLED. With the flag unset
// (or "0"), this middleware behaves exactly as it did before the split: every
// route is served on whatever host requested it. Flip the flag to "1" only
// after app.markaestro.com is verified live. Rolling back = set it to "0".
//
// /api/* is NEVER host-redirected: OAuth provider callbacks and the Stripe
// webhook stay on markaestro.com, while the app calls its own /api/* on the
// subdomain. Both must keep working on both hosts.
// ---------------------------------------------------------------------------

/** Exact marketing routes that belong on the apex (markaestro.com). */
const MARKETING_PATHS = new Set<string>([
  '/',
  '/features',
  '/pricing',
  '/contact',
  '/privacy',
  '/terms',
  '/channels',
]);

/** Prefixes that belong on the marketing apex. */
const MARKETING_PREFIXES = ['/developers'];

function isMarketingPath(pathname: string): boolean {
  if (MARKETING_PATHS.has(pathname)) return true;
  return MARKETING_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function splitEnabled(): boolean {
  const v = process.env.APP_DOMAIN_SPLIT_ENABLED;
  return v === '1' || v === 'true';
}

function hostnameFromEnv(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Dedicated host-routing config, deliberately separate from NEXT_PUBLIC_APP_URL
// (which stays on the apex so /api/* helpers like the TikTok media proxy never
// depend on the subdomain being provisioned).
const APP_URL = process.env.NEXT_PUBLIC_APP_ORIGIN;
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL;
const APP_HOSTNAME = hostnameFromEnv(APP_URL);
const MARKETING_HOSTNAME = hostnameFromEnv(MARKETING_URL);

function requestHostname(req: NextRequest): string {
  // x-mk-host is injected by the Firebase Hosting reverse proxy (hosting-proxy)
  // and carries the real public host (app.markaestro.com / markaestro.com). We
  // read it FIRST: Google Front End rewrites x-forwarded-host to the internal
  // *.hosted.app name on the proxy→backend hop, so x-forwarded-host can no
  // longer be trusted to hold the public host here.
  const raw =
    req.headers.get('x-mk-host') ||
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    '';
  return raw.split(':')[0].trim().toLowerCase();
}

function isMarketingHost(host: string): boolean {
  if (!MARKETING_HOSTNAME) return false;
  return host === MARKETING_HOSTNAME || host === `www.${MARKETING_HOSTNAME}`;
}

/**
 * Host-based redirect. Returns a redirect response when the requested host is
 * wrong for the path, otherwise null. Only active when the split flag is on
 * and both host envs are configured (so local dev is unaffected). Uses 307
 * (temporary) redirects so a rollback is never cached permanently by browsers.
 */
function hostRedirect(req: NextRequest): NextResponse | null {
  if (!splitEnabled()) return null;
  if (!APP_HOSTNAME || !MARKETING_HOSTNAME) return null;

  const { pathname, search } = req.nextUrl;

  // Never relocate API routes or Next internals/static.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next')) return null;

  const host = requestHostname(req);
  // Unknown hosts (preview channels, *.run.app, health checks) are left alone.
  if (host !== APP_HOSTNAME && !isMarketingHost(host)) return null;

  // On the app host: send the bare root to the dashboard (the auth guard will
  // bounce to /login if needed); push any other marketing route to the apex.
  if (host === APP_HOSTNAME) {
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url, 307);
    }
    if (isMarketingPath(pathname)) {
      return NextResponse.redirect(`${MARKETING_URL}${pathname}${search}`, 307);
    }
    return null;
  }

  // On a marketing host: push app routes to the subdomain.
  if (isMarketingHost(host) && !isMarketingPath(pathname)) {
    return NextResponse.redirect(`${APP_URL}${pathname}${search}`, 307);
  }

  return null;
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

  // --- Host-based split (marketing apex vs. app subdomain) ---
  // Runs before the auth guard so a misplaced URL is relocated to the correct
  // host first. No-op unless APP_DOMAIN_SPLIT_ENABLED is on.
  const relocated = hostRedirect(req);
  if (relocated) return relocated;

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
