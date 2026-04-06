import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { getMetaConnectionMerged, getConnection, resolveAccessToken } from '@/lib/platform/connections';
import { getMetaPostEngagement } from '@/lib/ads/meta-ads';
import { decrypt } from '@/lib/crypto';

export type PostEngagement = {
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  videoViews: number;   // TikTok 2-sec plays
  videoWatchTime: number; // TikTok avg watch time (seconds)
  lastSyncedAt: string;
};

/**
 * POST /api/posts/[id]/sync-engagement
 * Fetches engagement metrics for a published post from its platform and stores
 * them in the `engagement` field of the post document.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const post = snap.data()!;

    if (post.status !== 'published') {
      return apiOk({ ok: false, error: 'Post has not been published yet' });
    }
    if (!post.externalId) {
      return apiOk({ ok: false, error: 'No external post ID — cannot fetch engagement' });
    }

    const channel = post.channel as string;
    let engagement: PostEngagement | null = null;

    // ── Meta / Facebook / Instagram ─────────────────────────────────
    if (channel === 'facebook' || channel === 'instagram') {
      const productId = post.productId as string | undefined;
      const conn = await getMetaConnectionMerged(ctx.workspaceId, productId);
      if (!conn) return apiOk({ ok: false, error: 'Meta integration not connected' });

      // Page-level engagement requires the page access token
      const accessToken = resolveAccessToken(conn);
      const stats = await getMetaPostEngagement(accessToken, post.externalId as string);

      if (stats) {
        engagement = {
          likes: stats.likes,
          comments: stats.comments,
          shares: stats.shares,
          reach: stats.reach,
          impressions: stats.impressions,
          videoViews: 0,
          videoWatchTime: 0,
          lastSyncedAt: new Date().toISOString(),
        };
      }
    }

    // ── TikTok (organic content analytics via Business API) ──────────
    if (channel === 'tiktok') {
      const productId = post.productId as string | undefined;
      const conn = productId
        ? await getConnection(ctx.workspaceId, 'tiktok', productId) || await getConnection(ctx.workspaceId, 'tiktok')
        : await getConnection(ctx.workspaceId, 'tiktok');

      if (conn) {
        const accessToken = decrypt(conn.accessTokenEncrypted);
        const videoId = post.externalId as string;

        try {
          // TikTok Content API v2: query video stats
          const res = await fetch('https://open.tiktokapis.com/v2/video/query/', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filters: { video_ids: [videoId] },
              fields: ['id', 'like_count', 'comment_count', 'share_count', 'view_count', 'average_time_watched'],
            }),
          });
          const data = await res.json() as {
            data?: { videos?: Array<{
              like_count?: number;
              comment_count?: number;
              share_count?: number;
              view_count?: number;
              average_time_watched?: number;
            }> };
            error?: { message?: string };
          };

          const video = data.data?.videos?.[0];
          if (video) {
            engagement = {
              likes: video.like_count || 0,
              comments: video.comment_count || 0,
              shares: video.share_count || 0,
              reach: 0,
              impressions: 0,
              videoViews: video.view_count || 0,
              videoWatchTime: video.average_time_watched || 0,
              lastSyncedAt: new Date().toISOString(),
            };
          }
        } catch {
          // TikTok content API may not be available in all app configurations — non-fatal
        }
      }
    }

    if (!engagement) {
      return apiOk({ ok: false, error: `No engagement data available for channel: ${channel}` });
    }

    await ref.update({ engagement, updatedAt: new Date().toISOString() });
    return apiOk({ ok: true, engagement });
  } catch (error) {
    return apiError(error);
  }
}
