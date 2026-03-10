import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { decrypt } from '@/lib/crypto';
import { testXConnection } from '@/lib/social/x';

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    if (!productId) {
      return apiOk({ ok: false, error: 'productId is required' });
    }

    const ref = adminDb.doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/x`);
    const snap = await ref.get();
    if (!snap.exists) {
      return apiOk({ ok: false, error: 'X integration not configured' });
    }

    const raw = snap.data()!;
    const config = {
      accessToken: decrypt(raw.accessTokenEncrypted),
      username: raw.username || '',
    };

    const result = await testXConnection(config);

    // If test returned a username and we didn't have one stored, save it
    if (result.ok && result.username && !raw.username) {
      await ref.update({ username: result.username, updatedAt: new Date().toISOString() });
    }

    return apiOk({ ok: result.ok, username: result.username, error: result.error });
  } catch (error) {
    return apiError(error);
  }
}
