import type { MetadataRoute } from 'next';

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

  const lastModified = new Date();

  return MARKETING_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${marketingUrl}${path === '/' ? '' : path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
