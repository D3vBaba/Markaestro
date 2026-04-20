import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getMetaConnectionMerged, getConnection, resolveAccessToken } from '@/lib/platform/connections';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { fetchFacebookInsights, fetchInstagramInsights } from '@/lib/social/meta-insights';
import { fetchTikTokInsights } from '@/lib/social/tiktok-insights';
import type { FacebookInsights, InstagramInsights, TikTokInsights, UnifiedInsights } from '@/lib/social/types';

export const runtime = 'nodejs';


export async function GET(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');
    const { productId } = await params;

    // Load product name
    const productSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}`).get();
    if (!productSnap.exists) throw new Error('NOT_FOUND');
    const productName = (productSnap.data()?.name as string) || 'Unknown Product';

    // Get connections
    const [metaConn, instagramConn, tiktokConn] = await Promise.all([
      getMetaConnectionMerged(ctx.workspaceId, productId),
      getConnection(ctx.workspaceId, 'instagram', productId)
        .then((c) => c || getConnection(ctx.workspaceId, 'instagram')),
      getConnection(ctx.workspaceId, 'tiktok', productId)
        .then((c) => c || getConnection(ctx.workspaceId, 'tiktok')),
    ]);

    // Fetch insights in parallel
    const [fbResult, igResult, ttResult] = await Promise.allSettled([
      // Facebook
      (async (): Promise<FacebookInsights> => {
        if (!metaConn || metaConn.status !== 'connected') {
          return { platform: 'facebook', connected: false };
        }
        const pageId = metaConn.metadata.pageId as string | undefined;
        if (!pageId) {
          return { platform: 'facebook', connected: true, error: 'No Facebook page selected' };
        }
        const token = resolveAccessToken(metaConn);
        const pageName = (metaConn.metadata.pageName as string) || undefined;
        return fetchFacebookInsights(token, pageId, pageName);
      })(),

      // Instagram
      (async (): Promise<InstagramInsights> => {
        if (metaConn?.status === 'connected') {
          const igAccountId = metaConn.metadata.igAccountId as string | undefined;
          if (igAccountId) {
            const token = resolveAccessToken(metaConn);
            return fetchInstagramInsights(token, igAccountId);
          }
        }

        if (!instagramConn || instagramConn.status !== 'connected') {
          return { platform: 'instagram', connected: false };
        }

        const igAccountId = instagramConn.metadata.igAccountId as string | undefined;
        if (!igAccountId) {
          return { platform: 'instagram', connected: false };
        }

        const token = getAccessToken(instagramConn);
        return fetchInstagramInsights(token, igAccountId, { graphApi: 'instagram' });
      })(),

      // TikTok
      (async (): Promise<TikTokInsights> => {
        if (!tiktokConn || tiktokConn.status !== 'connected') {
          return { platform: 'tiktok', connected: false };
        }
        const token = getAccessToken(tiktokConn);
        return fetchTikTokInsights(token);
      })(),
    ]);

    const insights: UnifiedInsights = {
      productId,
      productName,
      facebook: fbResult.status === 'fulfilled' ? fbResult.value : { platform: 'facebook', connected: false, error: 'Fetch failed' },
      instagram: igResult.status === 'fulfilled' ? igResult.value : { platform: 'instagram', connected: false, error: 'Fetch failed' },
      tiktok: ttResult.status === 'fulfilled' ? ttResult.value : { platform: 'tiktok', connected: false, error: 'Fetch failed' },
      fetchedAt: new Date().toISOString(),
    };

    return apiOk(insights);
  } catch (error) {
    return apiError(error);
  }
}
