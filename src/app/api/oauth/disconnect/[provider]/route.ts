import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { revokeAccessToken } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnection, deleteConnection } from '@/lib/platform/connections';

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

    const conn = await getConnection(ctx.workspaceId, provider, productId);

    if (conn) {
      // Revoke the token with the provider (best-effort)
      if (conn.accessTokenEncrypted) {
        try {
          const token = decrypt(conn.accessTokenEncrypted);
          await revokeAccessToken(provider as OAuthProvider, token);
        } catch {
          // Best-effort
        }
      }

      await deleteConnection(ctx.workspaceId, provider, productId);
    }

    return apiOk({ ok: true, provider, disconnected: true });
  } catch (error) {
    return apiError(error);
  }
}
