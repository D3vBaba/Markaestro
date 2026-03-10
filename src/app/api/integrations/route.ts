import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';

function maskIntegration(d: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = d.data();
  return {
    provider: d.id,
    enabled: data.enabled ?? false,
    status: data.status ?? 'disconnected',
    updatedAt: data.updatedAt,
    hasApiKey: Boolean(data.apiKeyEncrypted || data.apiKey),
    hasAccessToken: Boolean(data.accessTokenEncrypted || data.accessToken),
    fromEmail: data.fromEmail,
    adAccountId: data.adAccountId,
    pageId: data.pageId,
    igAccountId: data.igAccountId,
    oauthConnected: data.oauthConnected ?? false,
    tokenExpiresAt: data.tokenExpiresAt ?? null,
    pageName: data.pageName ?? null,
    openId: data.openId ?? null,
    username: data.username ?? null,
    lastRefreshError: data.lastRefreshError ?? null,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    // Always return workspace-level integrations (google)
    const wsSnap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/integrations`)
      .get();
    const items = wsSnap.docs.map(maskIntegration);

    // If productId is provided, also return product-level integrations (resend, meta, x, tiktok)
    if (productId) {
      const prodSnap = await adminDb
        .collection(`workspaces/${ctx.workspaceId}/products/${productId}/integrations`)
        .get();
      const productItems = prodSnap.docs.map(maskIntegration);
      items.push(...productItems);
    }

    return apiOk({ workspaceId: ctx.workspaceId, integrations: items });
  } catch (error) {
    return apiError(error);
  }
}
