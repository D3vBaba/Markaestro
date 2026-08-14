import { apiError, apiOk } from '@/lib/api-response';
import { queryTikTokCreatorInfo } from '@/lib/platform/adapters/tiktok-direct-post';
import { getAccessToken } from '@/lib/platform/base-adapter';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { isTikTokTokenExpiringSoon, isTikTokTokenInvalid, refreshTikTokConnection } from '@/lib/platform/tiktok-auth';
import { requirePermission } from '@/lib/rbac';
import { requireContext } from '@/lib/server-auth';

export const runtime = 'nodejs';

/**
 * Backs the Direct Post composer panel. TikTok requires the post form to be
 * built from a live creator_info query rather than from cached or assumed
 * values, so this is fetched every time the panel opens — never persisted.
 *
 * @see https://developers.tiktok.com/doc/content-sharing-guidelines
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.publish');

    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;

    const connection = await getConnectionForChannel(ctx.workspaceId, 'tiktok', productId);
    if (!connection) {
      return apiOk({ ok: false, reason: 'not_connected', error: 'No TikTok account is connected.' });
    }

    let activeConnection = connection;
    if (isTikTokTokenExpiringSoon(activeConnection)) {
      activeConnection = (await refreshTikTokConnection(ctx.workspaceId, productId, activeConnection)) ?? activeConnection;
    }

    let result = await queryTikTokCreatorInfo(getAccessToken(activeConnection));
    if (!result.ok && isTikTokTokenInvalid(result.error)) {
      const refreshed = await refreshTikTokConnection(ctx.workspaceId, productId, activeConnection);
      if (refreshed) {
        result = await queryTikTokCreatorInfo(getAccessToken(refreshed));
      }
    }

    if (!result.ok) {
      return apiOk({ ok: false, reason: result.reason, error: result.error });
    }

    return apiOk({ ok: true, creatorInfo: result.info });
  } catch (error) {
    return apiError(error);
  }
}
