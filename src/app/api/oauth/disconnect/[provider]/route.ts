import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { revokeAccessToken } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnection, deleteConnection } from '@/lib/platform/connections';
import { adminDb } from '@/lib/firebase-admin';

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

    // Meta with productId: only delete product-level page selection, don't revoke user token
    if (provider === 'meta' && productId) {
      await deleteConnection(ctx.workspaceId, 'meta', productId);
      return apiOk({ ok: true, provider, disconnected: true });
    }

    // Meta without productId: revoke user token + delete workspace connection + all product meta connections
    if (provider === 'meta' && !productId) {
      const wsConn = await getConnection(ctx.workspaceId, 'meta');
      if (wsConn?.accessTokenEncrypted) {
        try {
          const token = decrypt(wsConn.accessTokenEncrypted);
          await revokeAccessToken('meta', token);
        } catch {
          // Best-effort
        }
      }
      await deleteConnection(ctx.workspaceId, 'meta');

      // Delete all product-level meta connections
      const productsSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/products`)
        .limit(100)
        .get();
      for (const productDoc of productsSnap.docs) {
        const prodMetaConn = await getConnection(ctx.workspaceId, 'meta', productDoc.id);
        if (prodMetaConn) {
          await deleteConnection(ctx.workspaceId, 'meta', productDoc.id);
        }
      }

      return apiOk({ ok: true, provider, disconnected: true });
    }

    // Non-Meta providers: original behavior
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
