import { requireContext } from '@/lib/server-auth';
import { apiError, apiOk } from '@/lib/api-response';
import { getConnection } from '@/lib/platform/connections';
import { decrypt } from '@/lib/crypto';

export type MetaAdAccount = {
  id: string;          // act_XXXXXXXXX
  name: string;
  currency: string;
  status: number;      // 1 = active, 2 = disabled, etc.
};

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;

    // Try product-level connection first, fall back to workspace-level
    const conn =
      (productId ? await getConnection(ctx.workspaceId, 'meta', productId) : null) ??
      (await getConnection(ctx.workspaceId, 'meta'));

    if (!conn || !conn.accessTokenEncrypted) {
      return apiOk({ adAccounts: [] });
    }

    // Must use the user access token — page tokens cannot list ad accounts
    const accessToken = decrypt(conn.accessTokenEncrypted);

    const res = await fetch(
      'https://graph.facebook.com/v22.0/me/adaccounts?fields=id,name,currency,account_status&limit=50',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();

    if (!res.ok || !data.data) {
      return apiOk({ adAccounts: [], error: data.error?.message || 'Failed to fetch ad accounts' });
    }

    const adAccounts: MetaAdAccount[] = data.data.map((a: Record<string, unknown>) => ({
      id: a.id as string,         // already in act_XXXXXXXXX format
      name: a.name as string,
      currency: a.currency as string,
      status: a.account_status as number,
    }));

    return apiOk({ adAccounts });
  } catch (error) {
    return apiError(error);
  }
}
