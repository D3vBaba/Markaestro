import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadPostHistoryRecord } from '@/lib/analytics/post-history';

export const runtime = 'nodejs';

/**
 * GET /api/analytics/posts/{id}/history
 *
 * The stage snapshots the poller stored for one post (1h, 6h, 24h, ... after
 * publish), totalled across channels with the growth between stages, so a
 * person can see how a post earned its numbers over time rather than only
 * where it ended up. The id may name a Markaestro post or a post published
 * directly on the platform; the answer says which in `post.source`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `analytics-history:${ctx.uid}:${ctx.workspaceId}` });

    const { id } = await params;
    const record = await loadPostHistoryRecord(ctx.workspaceId, id);
    if (!record || record.status !== 'published') throw new Error('NOT_FOUND');

    return apiOk({
      post: {
        id,
        content: (record.post.content || '').slice(0, 160),
        publishedAt: record.post.publishedAt ?? null,
        channels: record.channels,
        externalUrl: record.post.externalUrl ?? null,
        source: record.source,
        metricsStatus: record.metricsStatus,
        nextPollAt: record.nextPollAt,
      },
      stages: record.stages,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return apiError(error);
  }
}
