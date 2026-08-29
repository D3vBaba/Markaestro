// Connect API: GET /api/connect/v1/media
// Clients call this to resolve post thumbnails and to confirm an upload
// landed. It used to authenticate, spend rate-limit budget, increment the
// client's request counter, and return a hardcoded empty set while being
// documented as a real endpoint, so a client could not tell "no media" from
// "not implemented".
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { listMediaAssets } from '@/lib/media/asset-store';

export const runtime = 'nodejs';

const MEDIA_LIST_LIMIT = 100;

export async function GET(req: Request) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'posts.read' });
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), MEDIA_LIST_LIMIT);
    const cursor = url.searchParams.get('cursor') || undefined;

    const page = await listMediaAssets(ctx.workspaceId, { limit, cursor });

    // Connect's own shape: clients resolve `object.url`, the same accessor the
    // posts list already hands them.
    const data = page.items.map((asset) => ({
      id: asset.id,
      object: { url: asset.downloadUrl },
      url: asset.downloadUrl,
      type: asset.type,
      mime_type: asset.mimeType,
      size_bytes: Number(asset.sizeBytes) || 0,
      width: asset.width ?? null,
      height: asset.height ?? null,
      created_at: asset.createdAt,
    }));

    return Response.json(
      { data, next_cursor: page.nextCursor },
      { headers: ctx.rateLimitHeaders },
    );
  } catch (error) {
    return publicApiError(error);
  }
}
