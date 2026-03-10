import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { revokeAccessToken } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';

const ALLOWED = new Set<string>(oauthProviders);

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    const docPath = productId
      ? `workspaces/${ctx.workspaceId}/products/${productId}/integrations/${provider}`
      : `workspaces/${ctx.workspaceId}/integrations/${provider}`;

    const ref = adminDb.doc(docPath);
    const snap = await ref.get();

    if (snap.exists) {
      const data = snap.data()!;

      // Revoke the token with the provider (best-effort, non-blocking)
      if (data.accessTokenEncrypted) {
        try {
          const token = decrypt(data.accessTokenEncrypted as string);
          await revokeAccessToken(provider as OAuthProvider, token);
        } catch {
          // Revocation is best-effort — proceed with deletion
        }
      }

      await ref.delete();
    }

    return apiOk({ ok: true, provider, disconnected: true });
  } catch (error) {
    return apiError(error);
  }
}
