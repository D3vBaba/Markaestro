/**
 * Invariants for storage accounting (`FP-01`, `CR-04`).
 *
 * The property under test: bytes reserved on upload come back when the asset is
 * deleted, so a workspace's counter returns to where it started. Before this
 * work the counter only ever grew, because the in-app upload paths never wrote
 * a `media_assets` document and so nothing could ever call `refundStorage`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, mockDoc, mockCollection, mockRunTransaction, refundStorage, storageBucketFile } = vi.hoisted(() => {
  const state = {
    assets: {} as Record<string, Record<string, unknown>>,
    posts: [] as Array<{ id: string; mediaUrls: string[]; status: string }>,
    refundedBytes: 0,
    deletedObjects: [] as string[],
    deletedDocs: [] as string[],
    /** Records the order of side effects so the delete ordering can be asserted. */
    operations: [] as string[],
  };

  function makeDocRef(path: string) {
    const id = path.split('/').pop() as string;
    return {
      id,
      path,
      get: async () => ({
        exists: id in state.assets,
        id,
        data: () => state.assets[id],
      }),
      set: async (data: Record<string, unknown>) => {
        state.assets[id] = { ...state.assets[id], ...data };
      },
      delete: async () => {
        state.operations.push('delete-doc');
        state.deletedDocs.push(id);
        delete state.assets[id];
      },
    };
  }

  const mockDoc = vi.fn((path: string) => makeDocRef(path));

  const mockCollection = vi.fn((path: string) => {
    if (/media_assets$/.test(path)) {
      const build = (predicate: (asset: Record<string, unknown>) => boolean) => ({
        where: (field: string, op: string, value: unknown) =>
          build((asset) => {
            if (!predicate(asset)) return false;
            if (op === '<=') return typeof asset[field] === 'string' && (asset[field] as string) <= String(value);
            if (Array.isArray(value)) return (value as unknown[]).includes(asset[field]);
            return asset[field] === value;
          }),
        limit: () => build(predicate),
        get: async () => {
          const docs = Object.entries(state.assets)
            .filter(([, asset]) => predicate(asset))
            .map(([id, asset]) => ({ id, data: () => asset }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      });
      return { ...build(() => true), doc: (id: string) => makeDocRef(`${path}/${id}`) };
    }
    if (/posts$/.test(path)) {
      return {
        where: (_field: string, _op: string, url: unknown) => ({
          get: async () => {
            const docs = state.posts
              .filter((post) => post.mediaUrls.includes(String(url)))
              .map((post) => ({ id: post.id, data: () => post }));
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
        }),
      };
    }
    throw new Error(`unexpected collection: ${path}`);
  });

  const mockRunTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { id: string }, data: Record<string, unknown>) => {
        state.assets[ref.id] = { ...state.assets[ref.id], ...data };
      },
    };
    return fn(tx);
  });

  const refundStorage = vi.fn(async (_workspaceId: string, bytes: number) => {
    state.operations.push('refund');
    state.refundedBytes += bytes;
  });

  const storageBucketFile = vi.fn((path: string) => ({
    delete: async () => {
      state.operations.push('delete-object');
      state.deletedObjects.push(path);
    },
  }));

  return { state, mockDoc, mockCollection, mockRunTransaction, refundStorage, storageBucketFile };
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: mockDoc, collection: mockCollection, runTransaction: mockRunTransaction },
}));
vi.mock('@/lib/usage', () => ({ refundStorage }));
// The store does `(await import('firebase-admin')).storage()`, so the mock has
// to expose `storage` as a named export, not only on `default`.
vi.mock('firebase-admin', () => {
  const storage = () => ({ bucket: () => ({ file: storageBucketFile }) });
  return { storage, default: { storage } };
});
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  adjustAssetRefCounts,
  createMediaAssetRecord,
  deleteMediaAsset,
  getMediaAssetUsage,
  ORPHANED_ASSET_GRACE_MS,
  releasePostMedia,
  sweepOrphanedMediaAssets,
  syncPostMediaReferences,
  type MediaAsset,
} from '../media/asset-store';
import { ApiValidationError } from '../api-response';

const WORKSPACE = 'ws_1';
const ASSET_URL = 'https://storage.example.com/o/asset-one.jpg';

function assetFixture(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'ast_one',
    type: 'image',
    storagePath: `workspaces/${WORKSPACE}/uploads/one.jpg`,
    downloadUrl: ASSET_URL,
    mimeType: 'image/jpeg',
    sizeBytes: 1_500_000,
    width: 1080,
    height: 1080,
    originalFileName: 'one.jpg',
    createdByType: 'user',
    createdById: 'uid_1',
    createdAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.assets = {};
  state.posts = [];
  state.refundedBytes = 0;
  state.deletedObjects = [];
  state.deletedDocs = [];
  state.operations = [];
});

