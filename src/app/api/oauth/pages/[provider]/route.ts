import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { provider } = await params;

    if (provider !== 'meta') {
      throw new Error('INVALID_PROVIDER');
    }

    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    const docPath = productId
      ? `workspaces/${ctx.workspaceId}/products/${productId}/integrations/meta`
      : `workspaces/${ctx.workspaceId}/integrations/meta`;

    const ref = adminDb.doc(docPath);
    const snap = await ref.get();
    if (!snap.exists) {
      return apiOk({ pages: [] });
    }

    const data = snap.data()!;
    if (!data.accessTokenEncrypted) {
      return apiOk({ pages: [] });
    }

    const accessToken = decrypt(data.accessTokenEncrypted as string);

    const res = await fetch(
      'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const pagesData = await res.json();

    if (!res.ok || !pagesData.data) {
      return apiOk({ pages: [], error: pagesData.error?.message || 'Failed to fetch pages' });
    }

    const pages = pagesData.data.map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      hasInstagram: Boolean(p.instagram_business_account),
      igAccountId: (p.instagram_business_account as Record<string, string>)?.id || null,
    }));

    return apiOk({ pages });
  } catch (error) {
    return apiError(error);
  }
}
