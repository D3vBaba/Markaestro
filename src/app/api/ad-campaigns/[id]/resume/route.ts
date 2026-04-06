import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { updateMetaCampaignStatus } from '@/lib/ads/meta-ads';
import { updateGoogleCampaignStatus } from '@/lib/ads/google-ads';
import { updateTikTokCampaignStatus } from '@/lib/ads/tiktok-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';
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
    if (campaign.status !== 'paused') {
      return apiOk({ ok: false, error: 'Only paused campaigns can be resumed' });
    }
    if (!campaign.externalCampaignId) {
      return apiOk({ ok: false, error: 'Campaign has not been launched to a platform yet' });
    }

    let result: { success: boolean; error?: string };

    if (campaign.platform === 'meta') {
      const productId = campaign.productId as string;
      const conn = await getMetaConnectionMerged(ctx.workspaceId, productId);
      if (!conn) return apiOk({ ok: false, error: 'Meta integration not found' });
      const accessToken = resolveUserAccessToken(conn);
      result = await updateMetaCampaignStatus(accessToken, campaign.externalCampaignId, 'ACTIVE');
    } else if (campaign.platform === 'google') {
      const conn = await getConnection(ctx.workspaceId, 'google');
      if (!conn) return apiOk({ ok: false, error: 'Google integration not found' });
      const accessToken = decrypt(conn.accessTokenEncrypted);
      const customerId = campaign.customerId || (conn.metadata.customerId as string);
      result = await updateGoogleCampaignStatus(
        accessToken,
        customerId,
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
        campaign.externalCampaignId,
        'ENABLED',
        conn.metadata.loginCustomerId as string | undefined,
      );
    } else if (campaign.platform === 'tiktok') {
      const productId = campaign.productId as string | undefined;
      const conn = productId
        ? await getConnection(ctx.workspaceId, 'tiktok_ads', productId) || await getConnection(ctx.workspaceId, 'tiktok_ads')
        : await getConnection(ctx.workspaceId, 'tiktok_ads');
      if (!conn) return apiOk({ ok: false, error: 'TikTok integration not found' });
      const accessToken = decrypt(conn.accessTokenEncrypted);
      const advertiserId = (campaign as AdCampaignDoc & { adAccountId?: string }).adAccountId || (conn.metadata.advertiserId as string);
      result = await updateTikTokCampaignStatus(accessToken, advertiserId, campaign.externalCampaignId, 'ENABLE');
    } else {
      return apiOk({ ok: false, error: `Unsupported platform: ${campaign.platform}` });
    }

    if (result.success) {
      await ref.update({ status: 'active', updatedAt: new Date().toISOString() });
      return apiOk({ ok: true });
    } else {
      return apiOk({ ok: false, error: result.error });
    }
  } catch (error) {
    return apiError(error);
  }
}
