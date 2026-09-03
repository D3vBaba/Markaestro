import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/privacy', 'privacy');

export default function PrivacyRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
