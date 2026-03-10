import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { testTikTokConnection } from '@/lib/social/tiktok';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/tiktok`);
    const snap = await ref.get();
    if (!snap.exists) {
      return apiOk({ ok: false, error: 'TikTok integration not configured' });
    }

    const data = snap.data()!;
    if (!data.accessTokenEncrypted) {
      return apiOk({ ok: false, error: 'No access token configured' });
    }

    const result = await testTikTokConnection({
      accessToken: decrypt(data.accessTokenEncrypted as string),
      openId: data.openId as string || '',
    });

    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
