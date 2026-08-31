import { describe, expect, it } from 'vitest';
import {
  stripLocale,
  isPublicPath,
  isMarketingPath,
  isLocaleRoutedPath,
  isAppPath,
  stripDefaultLocalePrefix,
  APP_ROUTE_PREFIXES,
} from '@/lib/proxy-paths';

// These are the pure path-classification helpers proxy.ts composes locale
// routing around. src/proxy.ts has already caused one production regression
// this week (the /robots.txt host-redirect incident) — this file exists so
// the locale composition gets the same rigor, independent of a running
// Next.js server.

describe('stripLocale', () => {
  it('leaves unprefixed paths as the default locale, unchanged', () => {
    expect(stripLocale('/pricing')).toEqual({ locale: 'en', rest: '/pricing' });
    expect(stripLocale('/')).toEqual({ locale: 'en', rest: '/' });
  });

  it('strips a recognized non-default locale prefix', () => {
    expect(stripLocale('/es/pricing')).toEqual({ locale: 'es', rest: '/pricing' });
    expect(stripLocale('/ar/developers/agents')).toEqual({ locale: 'ar', rest: '/developers/agents' });
  });

  it('resolves the bare locale segment to the root', () => {
    expect(stripLocale('/es')).toEqual({ locale: 'es', rest: '/' });
    expect(stripLocale('/es/')).toEqual({ locale: 'es', rest: '/' });
  });

  it('never treats "en" itself as a prefix to strip — en is unprefixed by design', () => {
    expect(stripLocale('/en/pricing')).toEqual({ locale: 'en', rest: '/en/pricing' });
  });

  it('does not mistake app/api path segments for locale codes', () => {
    expect(stripLocale('/api/public/v1/posts')).toEqual({ locale: 'en', rest: '/api/public/v1/posts' });
    expect(stripLocale('/dashboard')).toEqual({ locale: 'en', rest: '/dashboard' });
    expect(stripLocale('/settings')).toEqual({ locale: 'en', rest: '/settings' });
  });

  it('rejects unknown two-letter segments that merely look like a locale', () => {
    // "xx" is not one of the 11 configured locales — must not be stripped.
    expect(stripLocale('/xx/pricing')).toEqual({ locale: 'en', rest: '/xx/pricing' });
  });
});

describe('isPublicPath — fed the locale-stripped path', () => {
  it('treats a locale-prefixed marketing page the same as its English equivalent', () => {
    expect(isPublicPath(stripLocale('/es/pricing').rest)).toBe(true);
    expect(isPublicPath(stripLocale('/pricing').rest)).toBe(true);
  });

  it('treats a locale-prefixed developers path as public via the prefix rule', () => {
    expect(isPublicPath(stripLocale('/fr/developers/agents').rest)).toBe(true);
  });

  it('keeps the link shortener reachable without a session', () => {
    // /r/{code} is the public link-shortener hop: a visitor arriving from a
    // customer's post has no session, and bouncing them to /login makes every
    // tracked link a dead end for exactly the audience it was made for.
    expect(isPublicPath('/r/abc123')).toBe(true);
    expect(isPublicPath('/link-unavailable')).toBe(true);
  });

  it('does not make an unrelated route public just because it starts with r', () => {
    expect(isPublicPath('/reports')).toBe(false);
  });

  it('leaves (app) routes protected regardless of a bogus locale-shaped prefix', () => {
    expect(isPublicPath(stripLocale('/dashboard').rest)).toBe(false);
    expect(isPublicPath(stripLocale('/settings').rest)).toBe(false);
  });

  it('keeps crawler/agent entry points public', () => {
    expect(isPublicPath('/robots.txt')).toBe(true);
    expect(isPublicPath('/sitemap.xml')).toBe(true);
    expect(isPublicPath('/llms.txt')).toBe(true);
    expect(isPublicPath('/ai.txt')).toBe(true);
  });
});

describe('isMarketingPath — fed the locale-stripped path (host-split gate)', () => {
  it('recognizes a locale-prefixed marketing page as belonging on the apex', () => {
    expect(isMarketingPath(stripLocale('/es/pricing').rest)).toBe(true);
    expect(isMarketingPath(stripLocale('/ar/channels').rest)).toBe(true);
  });

  it('recognizes sitemap.xml/llms.txt/ai.txt as apex-only (host-split still applies to them)', () => {
    expect(isMarketingPath('/sitemap.xml')).toBe(true);
    expect(isMarketingPath('/llms.txt')).toBe(true);
    expect(isMarketingPath('/ai.txt')).toBe(true);
  });

  it('does not treat an (app) route as a marketing path even with a locale-shaped prefix', () => {
    expect(isMarketingPath(stripLocale('/es/dashboard').rest)).toBe(false);
  });

  it('does not treat unknown junk paths as marketing (those must 404 on the apex)', () => {
    expect(isMarketingPath('/this-path-should-not-exist-xyz123')).toBe(false);
    expect(isMarketingPath('/blog')).toBe(false);
    expect(isMarketingPath('/faq')).toBe(false);
    expect(isMarketingPath('/sitemap-index.xml')).toBe(false);
  });
});

