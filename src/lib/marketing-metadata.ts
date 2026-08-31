import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing, type AppLocale } from '@/i18n/routing';
import {
  absoluteMarketingUrl,
  hreflangLanguages,
  marketingOrigin,
  OG_LOCALE,
} from '@/lib/marketing-seo';

export function marketingSegmentMetadata(path: string, namespace: string) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }): Promise<Metadata> {
    const { locale } = await params;
    return marketingPageMetadata(locale, path, namespace);
  };
}

/**
 * Unique title/description, self-canonical, hreflang, and OG/Twitter for one
 * marketing page. `path` is the unprefixed English path (`/`, `/features`, …).
 */
export async function marketingPageMetadata(
  locale: string,
  path: string,
  namespace: string,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `${namespace}.meta` });
  const canonical = absoluteMarketingUrl(locale, path);
  const title = t('title');
  const description = t('description');
  const ogTitle = t.has('ogTitle') ? t('ogTitle') : title;
  const ogDescription = t.has('ogDescription') ? t('ogDescription') : description;
  const ogLocale = OG_LOCALE[(locale as AppLocale)] ?? 'en_US';

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: hreflangLanguages(path),
    },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: canonical,
      siteName: 'Markaestro',
      locale: ogLocale,
      type: 'website',
      alternateLocale: routing.locales
        .filter((l) => l !== locale)
        .map((l) => OG_LOCALE[l]),
    },
    twitter: {
      card: 'summary',
      title: ogTitle,
      description: ogDescription,
    },
    robots: { index: true, follow: true },
  };
}

export function marketingMetadataBase(): URL {
  return new URL(`${marketingOrigin()}/`);
}
