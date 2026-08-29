import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
const assetGetMock = vi.fn();
const assetDeleteMock = vi.fn();
const storageDeleteMock = vi.fn();
const refundStorageMock = vi.fn();
const postsGetMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: () => ({ get: assetGetMock, delete: assetDeleteMock }),
    // The shared delete now checks whether any post still needs the asset.
    collection: () => ({ where: () => ({ get: postsGetMock }) }),
  },
}));

vi.mock('firebase-admin', () => ({
  storage: () => ({
    bucket: () => ({
      file: () => ({ delete: storageDeleteMock }),
    }),
  }),
}));

vi.mock('@/lib/usage', () => ({
  refundStorage: refundStorageMock,
}));

const ASSET_ID = 'ast_2f9b6c1e-4d7a-4b6e-9c3d-1a2b3c4d5e6f';
const ASSET_URL = 'https://storage.example.com/o/asset.png';

function call(id: string) {
  return import('./route').then(({ DELETE }) => DELETE(
    new Request(`http://localhost/api/public/v1/media/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  ));
}

function postsMatching(...statuses: string[]) {
  const docs = statuses.map((status, index) => ({
    id: `post_${index}`,
    data: () => ({ status, mediaUrls: [ASSET_URL] }),
  }));
  return { docs, size: docs.length, empty: docs.length === 0 };
}

describe('DELETE /api/public/v1/media/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockResolvedValue({
      workspaceId: 'ws_1',
      clientId: 'cli_1',
      principalType: 'api_client',
      rateLimitHeaders: { 'X-RateLimit-Limit': '20' },
    });
    assetGetMock.mockResolvedValue({
      exists: true,
      id: ASSET_ID,
      data: () => ({
        id: ASSET_ID,
        storagePath: `workspaces/ws_1/public-media/${ASSET_ID}.png`,
        downloadUrl: ASSET_URL,
        sizeBytes: 4_096,
      }),
    });
    assetDeleteMock.mockResolvedValue(undefined);
    storageDeleteMock.mockResolvedValue(undefined);
    refundStorageMock.mockResolvedValue(undefined);
    postsGetMock.mockResolvedValue(postsMatching());
  });

  it('deletes the object and doc, then releases the stored bytes', async () => {
    const response = await call(ASSET_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      id: ASSET_ID,
      bytesReleased: 4_096,
    });
    expect(storageDeleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(assetDeleteMock).toHaveBeenCalled();
    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 4_096);
  });

  it('decrements nothing for legacy assets without a recorded size', async () => {
    assetGetMock.mockResolvedValue({
      exists: true,
      id: ASSET_ID,
      data: () => ({
        id: ASSET_ID,
        storagePath: `workspaces/ws_1/public-media/${ASSET_ID}.png`,
        downloadUrl: ASSET_URL,
      }),
    });

    const response = await call(ASSET_ID);

    expect(response.status).toBe(200);
    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 0);
  });

  it('refuses to delete media a scheduled post still needs', async () => {
    postsGetMock.mockResolvedValue(postsMatching('scheduled'));

    const response = await call(ASSET_ID);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_MEDIA_IN_USE' });
    expect(storageDeleteMock).not.toHaveBeenCalled();
    expect(refundStorageMock).not.toHaveBeenCalled();
  });

  it('deletes media held only by published posts, with a warning', async () => {
    postsGetMock.mockResolvedValue(postsMatching('published'));

    const response = await call(ASSET_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);
    expect(body.warning).toContain('published post');
    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 4_096);
  });

  it('404s unknown and malformed asset ids without touching storage', async () => {
    assetGetMock.mockResolvedValue({ exists: false, data: () => undefined });
    expect((await call(ASSET_ID)).status).toBe(404);

    expect((await call('not-an-asset-id')).status).toBe(404);
    expect(storageDeleteMock).not.toHaveBeenCalled();
    expect(assetDeleteMock).not.toHaveBeenCalled();
    expect(refundStorageMock).not.toHaveBeenCalled();
  });
});