describe('storage accounting round trip', () => {
  it('returns the workspace byte counter to its starting value', async () => {
    // Upload records the asset with its size; delete releases exactly that many
    // bytes. This is the invariant the whole item exists to establish.
    const asset = assetFixture();
    await createMediaAssetRecord(WORKSPACE, asset);
    expect(state.assets.ast_one).toBeDefined();

    const result = await deleteMediaAsset(WORKSPACE, 'ast_one');

    expect(result.bytesReleased).toBe(asset.sizeBytes);
    expect(state.refundedBytes).toBe(asset.sizeBytes);
    expect(state.assets.ast_one).toBeUndefined();
  });

  it('deletes the object and the document before releasing the bytes', async () => {
    // Refunding last means a partial failure leaves the counter too high rather
    // than too low, so usage can never be under-counted by a failed delete.
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    await deleteMediaAsset(WORKSPACE, 'ast_one');
    expect(state.operations).toEqual(['delete-object', 'delete-doc', 'refund']);
  });

  it('releases zero for a legacy asset with no recorded size', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture({ sizeBytes: undefined as unknown as number }));
    const result = await deleteMediaAsset(WORKSPACE, 'ast_one');
    expect(result.bytesReleased).toBe(0);
    expect(state.refundedBytes).toBe(0);
  });

  it('records new assets with a zero reference count and no orphan stamp', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    expect(state.assets.ast_one).toMatchObject({ refCount: 0, orphanedAt: null });
  });

  it('reports NOT_FOUND for an asset that does not exist', async () => {
    await expect(deleteMediaAsset(WORKSPACE, 'ast_missing')).rejects.toThrow('NOT_FOUND');
    expect(state.refundedBytes).toBe(0);
  });
});

describe('in-use protection', () => {
  it('refuses to delete media a scheduled post still needs', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    state.posts = [{ id: 'post_1', mediaUrls: [ASSET_URL], status: 'scheduled' }];

    await expect(deleteMediaAsset(WORKSPACE, 'ast_one')).rejects.toThrow(ApiValidationError);
    // Nothing was touched: the asset and its bytes are still there.
    expect(state.assets.ast_one).toBeDefined();
    expect(state.refundedBytes).toBe(0);
    expect(state.deletedObjects).toEqual([]);
  });

  it('names the blocking post count in the error', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    state.posts = [
      { id: 'post_1', mediaUrls: [ASSET_URL], status: 'scheduled' },
      { id: 'post_2', mediaUrls: [ASSET_URL], status: 'publishing' },
    ];
    try {
      await deleteMediaAsset(WORKSPACE, 'ast_one');
      throw new Error('expected the delete to be refused');
    } catch (error) {
      const validation = error as ApiValidationError;
      expect(validation.message).toBe('VALIDATION_MEDIA_IN_USE');
      expect(validation.userMessage).toContain('2 posts');
      expect(validation.details).toMatchObject({ blockingPostCount: 2 });
    }
  });

  it('allows the delete when only published posts reference it, with a warning', async () => {
    // The platform holds its own copy, so the live post is unaffected.
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    state.posts = [{ id: 'post_1', mediaUrls: [ASSET_URL], status: 'published' }];

    const result = await deleteMediaAsset(WORKSPACE, 'ast_one');
    expect(result.deleted).toBe(true);
    expect(result.warning).toContain('published post');
    expect(state.refundedBytes).toBe(1_500_000);
  });

  it('does not block on draft posts', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    state.posts = [{ id: 'post_1', mediaUrls: [ASSET_URL], status: 'draft' }];
    await expect(deleteMediaAsset(WORKSPACE, 'ast_one')).resolves.toMatchObject({ deleted: true });
  });

  it('skips the reference check when the caller opts out', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    state.posts = [{ id: 'post_1', mediaUrls: [ASSET_URL], status: 'scheduled' }];
    await expect(deleteMediaAsset(WORKSPACE, 'ast_one', { checkReferences: false }))
      .resolves.toMatchObject({ deleted: true });
  });
});

