import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { createMetaCampaign } from '@/lib/ads/meta-ads';
import { createGoogleCampaign } from '@/lib/ads/google-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';

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

    // Update status to pending
    await ref.update({ status: 'pending', updatedAt: new Date().toISOString() });

    if (campaign.platform === 'meta') {
      // Meta Ads: use product-level integration
      const productId = campaign.productId as string | undefined;
      if (!productId) {
        await ref.update({ status: 'failed', errorMessage: 'Campaign has no associated product for Meta integration' });
        return apiOk({ ok: false, error: 'Campaign has no associated product for Meta integration' });
      }

      const integRef = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/meta`);
      const integSnap = await integRef.get();
      if (!integSnap.exists) {
        await ref.update({ status: 'failed', errorMessage: 'Meta integration not configured for this product' });
        return apiOk({ ok: false, error: 'Meta integration not configured for this product' });
      }

      const integData = integSnap.data()!;
      const accessToken = integData.pageAccessTokenEncrypted
        ? decrypt(integData.pageAccessTokenEncrypted as string)
        : decrypt(integData.accessTokenEncrypted as string);
      const adAccountId = integData.adAccountId as string;
      const pageId = integData.pageId as string;

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
        await ref.update({
          status: 'failed',
          errorMessage: result.error,
          updatedAt: new Date().toISOString(),
        });
        return apiOk({ ok: false, error: result.error });
      }
    }

    if (campaign.platform === 'google') {
      // Load Google integration
      const integRef = adminDb.doc(`workspaces/${ctx.workspaceId}/integrations/google`);
      const integSnap = await integRef.get();
      if (!integSnap.exists) {
        await ref.update({ status: 'failed', errorMessage: 'Google integration not configured' });
        return apiOk({ ok: false, error: 'Google integration not configured' });
      }

      const integData = integSnap.data()!;
      const accessToken = decrypt(integData.accessTokenEncrypted as string);
      const customerId = integData.customerId as string;
      const loginCustomerId = integData.loginCustomerId as string | undefined;
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
        await ref.update({
          status: 'failed',
          errorMessage: result.error,
          updatedAt: new Date().toISOString(),
        });
        return apiOk({ ok: false, error: result.error });
      }
    }

    await ref.update({ status: 'failed', errorMessage: `Unsupported platform: ${campaign.platform}` });
    return apiOk({ ok: false, error: `Unsupported platform: ${campaign.platform}` });
  } catch (error) {
    return apiError(error);
  }
}
