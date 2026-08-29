import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { listManagedSocialChannelStatuses, listWorkspaceChannelHealth } from '@/lib/social/channel-status';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId') || undefined;
    // ?health=1: the workspace-wide view, aggregated over every brand's real
    // linked accounts. Without it, a product-less call only sees
    // workspace-scoped connections, which for Meta is a page-less credential:
    // that is what put a permanent false "Facebook is not connected" banner
    // on workspaces whose Pages were all healthy at brand level.
    const channels = url.searchParams.get('health') === '1' && !productId
      ? await listWorkspaceChannelHealth(ctx.workspaceId)
      : await listManagedSocialChannelStatuses(ctx.workspaceId, productId);

    return apiOk({
      workspaceId: ctx.workspaceId,
      productId: productId ?? null,
      channels,
    });
  } catch (error) {
    return apiError(error);
  }
}
