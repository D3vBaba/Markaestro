import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/terms', 'terms');

export default function TermsRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
