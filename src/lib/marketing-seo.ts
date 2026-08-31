import { routing, type AppLocale } from '@/i18n/routing';

/**
 * Pure marketing-SEO URL helpers. Kept free of `next/server` / `next-intl/server`
 * so vitest can import them the same way it imports proxy-paths.ts.
 */

export function marketingOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://markaestro.com'
  ).replace(/\/$/, '');
}

/** Locale-prefixed path. `en` is unprefixed (`localePrefix: "as-needed"`). */
export function localizedPath(locale: string, path: string): string {
  if (locale === routing.defaultLocale) return path === '' ? '/' : path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

export function absoluteMarketingUrl(locale: string, path: string): string {
  return `${marketingOrigin()}${localizedPath(locale, path)}`;
}

/**
 * hreflang map for a marketing path: every configured locale plus x-default
 * pointing at the unprefixed English URL.
 */
export function hreflangLanguages(path: string): Record<string, string> {
  const languages: Record<string, string> = {
    'x-default': absoluteMarketingUrl(routing.defaultLocale, path),
  };
  for (const locale of routing.locales) {
    languages[locale] = absoluteMarketingUrl(locale, path);
  }
  return languages;
}

/** Open Graph locale tags (underscore form). `pt` ships pt-BR; `zh` ships zh-CN. */
export const OG_LOCALE: Record<AppLocale, string> = {
  en: 'en_US',
  es: 'es_ES',
  fr: 'fr_FR',
  de: 'de_DE',
  pt: 'pt_BR',
  ja: 'ja_JP',
  zh: 'zh_CN',
  ko: 'ko_KR',
  it: 'it_IT',
  nl: 'nl_NL',
  ar: 'ar_SA',
};

/**
 * Message-catalog namespace that holds `meta.title` / `meta.description` for
 * each public marketing path. Keep in lockstep with sitemap.ts.
 */
export const MARKETING_META_BY_PATH: Record<string, string> = {
  '/': 'home',
  '/features': 'features',
  '/channels': 'channels',
  '/pricing': 'pricing',
  '/contact': 'contact',
  '/terms': 'terms',
  '/privacy': 'privacy',
  '/developers/agents': 'developersAgents',
  '/developers/api': 'developersApi',
};
