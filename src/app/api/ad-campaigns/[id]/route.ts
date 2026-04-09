import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { updateAdCampaignSchema } from '@/lib/schemas';
import { isMetaObjectiveSupported } from '@/lib/ads/meta-ads';
import { updateMetaCampaignStatus } from '@/lib/ads/meta-ads';
import { updateTikTokCampaignStatus } from '@/lib/ads/tiktok-ads';
import type { AdCampaignDoc } from '@/lib/ads/types';
import { getConnection, getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';
import { decrypt } from '@/lib/crypto';

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

    return apiOk({
      id,
      ...update,
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
        if (campaign.platform === 'meta') {
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
