import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { adminDb } from '@/lib/firebase-admin';
import { buildPostHistory } from '@/lib/analytics/history';
import type { MetricSnapshotDoc } from '@/lib/analytics/types';
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

export const runtime = 'nodejs';

/**
 * GET /api/analytics/posts/{id}/history
 *
 * The stage snapshots the poller stored for one post (1h, 6h, 24h, ... after
 * publish), totalled across channels with the growth between stages, so a
 * person can see how a post earned its numbers over time rather than only
 * where it ended up.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    await applyRateLimit(req, RATE_LIMITS.api, { key: `analytics-history:${ctx.uid}:${ctx.workspaceId}` });

    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('NOT_FOUND');
    const postRef = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const [postSnap, snapshots] = await Promise.all([
      postRef.get(),
      postRef.collection('metrics').orderBy('capturedAt', 'asc').limit(50).get(),
    ]);
    if (!postSnap.exists) throw new Error('NOT_FOUND');
    const post = postSnap.data() as {
      status?: string;
      content?: string;
      publishedAt?: string;
      channel?: string;
      publishedChannels?: string[];
      externalUrl?: string;
      metricsUpdatedAt?: string;
      metricsByChannel?: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
      metricsStatus?: string;
      metricsNextPollAt?: string;
    };
    if (post.status !== 'published') throw new Error('NOT_FOUND');

    const stages = buildPostHistory({
      publishedAt: post.publishedAt ?? null,
      snapshots: snapshots.docs.map((doc) => doc.data() as MetricSnapshotDoc),
      latest: post.metricsUpdatedAt && post.metricsByChannel
        ? { capturedAt: post.metricsUpdatedAt, byChannel: post.metricsByChannel }
        : null,
    });

    return apiOk({
      post: {
        id,
        content: (post.content || '').slice(0, 160),
        publishedAt: post.publishedAt ?? null,
        channels: (post.publishedChannels?.length ? post.publishedChannels : [post.channel]).filter(Boolean),
        externalUrl: post.externalUrl ?? null,
        metricsStatus: post.metricsStatus ?? null,
        nextPollAt: post.metricsNextPollAt ?? null,
      },
      stages,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return apiError(error);
  }
}
