import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt, encrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';

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

    const docPath = productId
      ? `workspaces/${ctx.workspaceId}/products/${productId}/integrations/meta`
      : `workspaces/${ctx.workspaceId}/integrations/meta`;

    const ref = adminDb.doc(docPath);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error('NOT_FOUND');
    }

    const data = snap.data()!;
    const userAccessToken = decrypt(data.accessTokenEncrypted as string);

    // Fetch pages to get the selected page's access token
    const pagesRes = await fetch(
      'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account',
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
      pageId,
      pageName: pageName || selectedPage.name,
      pageAccessTokenEncrypted: encrypt(selectedPage.access_token as string),
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.uid,
    };

    // If the page has an Instagram business account, store its ID
    if (selectedPage.instagram_business_account?.id) {
      updatePayload.igAccountId = selectedPage.instagram_business_account.id;
    }

    await ref.update(updatePayload);

    return apiOk({
      ok: true,
      pageId,
      pageName: updatePayload.pageName,
      igAccountId: updatePayload.igAccountId || null,
    });
  } catch (error) {
    return apiError(error);
  }
}