describe('isAppPath — the allowlist of product routes that 307 apex → app', () => {
  it('matches every (app) route prefix that actually exists', () => {
    for (const p of [
      '/login',
      '/dashboard',
      '/settings',
      '/products',
      '/calendar',
      '/content',
      '/onboarding',
      '/onboarding/success',
      '/oauth/complete',
      '/intelligence',
      '/analytics',
      '/guides/channels',
      '/auth/action',
    ]) {
      expect(isAppPath(p)).toBe(true);
    }
  });

  it('matches nested paths under those prefixes', () => {
    expect(isAppPath('/dashboard/anything')).toBe(true);
    expect(isAppPath('/oauth/complete')).toBe(true);
  });

  it('does not relocate marketing pages, crawler files, or junk URLs', () => {
    for (const p of [
      '/',
      '/features',
      '/pricing',
      '/contact',
      '/developers/agents',
      '/sitemap.xml',
      '/llms.txt',
      '/ai.txt',
      '/blog',
      '/faq',
      '/this-path-should-not-exist-xyz123',
      '/sitemap-index.xml',
      '/r/abc123',
      '/api/health',
    ]) {
      expect(isAppPath(p)).toBe(false);
    }
  });

  it('classifies locale-stripped app paths the same as unprefixed ones', () => {
    expect(isAppPath(stripLocale('/es/login').rest)).toBe(true);
    expect(isAppPath(stripLocale('/fr/dashboard').rest)).toBe(true);
  });

  it('lists the prefixes the live-crawl audit named, plus oauth/onboarding/content', () => {
    expect([...APP_ROUTE_PREFIXES]).toEqual([
      '/login',
      '/dashboard',
      '/settings',
      '/products',
      '/calendar',
      '/content',
      '/onboarding',
      '/oauth',
      '/intelligence',
      '/analytics',
      '/guides',
      '/auth',
    ]);
  });
});

describe('stripDefaultLocalePrefix', () => {
  it('strips /en and /en/ to the unprefixed root', () => {
    expect(stripDefaultLocalePrefix('/en')).toBe('/');
    expect(stripDefaultLocalePrefix('/en/')).toBe('/');
  });

  it('strips /en/pricing to /pricing', () => {
    expect(stripDefaultLocalePrefix('/en/pricing')).toBe('/pricing');
    expect(stripDefaultLocalePrefix('/en/developers/agents')).toBe('/developers/agents');
  });

  it('leaves unprefixed English and other locales alone', () => {
    expect(stripDefaultLocalePrefix('/')).toBeNull();
    expect(stripDefaultLocalePrefix('/pricing')).toBeNull();
    expect(stripDefaultLocalePrefix('/es')).toBeNull();
    expect(stripDefaultLocalePrefix('/es/pricing')).toBeNull();
    expect(stripDefaultLocalePrefix('/enterprise')).toBeNull();
  });
});

describe('isLocaleRoutedPath — the narrower gate for next-intl middleware', () => {
  it('matches every page under src/app/[locale]/(marketing)', () => {
    for (const p of ['/', '/features', '/pricing', '/contact', '/privacy', '/terms', '/channels', '/developers/api', '/developers/agents']) {
      expect(isLocaleRoutedPath(p)).toBe(true);
    }
  });

  it('excludes sitemap.xml and llms.txt — they live outside the [locale] segment', () => {
    // Rewriting these to /en/sitemap.xml would 404 them; isMarketingPath
    // includes them (for the host split) but isLocaleRoutedPath must not.
    expect(isLocaleRoutedPath('/sitemap.xml')).toBe(false);
    expect(isLocaleRoutedPath('/llms.txt')).toBe(false);
  });

  it('excludes robots.txt and (app) routes', () => {
    expect(isLocaleRoutedPath('/robots.txt')).toBe(false);
    expect(isLocaleRoutedPath('/dashboard')).toBe(false);
    expect(isLocaleRoutedPath('/settings')).toBe(false);
  });
});
