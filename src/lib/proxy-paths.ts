/**
 * Pure path-classification helpers for src/proxy.ts, split into their own
 * module so they're importable from plain vitest tests. proxy.ts itself
 * imports `createMiddleware` from `next-intl/middleware`, which transitively
 * pulls in `next/server` — that only resolves inside Next.js's own build
 * pipeline, so anything importing proxy.ts directly fails under vitest. This
 * file has no such import (only `next-intl/routing`, via routing.ts, which is
 * a pure config builder) and stays test-importable.
 */
import { routing, type AppLocale } from '@/i18n/routing';

/**
 * Strips a locale prefix (`/es/pricing` → `{ locale: 'es', rest: '/pricing' }`)
 * for classification purposes only — every path-matching helper below is fed
 * `rest` so a locale-prefixed marketing URL is recognized the same as its
 * unprefixed English equivalent. `en` is never prefixed (see routing.ts), so
 * a request with no recognized locale segment resolves to `{ locale: 'en',
 * rest: pathname }` unchanged — every existing (app)/api path is safe here,
 * since none of them start with a two-letter segment that collides with a
 * locale code.
 */
export function stripLocale(pathname: string): { locale: AppLocale; rest: string } {
  const segments = pathname.split('/');
  const candidate = segments[1];
  if (candidate && (routing.locales as readonly string[]).includes(candidate) && candidate !== routing.defaultLocale) {
    const rest = '/' + segments.slice(2).join('/');
    return { locale: candidate as AppLocale, rest: rest.length > 1 ? rest.replace(/\/$/, '') : '/' };
  }
  return { locale: routing.defaultLocale, rest: pathname };
}

/** Routes that don't require authentication. */
export const PUBLIC_PATHS = [
  '/login',
  '/terms',
  '/privacy',
  '/contact',
  '/features',
  '/channels',
  '/pricing',
  '/api/health',
  '/onboarding',
  '/onboarding/success',
  '/oauth/complete',
  '/auth/action',
  '/site.webmanifest',
  // Crawler and agent entry points. Served from the marketing apex (see
  // MARKETING_PATHS) and readable without a session.
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
];

/**
 * Prefixes that are always public (static assets, auth callbacks, and the
 * whole developer documentation surface — `/developers/*` mirrors
 * MARKETING_PREFIXES so a new docs page is public the moment it exists).
 */
export const PUBLIC_PREFIXES = ['/_next', '/favicon', '/markaestro-logo', '/developers', '/api/oauth/callback', '/__/auth', '/api/stripe', '/api/onboarding'];

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Exact marketing routes that belong on the apex (markaestro.com). */
export const MARKETING_PATHS = new Set<string>([
  '/',
  '/features',
  '/pricing',
  '/contact',
  '/privacy',
  '/terms',
  '/channels',
  // Crawler + agent entry points. The canonical copy lives on the apex, so the
  // app host redirects here. NOTE: /robots.txt is deliberately absent — see
  // NEVER_RELOCATED_PATHS in proxy.ts.
  '/sitemap.xml',
  '/llms.txt',
]);

/** Prefixes that belong on the marketing apex. */
export const MARKETING_PREFIXES = ['/developers'];

export function isMarketingPath(pathname: string): boolean {
  if (MARKETING_PATHS.has(pathname)) return true;
  return MARKETING_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The strict subset of MARKETING_PATHS that actually lives under
 * `src/app/[locale]/(marketing)/...` and needs next-intl's middleware to
 * resolve/rewrite/redirect by locale. `/sitemap.xml` and `/llms.txt` belong
 * on the marketing apex (see MARKETING_PATHS, used for the host split) but
 * are NOT part of the `[locale]` segment — sitemap.ts lives at the true app
 * root and llms.txt is a static public file, so running the intl middleware
 * on them would try to rewrite to e.g. `/en/sitemap.xml`, which doesn't exist
 * as a route, and 404 them.
 */
export const LOCALE_ROUTED_PATHS = new Set<string>(['/', '/features', '/pricing', '/contact', '/privacy', '/terms', '/channels']);
export const LOCALE_ROUTED_PREFIXES = ['/developers'];

export function isLocaleRoutedPath(pathname: string): boolean {
  if (LOCALE_ROUTED_PATHS.has(pathname)) return true;
  return LOCALE_ROUTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
