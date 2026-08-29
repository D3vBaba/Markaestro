import { z } from 'zod';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { listMediaAssets, serializeMediaAsset } from '@/lib/media/asset-store';
import { getUsage, storageLimitBytes } from '@/lib/usage';
import { getEffectiveLimits } from '@/lib/stripe/entitlements';

export const runtime = 'nodejs';

const listQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  type: z.enum(['image', 'video']).optional(),
});

/**
 * The workspace's media library.
 *
 * Matches the read permission of the neighbouring list routes: anyone who can
 * see the dashboard can see what has been uploaded. Deleting requires
 * `posts.write` and lives on `/api/media/[id]`.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const query = listQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );

    const page = await listMediaAssets(ctx.workspaceId, {
      cursor: query.cursor,
      limit: query.limit,
      type: query.type,
    });

    // The storage meter ships with the list because it is what turns an opaque
    // QUOTA_EXCEEDED_STORAGE into something a user can act on: they can see how
    // full they are and which files to remove.
    const [usage, limits] = await Promise.all([
      getUsage(ctx.uid, ctx.workspaceId),
      getEffectiveLimits(ctx.uid, ctx.workspaceId),
    ]);

    return apiOk({
      assets: page.items.map(serializeMediaAsset),
      nextCursor: page.nextCursor,
      storage: {
        usedBytes: usage.storageBytes,
        // -1 means unlimited, matching storageLimitBytes.
        limitBytes: storageLimitBytes(limits),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
