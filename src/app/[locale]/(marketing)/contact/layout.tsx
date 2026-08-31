import { marketingSegmentMetadata } from '@/lib/marketing-metadata';

export const generateMetadata = marketingSegmentMetadata('/contact', 'contact');

export default function ContactRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