describe('reference counting', () => {
  it('counts a post attaching and detaching an asset', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());

    await syncPostMediaReferences(WORKSPACE, [], [ASSET_URL]);
    expect(state.assets.ast_one).toMatchObject({ refCount: 1, orphanedAt: null });

    await syncPostMediaReferences(WORKSPACE, [ASSET_URL], []);
    expect(state.assets.ast_one).toMatchObject({ refCount: 0 });
    expect(state.assets.ast_one.orphanedAt).toBeTruthy();
  });

  it('does not orphan an asset another post still uses', async () => {
    // The reason this is reference counted rather than a cascade delete.
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    await syncPostMediaReferences(WORKSPACE, [], [ASSET_URL]);
    await syncPostMediaReferences(WORKSPACE, [], [ASSET_URL]);
    expect(state.assets.ast_one).toMatchObject({ refCount: 2 });

    await releasePostMedia(WORKSPACE, [ASSET_URL]);
    expect(state.assets.ast_one).toMatchObject({ refCount: 1, orphanedAt: null });
  });

  it('never lets a count go negative', async () => {
    // A legacy asset referenced before ref counting existed would otherwise go
    // negative on its first delete and never become collectable.
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    await adjustAssetRefCounts(WORKSPACE, ['ast_one'], -1);
    await adjustAssetRefCounts(WORKSPACE, ['ast_one'], -1);
    expect(state.assets.ast_one).toMatchObject({ refCount: 0 });
  });

  it('ignores URLs that belong to no known asset', async () => {
    await expect(
      syncPostMediaReferences(WORKSPACE, [], ['https://example.com/not-ours.jpg']),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when a post edit does not change its media', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    await syncPostMediaReferences(WORKSPACE, [], [ASSET_URL]);
    await syncPostMediaReferences(WORKSPACE, [ASSET_URL], [ASSET_URL]);
    expect(state.assets.ast_one).toMatchObject({ refCount: 1 });
  });

  it('tolerates a post with no media at all', async () => {
    await expect(releasePostMedia(WORKSPACE, undefined)).resolves.toBeUndefined();
    await expect(releasePostMedia(WORKSPACE, [])).resolves.toBeUndefined();
    await expect(releasePostMedia(WORKSPACE, 'not-an-array')).resolves.toBeUndefined();
  });
});

describe('media usage reporting', () => {
  it('separates blocking posts from published ones', async () => {
    state.posts = [
      { id: 'p1', mediaUrls: [ASSET_URL], status: 'scheduled' },
      { id: 'p2', mediaUrls: [ASSET_URL], status: 'published' },
      { id: 'p3', mediaUrls: [ASSET_URL], status: 'draft' },
    ];
    const usage = await getMediaAssetUsage(WORKSPACE, ASSET_URL);
    expect(usage).toEqual({ blockingPostCount: 1, publishedPostCount: 1, totalPostCount: 3 });
  });

  it('reports nothing for an empty URL rather than scanning every post', async () => {
    state.posts = [{ id: 'p1', mediaUrls: [ASSET_URL], status: 'scheduled' }];
    const usage = await getMediaAssetUsage(WORKSPACE, '');
    expect(usage).toEqual({ blockingPostCount: 0, publishedPostCount: 0, totalPostCount: 0 });
  });
});

describe('orphaned asset sweep', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  const longAgo = new Date(now.getTime() - ORPHANED_ASSET_GRACE_MS - 60_000).toISOString();
  const recently = new Date(now.getTime() - 60_000).toISOString();

  it('reclaims an asset orphaned longer than the grace window', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture({ orphanedAt: longAgo }));

    const result = await sweepOrphanedMediaAssets(WORKSPACE, { now });

    expect(result).toMatchObject({ scanned: 1, deleted: 1, bytesReleased: 1_500_000, skipped: 0 });
    expect(state.assets.ast_one).toBeUndefined();
    expect(state.refundedBytes).toBe(1_500_000);
  });

  it('leaves an asset inside the grace window alone, so users get an undo', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture({ orphanedAt: recently }));

    const result = await sweepOrphanedMediaAssets(WORKSPACE, { now });

    expect(result).toMatchObject({ scanned: 0, deleted: 0 });
    expect(state.assets.ast_one).toBeDefined();
    expect(state.refundedBytes).toBe(0);
  });

  it('never touches an asset that was never orphaned', async () => {
    await createMediaAssetRecord(WORKSPACE, assetFixture());
    const result = await sweepOrphanedMediaAssets(WORKSPACE, { now });
    expect(result.scanned).toBe(0);
    expect(state.assets.ast_one).toBeDefined();
  });

  it('rescues an asset a post still references, rather than deleting live media', async () => {
    // The reference count is bookkeeping and can drift; the post query is the
    // ground truth, and it wins.
    await createMediaAssetRecord(WORKSPACE, assetFixture({ orphanedAt: longAgo }));
    state.posts = [{ id: 'post_1', mediaUrls: [ASSET_URL], status: 'draft' }];

    const result = await sweepOrphanedMediaAssets(WORKSPACE, { now });

    expect(result).toMatchObject({ scanned: 1, deleted: 0, skipped: 1 });
    expect(state.assets.ast_one).toMatchObject({ refCount: 1, orphanedAt: null });
    expect(state.refundedBytes).toBe(0);
  });

  it('reports nothing to do for an empty workspace', async () => {
    const result = await sweepOrphanedMediaAssets(WORKSPACE, { now });
    expect(result).toEqual({ scanned: 0, deleted: 0, bytesReleased: 0, skipped: 0 });
  });
});
