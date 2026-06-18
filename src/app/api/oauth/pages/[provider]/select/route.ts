import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { encrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken, getConnectionRef } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';

export const runtime = 'nodejs';


export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');

    const { provider } = await params;
    if (provider !== 'meta' && provider !== 'pinterest') {
      throw new Error('INVALID_PROVIDER');
    }

    const { pageId, pageName, productId } = await req.json();
    if (!pageId) {
      throw new Error('VALIDATION_MISSING_PAGE_ID');
    }

    if (provider === 'pinterest') {
      if (!productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
      const connRef = getConnectionRef(ctx.workspaceId, provider, productId);
      const snap = await connRef.get();
      if (!snap.exists) throw new Error('NOT_FOUND');
      const connection = snap.data() as PlatformConnection;
      const accessToken = resolveUserAccessToken(connection);

      const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const boardsData = await boardsRes.json();
      if (!boardsRes.ok || !Array.isArray(boardsData.items)) {
        throw new Error(boardsData.message || 'Failed to verify Pinterest board');
      }
      const selectedBoard = boardsData.items.find((board: Record<string, unknown>) => String(board.id) === String(pageId));
      if (!selectedBoard) {
        throw new Error('NOT_FOUND');
      }

      await connRef.update({
        'metadata.boardId': pageId,
        'metadata.boardName': pageName || String(selectedBoard.name ?? ''),
        'metadata.boardSelectionRequired': false,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx.uid,
      });

      return apiOk({ ok: true, id: pageId, name: pageName || String(selectedBoard.name ?? '') });
    }

    // Per-product Meta: the user token lives on the product's own connection.
    if (!productId) throw new Error('VALIDATION_MISSING_PRODUCT_ID');
    const prodConn = await getConnection(ctx.workspaceId, 'meta', productId);
    if (!prodConn) throw new Error('NOT_FOUND');
    const userAccessToken = resolveUserAccessToken(prodConn);

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

    // Merge the chosen page onto the product's Meta connection (the user token
    // already on the doc is preserved).
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
