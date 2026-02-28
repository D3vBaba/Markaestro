import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { decrypt } from '@/lib/crypto';
import { z } from 'zod';

const testSchema = z.object({
  provider: z.enum(['facebook', 'instagram']).default('facebook'),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    const body = await req.json();
    const { provider } = testSchema.parse(body);

    const doc = await adminDb
      .doc(`workspaces/${ctx.workspaceId}/integrations/${provider}`)
      .get();
    const cfg = doc.data() || {};

    // Support both encrypted (new) and plaintext (legacy) tokens
    let token = '';
    if (cfg.accessTokenEncrypted) {
      token = decrypt(cfg.accessTokenEncrypted);
    } else if (cfg.accessToken) {
      token = String(cfg.accessToken);
    }

    if (!token) {
      throw new Error('VALIDATION_MISSING_META_TOKEN');
    }

    // Use Authorization header instead of leaking token in URL
    const resp = await fetch(
      'https://graph.facebook.com/v20.0/me?fields=id,name',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const data = await resp.json();
    return apiOk({ ok: resp.ok, status: resp.status, data });
  } catch (error) {
    return apiError(error);
  }
}
