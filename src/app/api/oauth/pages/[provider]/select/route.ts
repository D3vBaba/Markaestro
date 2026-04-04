import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { encrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken, getConnectionRef } from '@/lib/platform/connections';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (provider !== 'meta') {
      throw new Error('INVALID_PROVIDER');
    }

    const { pageId, pageName, productId } = await req.json();
    if (!pageId) {
      throw new Error('VALIDATION_MISSING_PAGE_ID');
    }

    // Read user token from workspace-level connection
    const wsConn = await getConnection(ctx.workspaceId, 'meta');
    if (!wsConn) {
      // Backward compat: try product-level connection
      const prodConn = await getConnection(ctx.workspaceId, 'meta', productId);
      if (!prodConn) throw new Error('NOT_FOUND');
      // Legacy path — use product-level token
      const legacyToken = resolveUserAccessToken(prodConn);
      const legacyPagesRes = await fetch(
        'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
        { headers: { Authorization: `Bearer ${legacyToken}` } },
      );
      const legacyPagesData = await legacyPagesRes.json();
      if (!legacyPagesRes.ok || !legacyPagesData.data) throw new Error('Failed to fetch pages from Meta');
      const legacyPage = legacyPagesData.data.find((p: Record<string, unknown>) => p.id === pageId);
      if (!legacyPage) throw new Error('NOT_FOUND');
      const legacyRef = getConnectionRef(ctx.workspaceId, 'meta', productId);
      await legacyRef.update({
        'metadata.pageId': pageId,
        'metadata.pageName': pageName || legacyPage.name,
        'metadata.pageAccessTokenEncrypted': encrypt(legacyPage.access_token as string),
        'metadata.pageSelectionRequired': false,
        'metadata.igAccountId': legacyPage.instagram_business_account?.id || null,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx.uid,
      });
      return apiOk({
        ok: true,
        pageId,
        pageName: pageName || legacyPage.name,
        igAccountId: legacyPage.instagram_business_account?.id || null,
      });
    }

    const userAccessToken = resolveUserAccessToken(wsConn);

    // Fetch pages to get the selected page's access token
    const pagesRes = await fetch(
      'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
    );
    const pagesData = await pagesRes.json();

    if (!pagesRes.ok || !pagesData.data) {
      throw new Error('Failed to fetch pages from Meta');
    }

    const selectedPage = pagesData.data.find((p: Record<string, unknown>) => p.id === pageId);
    if (!selectedPage) {
      throw new Error('NOT_FOUND');
    }

    // Write page selection to product-level doc (no user token)
    const prodRef = getConnectionRef(ctx.workspaceId, 'meta', productId);
    await prodRef.set({
      provider: 'meta',
      status: 'connected',
      metadata: {
        pageId,
        pageName: pageName || selectedPage.name,
        pageAccessTokenEncrypted: encrypt(selectedPage.access_token as string),
        igAccountId: selectedPage.instagram_business_account?.id || null,
        pageSelectionRequired: false,
      },
      workspaceId: ctx.workspaceId,
      productId,
      updatedBy: ctx.uid,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }, { merge: true });

    return apiOk({
      ok: true,
      pageId,
      pageName: pageName || selectedPage.name,
      igAccountId: selectedPage.instagram_business_account?.id || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
