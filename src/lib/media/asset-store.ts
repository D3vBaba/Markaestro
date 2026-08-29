/**
 * Shared record-keeping for uploaded media.
 *
 * Storage is metered and billed against a per-plan cap. Before this module, the
 * in-app upload paths wrote the object and reserved the bytes but never created
 * a `media_assets` document, so there was nothing to list and nothing to delete,
 * and `refundStorage` had exactly one user-reachable caller. A workspace's byte
 * counter only ever went up, and a customer who filled their cap had no
 * self-service way to free a single byte.
 *
 * Every upload surface (app upload, app finalize, public API, connect API) now
 * writes through here, so the asset list is complete and a delete can release
 * the bytes it accounted for.
 */

import { adminDb } from '@/lib/firebase-admin';
import { executeListQueryPage } from '@/lib/firestore-list-query';
import { refundStorage } from '@/lib/usage';
import { ApiValidationError } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export type MediaAssetType = 'image' | 'video';

/** Who uploaded an asset. Drives which surfaces list it by default. */
export type MediaCreatedByType = 'api_client' | 'user';

export type MediaAsset = {
  id: string;
  type: MediaAssetType;
  storagePath: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalFileName: string;
  createdByType: MediaCreatedByType;
  createdById: string;
  createdAt: string;
  /**
   * How many posts currently reference this asset. Maintained by
   * `syncPostMediaReferences`; absent on assets created before ref counting.
   */
  refCount?: number;
  /**
   * Set when `refCount` falls to zero. A sweep deletes assets orphaned for
   * longer than the grace window, which gives users an undo window and keeps
   * post deletion fast.
   */
  orphanedAt?: string | null;
  /**
   * Derivation pipeline state (5.8). `pending` on create; the worker produces
   * the thumbnail and any missing dimensions and marks the asset `ready`.
   * Absent on assets that predate the pipeline, which readers treat as
   * `ready` with no thumbnail: nothing was ever pending for them.
   */
  processingState?: 'pending' | 'ready';
  /**
   * Token-gated URL of the derived thumbnail (longest edge 320px). What a
   * grid should load: ~20 KB per cell instead of the multi-MB original.
   */
  thumbnailUrl?: string | null;
};

export function mediaAssetsCollection(workspaceId: string) {
  return adminDb.collection(`workspaces/${workspaceId}/media_assets`);
}

export function mediaAssetRef(workspaceId: string, assetId: string) {
  return adminDb.doc(`workspaces/${workspaceId}/media_assets/${assetId}`);
}

/**
 * Grace period between an asset losing its last reference and becoming
 * eligible for deletion by the sweep.
 */
export const ORPHANED_ASSET_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export async function createMediaAssetRecord(
  workspaceId: string,
  asset: MediaAsset,
): Promise<MediaAsset> {
  const record: MediaAsset = {
    ...asset,
    refCount: asset.refCount ?? 0,
    orphanedAt: asset.orphanedAt ?? null,
    // Every new asset enters the derivation pipeline; the worker marks it
    // ready once the thumbnail exists (5.8).
    processingState: asset.processingState ?? 'pending',
    thumbnailUrl: asset.thumbnailUrl ?? null,
  };
  await mediaAssetRef(workspaceId, asset.id).set(record);
  return record;
}

export async function getMediaAsset(workspaceId: string, assetId: string): Promise<MediaAsset> {
  const snap = await mediaAssetRef(workspaceId, assetId).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  return { ...(snap.data() as MediaAsset), id: snap.id };
}

export type ListMediaAssetsOptions = {
  cursor?: string;
  limit?: number;
  createdByType?: MediaCreatedByType;
  type?: MediaAssetType;
};

/**
 * Cursor-paginated asset listing, serving the app's media library and both API
 * surfaces. Each caller projects the result into its own response shape.
 */
