import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/channels', 'channels');

export default function ChannelsRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
