import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/features', 'features');

export default function FeaturesRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
