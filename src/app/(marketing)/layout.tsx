/**
 * Layout for the public marketing surface (markaestro.com).
 *
 * Intentionally provider-free: marketing pages do not need the Firebase
 * auth/subscription/workspace context. Individual pages compose their own
 * chrome via the MarketingLayout component.
 */
export default function MarketingGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
