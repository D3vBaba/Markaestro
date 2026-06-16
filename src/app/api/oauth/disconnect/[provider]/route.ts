import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { revokeAccessToken } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnection, deleteConnection } from '@/lib/platform/connections';

export const runtime = 'nodejs';


const ALLOWED = new Set<string>(oauthProviders);

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (!ALLOWED.has(provider)) {
      throw new Error('INVALID_PROVIDER');
    }

    const body = await req.json().catch(() => ({}));
    const productId = body.productId as string | undefined;

    // Every provider — including Meta — is linked per product. Unlinking revokes
    // that product's own token and deletes the product-level connection.
    const conn = await getConnection(ctx.workspaceId, provider, productId);

    if (conn) {
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
