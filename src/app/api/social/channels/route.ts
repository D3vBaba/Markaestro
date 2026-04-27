import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { listManagedSocialChannelStatuses } from '@/lib/social/channel-status';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;
    const channels = await listManagedSocialChannelStatuses(ctx.workspaceId, productId);

    return apiOk({
      workspaceId: ctx.workspaceId,
      productId: productId ?? null,
      channels,
    });
  } catch (error) {
    return apiError(error);
  }
}
