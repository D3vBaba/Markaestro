import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

/**
 * Sitemap for the public marketing surface.
 *
 * robots.ts has always advertised `${marketingUrl}/sitemap.xml`; this is the
 * route that answers it. Only the marketing pages are listed — every app path
 * is behind the auth guard and explicitly disallowed in robots.txt.
 *
 * The path list is maintained by hand rather than derived from the route tree:
 * the (app) and (marketing) route groups share a filesystem, so anything
 * automatic would need an allowlist anyway.
 *
 * Every page here is fully localized, including the two developer-docs pages
 * — only the CODE inside them (curl samples, JSON tool schemas, the
 * copy-pasteable agent system-prompt brief) stays English, same as
 * docs/PUBLIC_API.md and public/llms.txt; the surrounding prose translates
 * like every other page.
 */
const MARKETING_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/features', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/channels', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/developers/agents', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/developers/api', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const marketingUrl = (
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://markaestro.com'
  ).replace(/\/$/, '');

  const localePath = (locale: string, path: string) => {
    if (locale === routing.defaultLocale) return path;
    return path === '/' ? `/${locale}` : `/${locale}${path}`;
  };

  return MARKETING_ROUTES.map(({ path, changeFrequency, priority }) => {
    const url = `${marketingUrl}${localePath(routing.defaultLocale, path)}`;

    // hreflang alternates for every locale variant, plus x-default pointing
    // at the unprefixed English page — mirrors the HTML alternates each
    // marketing page now emits. lastmod is omitted: a build-time `new Date()`
    // is not a real content date and would change on every deploy.
    const languages: Record<string, string> = { 'x-default': url };
    for (const locale of routing.locales) {
      languages[locale] = `${marketingUrl}${localePath(locale, path)}`;
    }

    return {
      url,
      changeFrequency,
      priority,
      alternates: { languages },
    };
  });
}
