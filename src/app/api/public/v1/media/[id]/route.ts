// Public API: DELETE /api/public/v1/media/{id}
// Removes a media asset (doc + storage object) and releases its bytes from
// the workspace's cumulative storage usage. Posts that already embedded the
// asset's URL keep the dangling reference — deleting in-use media is the
// caller's responsibility.
import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import type { PublicMediaAsset } from '@/lib/public-api/media';
import { publicApiError } from '@/lib/public-api/response';
import { refundStorage } from '@/lib/usage';

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

    const assetRef = adminDb.doc(`workspaces/${ctx.workspaceId}/media_assets/${id}`);
    const snap = await assetRef.get();
    if (!snap.exists) throw new Error('NOT_FOUND');
    const asset = snap.data() as PublicMediaAsset;

    if (asset.storagePath) {
      const admin = await import('firebase-admin');
      await admin.storage().bucket().file(asset.storagePath).delete({ ignoreNotFound: true });
    }
    await assetRef.delete();
    // Release the bytes only after doc + object are gone, so a failed delete
    // never under-counts. Legacy assets without a recorded size release 0.
    await refundStorage(ctx.workspaceId, Number(asset.sizeBytes) || 0);

    return Response.json({ deleted: true, id }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
