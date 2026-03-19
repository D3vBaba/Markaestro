import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken } from '@/lib/platform/connections';

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    const { provider } = await params;

    if (provider !== 'meta') {
      throw new Error('INVALID_PROVIDER');
    }

    // Read user token from workspace-level connection (not per-product)
    const conn = await getConnection(ctx.workspaceId, 'meta');
    if (!conn || !conn.accessTokenEncrypted) {
      return apiOk({ pages: [] });
    }

    const accessToken = resolveUserAccessToken(conn);

    const res = await fetch(
      'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
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
