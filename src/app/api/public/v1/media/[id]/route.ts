// Public API: DELETE /api/public/v1/media/{id}
// Removes a media asset (doc + storage object) and releases its bytes from the
// workspace's cumulative storage usage. Assets held by a scheduled or
// publishing post are refused; assets held only by published posts are deleted
// with a warning, since the platform keeps its own copy.
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import {
  createRequestHash,
  getIdempotencyKey,
  loadIdempotentResponse,
  persistIdempotentResponse,
} from '@/lib/public-api/idempotency';
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

    // A retried delete used to answer NOT_FOUND after its first attempt won;
    // with a key it replays the original result, storage refund included in
    // the record rather than double-issued.
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(`DELETE:media:${id}`) : null;
    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    // Shared with the app's DELETE /api/media/[id]: same ordering (object, then
    // doc, then refund) and the same in-use check, so the two surfaces cannot
    // disagree about whether an asset is safe to remove.
    const result = await deleteMediaAsset(ctx.workspaceId, id);

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 200, result);
    }
    return Response.json(result, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
