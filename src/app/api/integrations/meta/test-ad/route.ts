import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getMetaConnectionMerged, resolveUserAccessToken } from '@/lib/platform/connections';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    const conn = await getMetaConnectionMerged(ctx.workspaceId, productId);
    if (!conn) {
      throw new Error('NOT_FOUND');
    }

    const accessToken = resolveUserAccessToken(conn);
    const adAccountId = conn.metadata.adAccountId as string;

    if (!adAccountId) {
      return apiOk({ ok: false, error: 'No ad account ID configured. Set it in Meta integration settings.' });
    }

    const campaignRes = await fetch(
      `https://graph.facebook.com/v22.0/act_${adAccountId}/campaigns`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `[Test] Markaestro Test Campaign - ${new Date().toISOString()}`,
          objective: 'OUTCOME_AWARENESS',
          status: 'PAUSED',
          special_ad_categories: [],
          access_token: accessToken,
        }),
      },
    );

    const campaignData = await campaignRes.json();

    if (!campaignRes.ok || campaignData.error) {
      return apiOk({
        ok: false,
        error: campaignData.error?.message || 'Failed to create test campaign',
      });
    }

    return apiOk({
      ok: true,
      campaignId: campaignData.id,
      message: 'Test campaign created as PAUSED. Check Meta Ads Manager to verify.',
    });
  } catch (error) {
    return apiError(error);
  }
}
