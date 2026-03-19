import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { updateMetaCampaignStatus } from '@/lib/ads/meta-ads';
import { updateGoogleCampaignStatus } from '@/lib/ads/google-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
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
      result = await updateGoogleCampaignStatus(
        accessToken,
        conn.metadata.customerId as string,
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
        campaign.externalCampaignId,
        'ENABLED',
        conn.metadata.loginCustomerId as string | undefined,
      );
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