export async function listMediaAssets(workspaceId: string, options: ListMediaAssetsOptions = {}) {
  const filters: Array<{ field: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }> = [];
  if (options.createdByType) {
    filters.push({ field: 'createdByType', op: '==', value: options.createdByType });
  }
  if (options.type) {
    filters.push({ field: 'type', op: '==', value: options.type });
  }
  return executeListQueryPage<MediaAsset>(mediaAssetsCollection(workspaceId), {
    filters,
    orderByField: 'createdAt',
    orderByDirection: 'desc',
    limit: options.limit ?? 50,
    cursor: options.cursor,
  });
}

/** Statuses whose posts still need their media, so it must not be deleted. */
const MEDIA_LOCKING_POST_STATUSES = ['scheduled', 'publishing'] as const;

export type MediaUsage = {
  /** Posts that reference the asset and would break if it disappeared. */
  blockingPostCount: number;
  /** Published posts referencing it. The platform holds its own copy. */
  publishedPostCount: number;
  totalPostCount: number;
};

/**
 * Find the posts referencing an asset URL.
 *
 * `mediaUrls` is an array field, so `array-contains` matches exactly the posts
 * that embedded this asset.
 */
export async function getMediaAssetUsage(
  workspaceId: string,
  downloadUrl: string,
): Promise<MediaUsage> {
  if (!downloadUrl) {
    return { blockingPostCount: 0, publishedPostCount: 0, totalPostCount: 0 };
  }
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/posts`)
    .where('mediaUrls', 'array-contains', downloadUrl)
    .get();

  let blockingPostCount = 0;
  let publishedPostCount = 0;
  for (const doc of snap.docs) {
    const status = String(doc.data()?.status || '');
    if ((MEDIA_LOCKING_POST_STATUSES as readonly string[]).includes(status)) blockingPostCount++;
    else if (status === 'published') publishedPostCount++;
  }
  return { blockingPostCount, publishedPostCount, totalPostCount: snap.size };
}

export type DeleteMediaAssetResult = {
  id: string;
  deleted: true;
  bytesReleased: number;
  /** Set when the asset was still referenced by already-published posts. */
  warning?: string;
};

/**
 * Delete an asset: storage object, then document, then release the bytes.
 *
 * The ordering is the public API's and is deliberate: refunding last means a
 * partial failure leaves the counter too high rather than too low, so usage is
 * never under-counted and the cap cannot be escaped by a failed delete.
 *
 * `checkReferences` is on for user-facing deletes and off for internal cleanup
 * that has already decided the asset is unreferenced.
 */
export async function deleteMediaAsset(
  workspaceId: string,
  assetId: string,
  options: { checkReferences?: boolean } = {},
): Promise<DeleteMediaAssetResult> {
  const asset = await getMediaAsset(workspaceId, assetId);

  let warning: string | undefined;
  if (options.checkReferences !== false) {
    const usage = await getMediaAssetUsage(workspaceId, asset.downloadUrl);
    if (usage.blockingPostCount > 0) {
      throw new ApiValidationError(
        'VALIDATION_MEDIA_IN_USE',
        usage.blockingPostCount === 1
          ? 'This file is used by 1 post that is scheduled or publishing. Remove it from that post first.'
          : `This file is used by ${usage.blockingPostCount} posts that are scheduled or publishing. Remove it from those posts first.`,
        { assetId, blockingPostCount: usage.blockingPostCount },
      );
    }
    if (usage.publishedPostCount > 0) {
      warning = usage.publishedPostCount === 1
        ? 'This file was used by 1 published post. The post stays live because the platform keeps its own copy, but the file is no longer available here.'
        : `This file was used by ${usage.publishedPostCount} published posts. Those posts stay live because the platforms keep their own copies, but the file is no longer available here.`;
    }
  }

  if (asset.storagePath) {
    const admin = await import('firebase-admin');
    await admin.storage().bucket().file(asset.storagePath).delete({ ignoreNotFound: true });
  }
  await mediaAssetRef(workspaceId, assetId).delete();

  const bytesReleased = Number(asset.sizeBytes) || 0;
  await refundStorage(workspaceId, bytesReleased);

  return { id: assetId, deleted: true, bytesReleased, ...(warning ? { warning } : {}) };
}

/**
 * Look up the assets a set of media URLs belongs to.
 *
 * Posts store resolved URLs rather than asset ids (the app's composer has
 * always worked that way), so reference counting has to map back. Chunked
 * because Firestore caps an `in` filter at 30 values.
 */
export async function findAssetIdsByUrls(workspaceId: string, urls: string[]): Promise<string[]> {
  const unique = [...new Set(urls.filter((url) => typeof url === 'string' && url))];
  if (unique.length === 0) return [];

  const ids: string[] = [];
  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snap = await mediaAssetsCollection(workspaceId)
      .where('downloadUrl', 'in', chunk)
      .get();
    ids.push(...snap.docs.map((doc) => doc.id));
  }
  return ids;
}

/**
 * Move an asset's reference count and mark or clear its orphan timestamp.
 *
 * Deferred cleanup rather than immediate delete: an asset can be attached to
 * several posts, and deleting a post must never delete media another post still
 * uses. Marking `orphanedAt` and letting a sweep collect it later also gives
 * users an undo window and keeps post deletion fast.
 */
export async function adjustAssetRefCounts(
  workspaceId: string,
  assetIds: string[],
  delta: number,
): Promise<void> {
  if (assetIds.length === 0 || delta === 0) return;

  const now = new Date().toISOString();
  await Promise.all(
    assetIds.map(async (assetId) => {
      const ref = mediaAssetRef(workspaceId, assetId);
      try {
        await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const current = Number(snap.data()?.refCount) || 0;
          // Clamped at zero: a legacy asset that was referenced before ref
          // counting existed would otherwise go negative on its first delete
          // and never be collectable.
          const next = Math.max(0, current + delta);
          tx.set(ref, {
            refCount: next,
            orphanedAt: next === 0 ? now : null,
          }, { merge: true });
        });
      } catch (error) {
        // Reference counting is bookkeeping for a deferred sweep, not a
        // correctness invariant of the delete itself. Losing one increment
        // costs storage; failing the user's delete costs them the operation.
        logger.warn('media asset reference count update failed', {
          event: 'media.ref_count_failed',
          workspaceId,
          assetId,
          delta,
          err: error,
        });
      }
    }),
  );
}

/**
 * Bring an asset's reference counts in line with a post's media changing from
 * `previousUrls` to `nextUrls`. Passing an empty `nextUrls` covers deletion.
 */
export async function syncPostMediaReferences(
  workspaceId: string,
  previousUrls: string[],
  nextUrls: string[],
): Promise<void> {
  const previous = new Set(previousUrls.filter(Boolean));
  const next = new Set(nextUrls.filter(Boolean));

  const added = [...next].filter((url) => !previous.has(url));
  const removed = [...previous].filter((url) => !next.has(url));
  if (added.length === 0 && removed.length === 0) return;

  const [addedIds, removedIds] = await Promise.all([
    findAssetIdsByUrls(workspaceId, added),
    findAssetIdsByUrls(workspaceId, removed),
  ]);

  await Promise.all([
    adjustAssetRefCounts(workspaceId, addedIds, 1),
    adjustAssetRefCounts(workspaceId, removedIds, -1),
  ]);
}

/** Release the media a deleted post held. Never throws into the delete path. */
export async function releasePostMedia(
  workspaceId: string,
  mediaUrls: unknown,
): Promise<void> {
  const urls = Array.isArray(mediaUrls)
    ? mediaUrls.filter((url): url is string => typeof url === 'string' && Boolean(url))
    : [];
  if (urls.length === 0) return;
  await syncPostMediaReferences(workspaceId, urls, []).catch((error) => {
    logger.warn('releasing post media references failed', {
      event: 'media.release_failed',
      workspaceId,
      err: error,
    });
  });
}

/**
 * Release the media a deleted product held.
 *
 * Note that deleting a product does NOT delete its posts: the route detaches
 * them (`productId: ''`, `deletedProductId`) and they survive. Their media is
 * therefore still referenced and must not be released here. Only the product's
 * own brand assets, currently just the logo, lose their reference.
 */
export async function releaseProductMedia(
  workspaceId: string,
  product: Record<string, unknown>,
): Promise<void> {
  const identity = product.brandIdentity as { logoUrl?: unknown } | undefined;
  const logoUrl = typeof identity?.logoUrl === 'string' ? identity.logoUrl : '';
  if (!logoUrl) return;
  await syncPostMediaReferences(workspaceId, [logoUrl], []).catch((error) => {
    logger.warn('releasing product media references failed', {
      event: 'media.release_failed',
      workspaceId,
      err: error,
    });
  });
}

export type OrphanSweepResult = { scanned: number; deleted: number; bytesReleased: number; skipped: number };

/**
 * Delete assets that have been unreferenced for longer than the grace window.
 *
 * This is what makes `orphanedAt` mean something: without a sweep, deleting a
 * post marks its media orphaned and the bytes are never actually returned.
 * Deferred rather than immediate so users get an undo window and so post
 * deletion stays fast.
 *
 * Every candidate is re-checked against live posts before it goes: the count
 * is bookkeeping and can drift (a failed increment, a legacy asset), and the
 * post query is the ground truth. Bounded per tick so one workspace with a
 * large backlog cannot monopolise the worker.
 */
export async function sweepOrphanedMediaAssets(
  workspaceId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<OrphanSweepResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ORPHANED_ASSET_GRACE_MS).toISOString();
  const result: OrphanSweepResult = { scanned: 0, deleted: 0, bytesReleased: 0, skipped: 0 };

  const snap = await mediaAssetsCollection(workspaceId)
    .where('orphanedAt', '<=', cutoff)
    .limit(options.limit ?? 25)
    .get();

  for (const doc of snap.docs) {
    result.scanned++;
    const asset = { ...(doc.data() as MediaAsset), id: doc.id };
    try {
      // Ground truth beats the counter. If any post still embeds this URL, the
      // count was wrong; clear the orphan mark rather than delete live media.
      const usage = await getMediaAssetUsage(workspaceId, asset.downloadUrl);
      if (usage.totalPostCount > 0) {
        await mediaAssetRef(workspaceId, asset.id).set(
          { refCount: usage.totalPostCount, orphanedAt: null },
          { merge: true },
        );
        result.skipped++;
        continue;
      }
      const deleted = await deleteMediaAsset(workspaceId, asset.id, { checkReferences: false });
      result.deleted++;
      result.bytesReleased += deleted.bytesReleased;
    } catch (error) {
      result.skipped++;
      logger.warn('orphaned media asset sweep skipped an asset', {
        event: 'media.orphan_sweep_skipped',
        workspaceId,
        assetId: asset.id,
        err: error,
      });
    }
  }

  if (result.deleted > 0) {
    logger.info('reclaimed orphaned media storage', {
      event: 'media.orphan_sweep_reclaimed',
      workspaceId,
      deleted: result.deleted,
      bytesReleased: result.bytesReleased,
    });
  }

  return result;
}

/** Serialize an asset for a client, without the internal storage path. */
export function serializeMediaAsset(asset: MediaAsset & { id: string }) {
  return {
    id: asset.id,
    type: asset.type,
    url: asset.downloadUrl,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes) || 0,
    width: asset.width ?? null,
    height: asset.height ?? null,
    originalFileName: asset.originalFileName || '',
    createdByType: asset.createdByType,
    createdAt: asset.createdAt,
    refCount: Number(asset.refCount) || 0,
    // Absent on pre-pipeline assets; they were never pending.
    processingState: asset.processingState ?? 'ready',
    thumbnailUrl: asset.thumbnailUrl ?? null,
  };
}
