import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { decrypt } from '@/lib/crypto';
import { z } from 'zod';

const testSchema = z.object({
  provider: z.enum(['facebook', 'instagram']).default('facebook'),
  productId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { provider, productId } = testSchema.parse(body);

    // Try product-level meta integration first, then per-channel
    const metaDoc = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/meta`)
      .get();

    const doc = metaDoc.exists
      ? metaDoc
      : await adminDb
          .doc(`workspaces/${ctx.workspaceId}/products/${productId}/integrations/${provider}`)
          .get();
    const cfg = doc.data() || {};

    if (!cfg.accessTokenEncrypted) {
      throw new Error('VALIDATION_MISSING_META_TOKEN');
    }
    const token = decrypt(cfg.accessTokenEncrypted);

    const resp = await fetch(
      'https://graph.facebook.com/v21.0/me?fields=id,name',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const data = await resp.json();
    return apiOk({ ok: resp.ok, status: resp.status, data });
  } catch (error) {
    return apiError(error);
  }
}
