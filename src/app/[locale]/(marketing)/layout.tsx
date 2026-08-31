import type { Metadata } from 'next';
import MarketingJsonLd from '@/components/marketing/MarketingJsonLd';
import { marketingMetadataBase } from '@/lib/marketing-metadata';

/**
 * Layout for the public marketing surface (markaestro.com).
 *
 * Intentionally provider-free: marketing pages do not need the Firebase
 * auth/subscription/workspace context. Individual pages compose their own
 * chrome via the MarketingLayout component.
 *
 * Per-page title/description/canonical live on each route (client pages cannot
 * export generateMetadata; nested server layouts and the home server wrapper
 * do). This layout only sets metadataBase so relative URLs resolve to the apex,
 * and injects the site-wide JSON-LD graph.
 */
export const metadata: Metadata = {
  metadataBase: marketingMetadataBase(),
};

export default async function MarketingGroupLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  return (
    <>
      <MarketingJsonLd locale={locale} />
      {children}
    </>
  );
}
