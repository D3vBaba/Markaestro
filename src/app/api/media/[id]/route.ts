import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import {
  deleteMediaAsset,
  getMediaAsset,
  getMediaAssetUsage,
  serializeMediaAsset,
} from '@/lib/media/asset-store';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const { id } = await params;
    const asset = await getMediaAsset(ctx.workspaceId, id);
    const usage = await getMediaAssetUsage(ctx.workspaceId, asset.downloadUrl);
    return apiOk({ asset: { ...serializeMediaAsset(asset), usedInPostCount: usage.totalPostCount } });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Delete an asset and release its bytes.
 *
 * This is the in-app half of the storage-reclaim path. Until it existed a
 * workspace's storage counter only grew, and a customer at their cap had no
 * way to free space short of deleting the workspace.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const { id } = await params;
    const result = await deleteMediaAsset(ctx.workspaceId, id);
    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
