import type { MetadataRoute } from 'next';

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

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://markaestro.com';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW,
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
    host: appUrl,
  };
}
