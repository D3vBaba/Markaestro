import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

// Private, authenticated surfaces. These paths live behind the auth guard in
// `src/proxy.ts`, but search engines still occasionally follow links from
// email/social previews, referral dashboards, or crawlable OAuth error pages.
// Disallowing them keeps indexed content limited to the marketing surface.
const DISALLOW = [
  '/api/',
  '/dashboard',
  '/settings',
  '/products',
  '/analytics',
  '/calendar',
  '/content',
  '/onboarding',
  '/oauth/',
];

function appOriginHostname(): string | null {
  try {
    return process.env.NEXT_PUBLIC_APP_ORIGIN
      ? new URL(process.env.NEXT_PUBLIC_APP_ORIGIN).hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const marketingUrl =
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://markaestro.com';

  const h = await headers();
  // x-mk-host is the real public host injected by the hosting-proxy; prefer it
  // over x-forwarded-host (which GFE rewrites to the internal *.hosted.app name
  // on the proxy→backend hop). See requestHostname() in src/proxy.ts.
  const host = (h.get('x-mk-host') || h.get('x-forwarded-host') || h.get('host') || '')
    .split(':')[0]
    .trim()
    .toLowerCase();

  // The application subdomain is entirely private: disallow all crawling.
  if (host && host === appOriginHostname()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  // Marketing apex: allow the public surface, disallow app paths.
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW,
      },
    ],
    sitemap: `${marketingUrl}/sitemap.xml`,
    host: marketingUrl,
  };
}
