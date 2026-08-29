// Public API: DELETE /api/public/v1/media/{id}
// Removes a media asset (doc + storage object) and releases its bytes from the
// workspace's cumulative storage usage. Assets held by a scheduled or
// publishing post are refused; assets held only by published posts are deleted
// with a warning, since the platform keeps its own copy.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { deleteMediaAsset } from '@/lib/media/asset-store';

export const runtime = 'nodejs';

const MEDIA_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'media.write',
      rateLimit: MEDIA_RATE_LIMIT,
    });
    const { id } = await params;
    if (!/^ast_[a-f0-9-]{36}$/.test(id)) throw new Error('NOT_FOUND');

    // Shared with the app's DELETE /api/media/[id]: same ordering (object, then
    // doc, then refund) and the same in-use check, so the two surfaces cannot
    // disagree about whether an asset is safe to remove.
    const result = await deleteMediaAsset(ctx.workspaceId, id);

    return Response.json(result, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
