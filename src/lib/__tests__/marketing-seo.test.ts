import { describe, expect, it } from 'vitest';
import { routing } from '@/i18n/routing';
import {
  absoluteMarketingUrl,
  hreflangLanguages,
  localizedPath,
  MARKETING_META_BY_PATH,
  marketingOrigin,
} from '@/lib/marketing-seo';

describe('localizedPath', () => {
  it('leaves English unprefixed', () => {
    expect(localizedPath('en', '/')).toBe('/');
    expect(localizedPath('en', '/features')).toBe('/features');
    expect(localizedPath('en', '/developers/agents')).toBe('/developers/agents');
  });

  it('prefixes every other locale, including the bare locale for home', () => {
    expect(localizedPath('es', '/')).toBe('/es');
    expect(localizedPath('es', '/pricing')).toBe('/es/pricing');
    expect(localizedPath('ar', '/developers/agents')).toBe('/ar/developers/agents');
  });
});

describe('hreflangLanguages', () => {
  it('emits en unprefixed, every locale, and x-default on the English URL', () => {
    const languages = hreflangLanguages('/developers/agents');
    const origin = marketingOrigin();
    expect(languages['x-default']).toBe(`${origin}/developers/agents`);
    expect(languages.en).toBe(`${origin}/developers/agents`);
    expect(languages.es).toBe(`${origin}/es/developers/agents`);
    expect(Object.keys(languages)).toEqual(
      expect.arrayContaining(['x-default', ...routing.locales]),
    );
  });

  it('does not put /en in any alternate', () => {
    const languages = hreflangLanguages('/pricing');
    expect(JSON.stringify(languages)).not.toContain('/en/');
    expect(languages.en).toBe(`${marketingOrigin()}/pricing`);
  });
});

describe('absoluteMarketingUrl', () => {
  it('builds a locale-aware self-canonical for Spanish agents', () => {
    expect(absoluteMarketingUrl('es', '/developers/agents')).toBe(
      `${marketingOrigin()}/es/developers/agents`,
    );
  });
});

describe('MARKETING_META_BY_PATH', () => {
  it('covers the nine sitemap English locs and no /en', () => {
    expect(Object.keys(MARKETING_META_BY_PATH).sort()).toEqual([
      '/',
      '/channels',
      '/contact',
      '/developers/agents',
      '/developers/api',
      '/features',
      '/pricing',
      '/privacy',
      '/terms',
    ]);
  });
});
