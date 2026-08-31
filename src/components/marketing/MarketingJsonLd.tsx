/**
 * Organization + WebSite + SoftwareApplication JSON-LD for the public
 * marketing surface. Identity URL is the apex, never the app host.
 */
const ORIGIN = 'https://markaestro.com';

export default function MarketingJsonLd({ locale }: { locale: string }) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${ORIGIN}/#organization`,
        name: 'Markaestro',
        url: ORIGIN,
        logo: `${ORIGIN}/markaestro-logo-transparent.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${ORIGIN}/#website`,
        url: ORIGIN,
        name: 'Markaestro',
        inLanguage: locale,
        publisher: { '@id': `${ORIGIN}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${ORIGIN}/#app`,
        name: 'Markaestro',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: ORIGIN,
        publisher: { '@id': `${ORIGIN}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  );
}
