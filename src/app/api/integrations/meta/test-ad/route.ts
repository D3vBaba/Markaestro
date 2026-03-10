import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/integrations/meta`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error('NOT_FOUND');
    }

    const data = snap.data()!;
    if (!data.accessTokenEncrypted) {
      return apiOk({ ok: false, error: 'No access token configured' });
    }

    const accessToken = decrypt(data.accessTokenEncrypted as string);
    const adAccountId = data.adAccountId as string;

    if (!adAccountId) {
      return apiOk({ ok: false, error: 'No ad account ID configured. Set it in Meta integration settings.' });
    }

    // Create a PAUSED test campaign
    const campaignRes = await fetch(
      `https://graph.facebook.com/v20.0/act_${adAccountId}/campaigns`,
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
