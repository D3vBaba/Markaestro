import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { createMetaCampaign } from '@/lib/ads/meta-ads';
import { createGoogleCampaign } from '@/lib/ads/google-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';
import { getConnection, resolveUserAccessToken } from '@/lib/platform/connections';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = { ...snap.data(), workspaceId: ctx.workspaceId } as AdCampaignDoc;

    if (campaign.status !== 'draft' && campaign.status !== 'failed') {
      return apiOk({ ok: false, error: `Campaign cannot be launched from status: ${campaign.status}` });
    }

    await ref.update({ status: 'pending', updatedAt: new Date().toISOString() });

    if (campaign.platform === 'meta') {
      const productId = campaign.productId as string | undefined;
      if (!productId) {
        await ref.update({ status: 'failed', errorMessage: 'Campaign has no associated product for Meta integration' });
        return apiOk({ ok: false, error: 'Campaign has no associated product for Meta integration' });
      }

      const conn = await getConnection(ctx.workspaceId, 'meta', productId);
      if (!conn) {
        await ref.update({ status: 'failed', errorMessage: 'Meta integration not configured for this product' });
        return apiOk({ ok: false, error: 'Meta integration not configured for this product' });
      }

      const accessToken = resolveUserAccessToken(conn);
      // Campaign-level adAccountId takes precedence over the product connection default
      const adAccountId = campaign.adAccountId || (conn.metadata.adAccountId as string);
      const pageId = conn.metadata.pageId as string;

      if (!adAccountId) {
        await ref.update({ status: 'failed', errorMessage: 'No ad account ID configured' });
        return apiOk({ ok: false, error: 'No ad account ID configured in Meta integration' });
      }
      if (!pageId) {
        await ref.update({ status: 'failed', errorMessage: 'No Facebook page selected — required for ad creatives' });
        return apiOk({ ok: false, error: 'No Facebook page selected — required for ad creatives' });
      }

      const result = await createMetaCampaign(accessToken, adAccountId, pageId, campaign);

      if (result.success) {
        await ref.update({
          status: 'active',
          externalCampaignId: result.campaignId,
          externalAdSetId: result.adSetId,
          externalAdId: result.adId,
          launchedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return apiOk({ ok: true, ...result });
      } else {
        await ref.update({ status: 'failed', errorMessage: result.error, updatedAt: new Date().toISOString() });
        return apiOk({ ok: false, error: result.error });
      }
    }

    if (campaign.platform === 'google') {
      const conn = await getConnection(ctx.workspaceId, 'google');
      if (!conn) {
        await ref.update({ status: 'failed', errorMessage: 'Google integration not configured' });
        return apiOk({ ok: false, error: 'Google integration not configured' });
      }

      const accessToken = decrypt(conn.accessTokenEncrypted);
      // Campaign-level customerId takes precedence over the workspace connection default
      const customerId = campaign.customerId || (conn.metadata.customerId as string);
      const loginCustomerId = conn.metadata.loginCustomerId as string | undefined;
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

      if (!customerId || !developerToken) {
        await ref.update({ status: 'failed', errorMessage: 'Missing Google Ads customer ID or developer token' });
        return apiOk({ ok: false, error: 'Missing Google Ads customer ID or developer token' });
      }

      const result = await createGoogleCampaign(accessToken, customerId, developerToken, campaign, loginCustomerId);

      if (result.success) {
        await ref.update({
          status: 'active',
          externalCampaignId: result.campaignId,
          externalAdSetId: result.adSetId,
          externalAdId: result.adId,
          launchedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return apiOk({ ok: true, ...result });
      } else {
        await ref.update({ status: 'failed', errorMessage: result.error, updatedAt: new Date().toISOString() });
        return apiOk({ ok: false, error: result.error });
      }
    }

    await ref.update({ status: 'failed', errorMessage: `Unsupported platform: ${campaign.platform}` });
    return apiOk({ ok: false, error: `Unsupported platform: ${campaign.platform}` });
  } catch (error) {
    return apiError(error);
  }
}
