import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { verifySessionCookieAsync } from '@/lib/session-cookie';
import { routing } from '@/i18n/routing';
import {
  stripLocale,
  isPublicPath,
  isMarketingPath,
  isAppPath,
  isLocaleRoutedPath,
  stripDefaultLocalePrefix,
} from '@/lib/proxy-paths';

const intlMiddleware = createMiddleware(routing);

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

/**
 * Paths that must never be host-redirected, because each host has to answer
 * them with its OWN content.
 *
 * robots.txt is per-host by definition: a crawler fetching
 * app.markaestro.com/robots.txt applies whatever it gets back to that host.
 * robots.ts already branches on host (apex → marketing rules; app → disallow
 * all), so relocating the request in either direction breaks one of the two:
 * sending the apex to the app host deindexes the marketing site, and sending
 * the app host to the apex hands the private app an "Allow: /".
 */
const NEVER_RELOCATED_PATHS = new Set<string>(['/robots.txt']);

/**
 * Request id, minted here so every log line, every Sentry event, and the id
 * shown in a user's error toast are the same string.
 *
 * Deliberately duplicated from `src/lib/request-context.ts` rather than
 * imported: this file runs in the Edge runtime, and that module depends on
 * `node:async_hooks`. The header name and the accepted shape are the contract
 * between them, and `request-context.test.ts` pins both.
 */
const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Adopt the caller's id when it is well-formed, otherwise mint one. Callers
 * (our own browser client) supply an id so a screenshot of a failure can be
 * traced; validating the shape keeps arbitrary caller text out of the logs.
 */
function ensureRequestId(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER);
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) return supplied;
  const minted = crypto.randomUUID();
  headers.set(REQUEST_ID_HEADER, minted);
  return minted;
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
 * and both host envs are configured (so local dev is unaffected).
 *
 * Cross-host hops for the live split use 307 so a rollback is never cached
 * permanently. www → apex uses 301 (host canonicalization is permanent).
 *
 * Classifies by the locale-stripped path (`stripLocale(pathname).rest`) so a
 * prefixed URL like `/es/pricing` is recognized as the same marketing path as
 * `/pricing`. Marketing hops keep the ORIGINAL pathname so the locale prefix
 * survives. App hops use the stripped path: the (app) tree is not locale-
 * scoped, so `/es/login` must land on `/login`, not `/es/login`.
 *
 * Unknown apex paths are intentionally NOT relocated. Sending them to the app
 * made every junk URL a 307 → login soft-404 with the marketing title. They
 * stay on the apex and hit `src/app/not-found.tsx` as a real 404.
 */
function hostRedirect(req: NextRequest): NextResponse | null {
  if (!splitEnabled()) return null;
  if (!APP_HOSTNAME || !MARKETING_HOSTNAME) return null;

  const { pathname, search } = req.nextUrl;

  // Never relocate API routes, Next internals/static, or the per-host files
  // each host must answer for itself.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next')) return null;
  if (NEVER_RELOCATED_PATHS.has(pathname)) return null;
  // OAuth discovery must answer on the host the MCP client asked, because
  // the documents name that host as the issuer.
  if (pathname.startsWith('/.well-known/')) return null;

  const { rest } = stripLocale(pathname);

  const host = requestHostname(req);
  // Unknown hosts (preview channels, *.run.app, health checks) are left alone.
  if (host !== APP_HOSTNAME && !isMarketingHost(host)) return null;

  // www → apex. Defense in depth: www.markaestro.com is not a Firebase custom
  // domain yet, so this path is not hit in production until the cert exists.
  // 301, not 307: the host canonical is permanent.
  if (host === `www.${MARKETING_HOSTNAME}`) {
    return NextResponse.redirect(`${MARKETING_URL}${pathname}${search}`, 301);
  }

  // On the app host: send the bare root to the dashboard (the auth guard will
  // bounce to /login if needed); push any other marketing route to the apex.
  // The app itself isn't locale-scoped yet, so its bare root is never prefixed.
  if (host === APP_HOSTNAME) {
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url, 307);
    }
    if (isMarketingPath(rest)) {
      return NextResponse.redirect(`${MARKETING_URL}${pathname}${search}`, 307);
    }
    return null;
  }

  // On a marketing host: relocate *known* app routes only. /login and
  // /dashboard stay 307s to the app; /blog, /faq, and junk paths 404 here.
  if (isMarketingHost(host) && isAppPath(rest)) {
    return NextResponse.redirect(`${APP_URL}${rest}${search}`, 307);
  }

  return null;
}

