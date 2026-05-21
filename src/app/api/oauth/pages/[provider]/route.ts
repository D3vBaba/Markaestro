import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection, resolveUserAccessToken } from '@/lib/platform/connections';

export const runtime = 'nodejs';


async function fetchMetaPages(accessToken: string) {
  const res = await fetch(
    'https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  if (!res.ok || !data.data) {
    return { pages: [], error: data.error?.message || 'Failed to fetch pages' };
  }
  return {
    pages: data.data.map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      hasInstagram: Boolean(p.instagram_business_account),
      igAccountId: (p.instagram_business_account as Record<string, string>)?.id || null,
    })),
  };
}

async function fetchPinterestBoards(accessToken: string) {
  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.items)) {
    return { pages: [], error: data.message || 'Failed to fetch boards' };
  }
  return {
    pages: data.items.map((b: Record<string, unknown>) => ({
      id: String(b.id),
      name: String(b.name ?? ''),
      privacy: typeof b.privacy === 'string' ? b.privacy : 'PUBLIC',
      pinCount: typeof b.pin_count === 'number' ? b.pin_count : 0,
    })),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'integrations.manage');
    const { provider } = await params;

    if (provider !== 'meta' && provider !== 'pinterest') {
      throw new Error('INVALID_PROVIDER');
    }

    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;

    // Meta reads from workspace-level connection; product-scoped providers read
    // from the product-level doc where their OAuth tokens were stored.
    const conn = provider === 'meta'
      ? await getConnection(ctx.workspaceId, 'meta')
      : await getConnection(ctx.workspaceId, provider, productId);

    if (!conn || !conn.accessTokenEncrypted) {
      return apiOk({ pages: [] });
    }

    const accessToken = resolveUserAccessToken(conn);

    if (provider === 'meta') {
      return apiOk(await fetchMetaPages(accessToken));
    }
    return apiOk(await fetchPinterestBoards(accessToken));
  } catch (error) {
    return apiError(error);
  }
}
