import { NextResponse } from 'next/server';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError } from '@/lib/api-response';
import { getEffectiveSubscription } from '@/lib/stripe/subscription';
import { PLANS, type PlanTier } from '@/lib/stripe/plans';
import { fetchPostRowsForExport, type AnalyticsPostRow } from '@/lib/analytics/query';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';

function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR at cell start).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function csvCell(value: number | string | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  return csvEscape(value);
}

function toCsv(rows: AnalyticsPostRow[]): string {
  const header = [
    'post_id', 'published_at', 'channels', 'content_type', 'content',
    'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks',
    'engagements', 'engagement_rate_by_reach', 'url',
  ].join(',');
  const lines = rows.map((r) => [
    csvCell(r.id),
    csvCell(r.publishedAt),
    csvCell(r.channels.join('|')),
    csvCell(r.contentType),
    csvCell(r.content),
    csvCell(r.views),
    csvCell(r.reach),
    csvCell(r.likes),
    csvCell(r.comments),
    csvCell(r.shares),
    csvCell(r.saves),
    csvCell(r.clicks),
    csvCell(r.engagements),
    csvCell(r.erByReach === null ? null : r.erByReach.toFixed(6)),
    csvCell(r.externalUrl),
  ].join(','));
  return [header, ...lines].join('\n');
}

/** GET /api/analytics/export?days=90 — per-post CSV. Business plan only. */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');

    const sub = await getEffectiveSubscription(ctx.uid, ctx.workspaceId);
    const tier = (sub?.tier ?? 'starter') as PlanTier;
    if (!PLANS[tier].gated.analyticsCsvExport) {
      return NextResponse.json({ error: 'PLAN_UPGRADE_REQUIRED' }, { status: 402 });
    }

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(
      Number.parseInt(url.searchParams.get('days') || '90', 10) || 90,
      730,
    ));
    const channelParam = url.searchParams.get('channel') || undefined;
    const channel = channelParam && (socialChannels as readonly string[]).includes(channelParam)
      ? (channelParam as SocialChannel)
      : undefined;
    const productId = url.searchParams.get('productId') || undefined;

    const sinceIso = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    const rows = await fetchPostRowsForExport(ctx.workspaceId, sinceIso, channel, productId);
    const csv = toCsv(rows);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="markaestro-analytics-${days}d.csv"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
