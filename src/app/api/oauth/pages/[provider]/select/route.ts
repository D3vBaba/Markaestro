import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { encrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken, getConnectionRef } from '@/lib/platform/connections';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);

    const { provider } = await params;
    if (provider !== 'meta') {
      throw new Error('INVALID_PROVIDER');
    }

    const { pageId, pageName, productId } = await req.json();
    if (!pageId) {
      throw new Error('VALIDATION_MISSING_PAGE_ID');
    }

    const conn = await getConnection(ctx.workspaceId, 'meta', productId);
    if (!conn) {
      throw new Error('NOT_FOUND');
    }

    const userAccessToken = resolveUserAccessToken(conn);

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

    const updatePayload: Record<string, unknown> = {
      'metadata.pageId': pageId,
      'metadata.pageName': pageName || selectedPage.name,
      'metadata.pageAccessTokenEncrypted': encrypt(selectedPage.access_token as string),
      'metadata.pageSelectionRequired': false,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    updatePayload['metadata.igAccountId'] = selectedPage.instagram_business_account?.id || null;

    const connRef = getConnectionRef(ctx.workspaceId, 'meta', productId);
    await connRef.update(updatePayload);

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
