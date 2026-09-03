import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/developers/api', 'developersApi');

export default function DevelopersApiRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
