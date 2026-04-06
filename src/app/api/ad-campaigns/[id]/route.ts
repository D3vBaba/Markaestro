import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { updateAdCampaignSchema } from '@/lib/schemas';
import { isMetaObjectiveSupported } from '@/lib/ads/meta-ads';
import { updateGoogleCampaignStatus } from '@/lib/ads/google-ads';
import { updateMetaCampaignStatus } from '@/lib/ads/meta-ads';
import { updateTikTokCampaignStatus } from '@/lib/ads/tiktok-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    return apiOk({ id, ...snap.data() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');
    const { id } = await params;
    const body = await req.json();
    const input = updateAdCampaignSchema.parse(body);

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const existing = snap.data() as AdCampaignDoc;
    const nextPlatform = input.platform ?? existing.platform;
    const nextProductId = Object.prototype.hasOwnProperty.call(input, 'productId')
      ? input.productId
      : existing.productId;

    if (nextPlatform === 'meta' && !nextProductId) {
      throw new Error('VALIDATION_META_PRODUCT_REQUIRED');
    }
    if (nextPlatform === 'meta' && input.objective && !isMetaObjectiveSupported(input.objective)) {
      throw new Error('VALIDATION_META_OBJECTIVE_UNSUPPORTED');
    }

    const update = {
      ...input,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    await ref.update(update);

    // Push budget changes to Google Ads if the campaign is live
    const platformWarnings: string[] = [];
    if (
      existing.externalCampaignId &&
      existing.platform === 'google' &&
      input.dailyBudgetCents &&
      input.dailyBudgetCents !== existing.dailyBudgetCents
    ) {
      const { updateGoogleCampaignBudget } = await import('@/lib/ads/google-ads');
      const conn = await getConnection(ctx.workspaceId, 'google');
      if (conn) {
        const accessToken = decrypt(conn.accessTokenEncrypted);
        const customerId = existing.customerId || (conn.metadata.customerId as string);
        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
        if (customerId && developerToken) {
          const result = await updateGoogleCampaignBudget(
            accessToken, customerId, developerToken,
            existing.externalCampaignId, input.dailyBudgetCents,
            conn.metadata.loginCustomerId as string | undefined,
          );
          if (!result.success) {
            platformWarnings.push(`Budget update on Google Ads failed: ${result.error}`);
          }
        }
      }
    }

    return apiOk({
      id,
      ...update,
      ...(platformWarnings.length > 0 ? { platformWarnings } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'ads.write');
    const { id } = await params;

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/ad_campaigns/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('NOT_FOUND');

    const campaign = snap.data() as AdCampaignDoc;

    // If the campaign was launched to a platform, remove/pause it there first
    if (campaign.externalCampaignId) {
      try {
        if (campaign.platform === 'google') {
          const conn = await getConnection(ctx.workspaceId, 'google');
          if (conn) {
            const accessToken = decrypt(conn.accessTokenEncrypted);
            const customerId = campaign.customerId || (conn.metadata.customerId as string);
            const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
            if (customerId && developerToken) {
              await updateGoogleCampaignStatus(
                accessToken, customerId, developerToken,
                campaign.externalCampaignId, 'PAUSED',
                conn.metadata.loginCustomerId as string | undefined,
              );
            }
          }
        } else if (campaign.platform === 'meta') {
          const productId = campaign.productId as string;
          const conn = productId ? await getMetaConnectionMerged(ctx.workspaceId, productId) : null;
          if (conn) {
            const accessToken = resolveUserAccessToken(conn);
            await updateMetaCampaignStatus(accessToken, campaign.externalCampaignId, 'PAUSED');
          }
        } else if (campaign.platform === 'tiktok') {
          const productId = campaign.productId as string | undefined;
          const conn = productId
            ? await getConnection(ctx.workspaceId, 'tiktok_ads', productId) || await getConnection(ctx.workspaceId, 'tiktok_ads')
            : await getConnection(ctx.workspaceId, 'tiktok_ads');
          if (conn) {
            const accessToken = decrypt(conn.accessTokenEncrypted);
            const advertiserId = (campaign as AdCampaignDoc & { adAccountId?: string }).adAccountId || (conn.metadata.advertiserId as string);
            if (advertiserId) {
              await updateTikTokCampaignStatus(accessToken, advertiserId, campaign.externalCampaignId, 'DISABLE');
            }
          }
        }
      } catch (platformError) {
        // Log but don't block deletion — the user wants it gone
        console.warn('Failed to pause campaign on platform before deletion:', platformError);
      }
    }

    await ref.delete();
    return apiOk({ ok: true, deleted: id });
  } catch (error) {
    return apiError(error);
  }
}