function corsAllowList(): string[] {
  return (process.env.PUBLIC_API_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Forwards the request pathname to the React tree via a request header, so
 * the root layout (src/app/layout.tsx, shared by both the [locale] marketing
 * tree and the (app) group) can tell which one it's rendering. next-intl's
 * getLocale() only resolves correctly inside [locale]; outside it, it always
 * returns the default locale with no way to distinguish "genuinely en" from
 * "no locale segment at all" — the root layout needs the real pathname to
 * fall back to resolveAppLocale() only for the latter case. See
 * src/app/layout.tsx's resolveRootLocale().
 */
function nextWithPathname(req: NextRequest): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', req.nextUrl.pathname);
  const requestId = ensureRequestId(requestHeaders);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
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
  res.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Request-Id');
  // Without this the browser hides the id from the very clients most likely
  // to need it when reporting a failed call.
  res.headers.set('Access-Control-Expose-Headers', 'X-Request-Id');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get('__session')?.value;
  return Boolean(cookie && (await verifySessionCookieAsync(cookie)));
}

function dashboardRedirectUrl(req: NextRequest): URL | string {
  if (splitEnabled() && APP_URL) {
    return `${APP_URL}/dashboard`;
  }
  const url = req.nextUrl.clone();
  url.pathname = '/dashboard';
  url.search = '';
  return url;
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
    const requestHeaders = new Headers(req.headers);
    const requestId = ensureRequestId(requestHeaders);
    const res = attachCors(req, NextResponse.next({ request: { headers: requestHeaders } }));
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  // --- Default-locale prefix ---
  // `en` is unprefixed. /en and /en/pricing are duplicates; 301 to the
  // canonical unprefixed URL. Must run before the host split so /en/login
  // becomes /login and then 307s to the app, rather than 404ing as /en/login.
  const unprefixed = stripDefaultLocalePrefix(pathname);
  if (unprefixed !== null) {
    const url = req.nextUrl.clone();
    url.pathname = unprefixed;
    return NextResponse.redirect(url, 301);
  }

  // --- Host-based split (marketing apex vs. app subdomain) ---
  // Runs before the auth guard so a misplaced URL is relocated to the correct
  // host first. No-op unless APP_DOMAIN_SPLIT_ENABLED is on.
  const relocated = hostRedirect(req);
  if (relocated) return relocated;

  const { rest } = stripLocale(pathname);
  const host = requestHostname(req);
  const onMarketingHost = splitEnabled() && isMarketingHost(host);

  // Authenticated users visiting the public root should land in the product,
  // not the marketing CTA loop. Keep other marketing pages readable. Checked
  // against the locale-stripped path so /es, /fr, etc. behave like /.
  if (rest === '/' && await hasValidSession(req)) {
    return NextResponse.redirect(dashboardRedirectUrl(req), 307);
  }

  // --- Auth guard for protected pages ---
  // isPublicPath runs against the locale-stripped path so /es/pricing is
  // recognized as public the same as /pricing; (app) routes never carry a
  // locale prefix today, so they're completely unaffected (rest === pathname
  // for anything that doesn't start with a real locale segment).
  //
  // On the marketing apex, skip the guard entirely: known app paths have
  // already been 307'd, and anything else (junk URLs, future marketing pages)
  // must 404 here instead of bouncing to /login (which would 307 to the app
  // and look like a homepage clone).
  if (!onMarketingHost && !isPublicPath(rest) && !pathname.startsWith('/api/')) {
    if (!(await hasValidSession(req))) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    // Defense-in-depth: every authenticated page gets X-Robots-Tag: noindex.
    // robots.txt tells well-behaved crawlers to skip these paths; this header
    // catches the rest (internal crawls, cache scraping, etc.).
    const res = nextWithPathname(req);
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res;
  }

  // Redirect authenticated users away from /login. /login is never
  // locale-prefixed (it's an (app) route, outside src/app/[locale]).
  if (pathname === '/login') {
    if (await hasValidSession(req)) {
      return NextResponse.redirect(dashboardRedirectUrl(req));
    }
  }

  // --- Locale resolution for the marketing surface ---
  // Delegated to next-intl: for the unprefixed default locale (en) it
  // rewrites internally to the /en/... segment so src/app/[locale] resolves;
  // for other locales it validates the prefix and negotiates
  // Accept-Language/cookie-based auto-redirects for unprefixed visits. Gated
  // on isLocaleRoutedPath (not isMarketingPath) so robots.txt/sitemap.xml/
  // llms.txt — real marketing-apex paths that live OUTSIDE the [locale]
  // segment — are never rewritten and keep falling through to plain
  // NextResponse.next() below, exactly as before this feature existed.
  if (isLocaleRoutedPath(rest)) {
    return intlMiddleware(req);
  }

  const res = nextWithPathname(req);
  // Public app routes (/login, /onboarding, /auth/action, /oauth/complete)
  // skip the authenticated-page header above. Tag them noindex so a crawler
  // that ignores robots.txt Disallow cannot index login HTML.
  if (isAppPath(rest)) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
