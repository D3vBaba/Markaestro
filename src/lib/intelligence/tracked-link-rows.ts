/**
 * The wire shape of a tracked link, shared by the list route and the
 * single-link routes so the two cannot describe the same document
 * differently.
 */

/** Counters live on the link document (see recordTrackedLinkClick): no click scan. */
export function trackedLinkRow(data: Record<string, unknown>, origin: string) {
  const code = String(data.code || '');
  return {
    code,
    label: String(data.label || ''),
    destination: String(data.destination || ''),
    productId: String(data.productId || ''),
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : null,
    socialPostId: typeof data.socialPostId === 'string' ? data.socialPostId : null,
    active: data.active !== false,
    deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : null,
    url: `${origin}/r/${code}`,
    clicks: Number(data.clicks) || 0,
    lastClickedAt: typeof data.lastClickedAt === 'string' ? data.lastClickedAt : null,
    attributedConversions: Number(data.attributedConversions) || 0,
    lastConversionAt: typeof data.lastConversionAt === 'string' ? data.lastConversionAt : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
  };
}

export type TrackedLinkRow = ReturnType<typeof trackedLinkRow>;

export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}
