import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getMetaCampaignMetrics } from '@/lib/ads/meta-ads';
import { getTikTokCampaignMetrics } from '@/lib/ads/tiktok-ads';
import type { AdCampaignDoc, AdCampaignMetrics, MetricsSnapshot } from '@/lib/ads/types';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = snap.data() as AdCampaignDoc;
    if (!campaign.externalCampaignId) {
      return apiOk({ ok: false, error: 'Campaign has not been launched yet' });
    }

    let result: { success: boolean; metrics?: AdCampaignMetrics; error?: string };

    if (campaign.platform === 'meta') {
      const productId = campaign.productId as string;
      const conn = await getMetaConnectionMerged(ctx.workspaceId, productId);
      if (!conn) return apiOk({ ok: false, error: 'Meta integration not found' });
      const accessToken = resolveUserAccessToken(conn);
      result = await getMetaCampaignMetrics(accessToken, campaign.externalCampaignId);
    } else if (campaign.platform === 'tiktok') {
      const productId = campaign.productId as string | undefined;
      const conn = productId
        ? await getConnection(ctx.workspaceId, 'tiktok_ads', productId) || await getConnection(ctx.workspaceId, 'tiktok_ads')
        : await getConnection(ctx.workspaceId, 'tiktok_ads');
      if (!conn) return apiOk({ ok: false, error: 'TikTok integration not found' });
      const accessToken = decrypt(conn.accessTokenEncrypted);
      const advertiserId = (campaign as AdCampaignDoc & { adAccountId?: string }).adAccountId || (conn.metadata.advertiserId as string);
      result = await getTikTokCampaignMetrics(accessToken, advertiserId, campaign.externalCampaignId);
    } else {
      return apiOk({ ok: false, error: `Unsupported platform: ${campaign.platform}` });
    }

    if (result.success && result.metrics) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const snapshot: MetricsSnapshot = { ...result.metrics, date: today };
      // Write current metrics to campaign doc AND append to daily history (non-blocking)
      await Promise.all([
        ref.update({ metrics: result.metrics, updatedAt: new Date().toISOString() }),
        ref.collection('metrics_history').doc(today).set(snapshot),
      ]);
      return apiOk({ ok: true, metrics: result.metrics });
    } else if (result.success) {
      return apiOk({ ok: true, metrics: null });
    } else {
      return apiOk({ ok: false, error: result.error });
    }
  } catch (error) {
    return apiError(error);
  }
}
