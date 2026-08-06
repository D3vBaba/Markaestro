import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { revokeAccessToken } from '@/lib/oauth/flow';
import { oauthProviders, type OAuthProvider } from '@/lib/schemas';
import { getConnection, deleteConnection } from '@/lib/platform/connections';
import { adminDb } from '@/lib/firebase-admin';
import {
  linkedinStorageProviderForKind,
  parseLinkedInCredentialKind,
} from '@/lib/platform/linkedin-providers';

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
    const linkedinCredentialKind = provider === 'linkedin'
      ? parseLinkedInCredentialKind(body.linkedinMode || body.linkedinCredentialKind)
      : undefined;
    const providersToDisconnect = provider === 'linkedin'
      ? linkedinCredentialKind
        ? [linkedinStorageProviderForKind(linkedinCredentialKind)]
        : ['linkedin_profile', 'linkedin_community', 'linkedin']
      : [provider];

    // Meta permissions are app-user scoped. Revoking one product's copied user
    // token revokes every Facebook Page connected by that same user, so a
    // product-level unlink must only remove the local Page selection.
    if (provider === 'meta' && productId) {
      await deleteConnection(ctx.workspaceId, 'meta', productId);
      return apiOk({ ok: true, provider, disconnected: true });
    }

    // A workspace-wide Meta unlink is the only flow allowed to revoke the
    // app-user grant. It also removes every product Page selection.
    if (provider === 'meta' && !productId) {
      const workspaceConnection = await getConnection(ctx.workspaceId, 'meta');
      if (workspaceConnection?.accessTokenEncrypted) {
        try {
          await revokeAccessToken('meta', decrypt(workspaceConnection.accessTokenEncrypted));
        } catch {
          // Best-effort
        }
      }

      await deleteConnection(ctx.workspaceId, 'meta');
      const productsSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/products`)
        .get();
      await Promise.all(productsSnap.docs.map((product) =>
        deleteConnection(ctx.workspaceId, 'meta', product.id),
      ));
      return apiOk({ ok: true, provider, disconnected: true });
    }

    // Other providers own independent product credentials and can be revoked
    // when that product is unlinked.
    for (const storageProvider of providersToDisconnect) {
      const conn = await getConnection(ctx.workspaceId, storageProvider, productId);

      if (conn) {
        if (conn.accessTokenEncrypted) {
          try {
            const token = decrypt(conn.accessTokenEncrypted);
            await revokeAccessToken(provider as OAuthProvider, token);
          } catch {
            // Best-effort
          }
        }

        await deleteConnection(ctx.workspaceId, storageProvider, productId);
      }
    }

    return apiOk({ ok: true, provider, disconnected: true });
  } catch (error) {
    return apiError(error);
  }
}
