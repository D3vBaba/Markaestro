/**
 * The async media derivation pipeline (5.8).
 *
 * Media processing used to be fully synchronous inside request handlers:
 * upload latency was the user's problem and a CPU-bound `sharp` workload sat
 * in the request path of a Cloud Run instance serving everyone else too.
 * Derivation now runs in the worker tick, keyed off `processingState` on the
 * asset document: `pending` on create, `ready` when the derivations exist.
 *
 * What one pass produces per image asset:
 *   - missing dimensions, read once from the bytes;
 *   - a thumbnail (longest edge 320px, mozjpeg), stored as its own object,
 *     which is what turns a grid of 50 posts from ~100 MB of originals into
 *     ~1 MB of thumbnails (5.9);
 *   - a warmed proxy-transform cache entry, which removes the per-request
 *     `sharp` cost from `/api/media/proxy` for this asset entirely (4.3).
 *
 * Videos are marked ready without a thumbnail: frame extraction means ffmpeg
 * in the worker, and shipping a wrong-looking poster frame is worse than the
 * player's own first frame. The field stays null and the UI falls back.
 */

import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { uploadToStorage } from '@/lib/storage';
import { writeProxyCache } from '@/lib/media/proxy-cache';
import { mediaAssetRef, mediaAssetsCollection, type MediaAsset } from '@/lib/media/asset-store';

const MAX_ASSETS_PER_TICK = 5;
const THUMBNAIL_EDGE_PX = 320;
const THUMBNAIL_QUALITY = 70;

export type MediaPipelineSummary = {
  processed: number;
  thumbnails: number;
  errors: Array<{ assetId: string; error: string }>;
};

async function downloadAssetBytes(storagePath: string): Promise<Buffer> {
  const admin = await import('firebase-admin');
  const [bytes] = await admin.storage().bucket().file(storagePath).download();
  return bytes;
}

async function deriveImage(
  workspaceId: string,
  asset: MediaAsset,
): Promise<Partial<MediaAsset>> {
  const bytes = await downloadAssetBytes(asset.storagePath);
  const image = sharp(bytes).rotate();
  const metadata = await image.metadata();

  const thumbnail = await image
    .resize({
      width: THUMBNAIL_EDGE_PX,
      height: THUMBNAIL_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
    .toBuffer();

  const thumbnailUrl = await uploadToStorage(
    `workspaces/${workspaceId}/thumbs/${asset.id}.jpg`,
    thumbnail,
    'image/jpeg',
    { workspaceId, derivedFrom: asset.id },
  );

  // Warm the proxy cache while the decoded image is in hand, so the first
  // platform fetch of this asset is a cache hit instead of a fresh transform.
  await writeProxyCache(asset.downloadUrl, thumbnail.length < bytes.length ? await sharp(bytes)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer() : bytes).catch(() => null);

  return {
    thumbnailUrl,
    width: asset.width ?? metadata.width ?? null,
    height: asset.height ?? metadata.height ?? null,
  };
}

/**
 * Process up to {@link MAX_ASSETS_PER_TICK} pending assets for one workspace.
 * One flaky asset must not wedge the pipeline: failures mark the asset ready
 * without derivations (the original is intact and usable) and are reported.
 */
export async function processPendingMediaAssets(workspaceId: string): Promise<MediaPipelineSummary> {
  const summary: MediaPipelineSummary = { processed: 0, thumbnails: 0, errors: [] };

  const snapshot = await mediaAssetsCollection(workspaceId)
    .where('processingState', '==', 'pending')
    .limit(MAX_ASSETS_PER_TICK)
    .get();
  if (snapshot.empty) return summary;

  for (const doc of snapshot.docs) {
    const asset = { ...(doc.data() as MediaAsset), id: doc.id };
    try {
      const derived = asset.type === 'image' ? await deriveImage(workspaceId, asset) : {};
      await mediaAssetRef(workspaceId, asset.id).set({
        ...derived,
        processingState: 'ready',
        processedAt: new Date().toISOString(),
      }, { merge: true });
      summary.processed += 1;
      if (derived.thumbnailUrl) summary.thumbnails += 1;
    } catch (error) {
      // Ready-without-derivations, not stuck-in-pending: the original works
      // everywhere the thumbnail would have been an optimization, and a
      // poisoned asset must not consume the tick budget forever.
      await mediaAssetRef(workspaceId, asset.id).set({
        processingState: 'ready',
        processingError: error instanceof Error ? error.message.slice(0, 500) : 'derivation failed',
        processedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => undefined);
      summary.errors.push({
        assetId: asset.id,
        error: error instanceof Error ? error.message : 'unknown',
      });
      logger.warn('media derivation failed; asset left usable without thumbnail', {
        event: 'media.pipeline_failed',
        workspaceId,
        assetId: asset.id,
        err: error,
      });
    }
  }

  // More may be waiting past the per-tick budget.
  if (snapshot.size === MAX_ASSETS_PER_TICK) {
    const { markWorkspaceDue } = await import('@/lib/workers/due-workspaces');
    await markWorkspaceDue(workspaceId, new Date(), 'daily_job').catch(() => undefined);
  }

  return summary;
}
