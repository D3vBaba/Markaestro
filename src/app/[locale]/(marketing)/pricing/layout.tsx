import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/pricing', 'pricing');

export default function PricingRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
