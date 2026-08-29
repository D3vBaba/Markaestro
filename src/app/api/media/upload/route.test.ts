import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockContext } from '@/test/route-harness';

/**
 * `POST /api/media/upload` reserved storage bytes, wrote the object, returned
 * a URL, and never created a `media_assets` document. Only the public and
 * connect upload paths did that.
 *
 * The consequence was not subtle: with no asset record there was nothing to
 * list, nothing to delete, and therefore nothing that could ever call
 * `refundStorage`. Storage is metered and billed and capped at 1 GB on
 * Starter, so a customer who filled it got `QUOTA_EXCEEDED_STORAGE` on every
 * upload with no self-service way to free a single byte.
 *
 * The invariant worth holding here is the accounting one: every path that
 * reserves bytes either records an asset that can release them, or refunds
 * them on the way out. There is no third option.
 */

const requireContextMock = vi.fn();
const reserveStorageMock = vi.fn();
const refundStorageMock = vi.fn();
const uploadToStorageMock = vi.fn();
const createMediaAssetRecordMock = vi.fn();

vi.mock('@/lib/server-auth', () => ({ requireContext: () => requireContextMock() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { api: { limit: 100, windowMs: 60_000 } },
  applyRateLimit: async () => ({ headers: {} }),
}));
vi.mock('@/lib/usage', () => ({
  reserveStorage: (...args: unknown[]) => reserveStorageMock(...args),
  refundStorage: (...args: unknown[]) => refundStorageMock(...args),
}));
vi.mock('@/lib/stripe/entitlements', () => ({
  getEffectiveLimits: async () => ({ storageGb: 1 }),
}));
vi.mock('@/lib/storage', () => ({
  uploadToStorage: (...args: unknown[]) => uploadToStorageMock(...args),
}));
vi.mock('@/lib/media/asset-store', () => ({
  createMediaAssetRecord: (...args: unknown[]) => createMediaAssetRecordMock(...args),
  serializeMediaAsset: (asset: Record<string, unknown>) => asset,
}));
vi.mock('@/lib/media/asset-metadata', () => ({
  mediaAssetTypeForMimeType: (mime: string) => (mime.startsWith('video/') ? 'video' : 'image'),
  readImageDimensions: async () => ({ width: 1080, height: 1080 }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

function upload(file: File | null, field = 'image') {
  const form = new FormData();
  if (file) form.set(field, file);
  return new Request('http://localhost/api/media/upload', { method: 'POST', body: form });
}

function imageFile(bytes = 1024, type = 'image/png') {
  return new File([new Uint8Array(bytes)], 'photo.png', { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireContextMock.mockResolvedValue(mockContext());
  reserveStorageMock.mockResolvedValue({ allowed: true });
  refundStorageMock.mockResolvedValue(undefined);
  uploadToStorageMock.mockResolvedValue('https://storage.example/a.png');
  createMediaAssetRecordMock.mockImplementation(async (_ws: string, asset: Record<string, unknown>) => asset);
});

async function post(request: Request) {
  const { POST } = await import('./route');
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

describe('POST /api/media/upload', () => {
  it('records an asset for an in-app upload, so the bytes can be released later', async () => {
    const res = await post(upload(imageFile()));

    expect(res.status).toBe(200);
    expect(createMediaAssetRecordMock).toHaveBeenCalledOnce();
    const [workspaceId, asset] = createMediaAssetRecordMock.mock.calls[0];
    expect(workspaceId).toBe('ws_1');
    expect(asset).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      sizeBytes: 1024,
      // The field that distinguishes an in-app upload from an API one, which
      // is what makes a single media library able to show both.
      createdByType: 'user',
      createdById: 'user_1',
    });
    expect(asset.storagePath).toContain('workspaces/ws_1/uploads/');
  });

  it('does not refund storage on a successful upload', async () => {
    await post(upload(imageFile()));
    expect(refundStorageMock).not.toHaveBeenCalled();
  });

  it('refunds the reservation when the storage write fails', async () => {
    // Otherwise the counter grows by bytes that were never stored.
    uploadToStorageMock.mockRejectedValue(new Error('bucket unavailable'));

    const res = await post(upload(imageFile(2048)));

    expect(res.status).toBe(500);
    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 2048);
  });

  it('refunds the reservation when writing the asset record fails', async () => {
    // The record is what makes the bytes releasable; without it, keeping the
    // reservation would strand them permanently.
    createMediaAssetRecordMock.mockRejectedValue(new Error('firestore unavailable'));

    await post(upload(imageFile(4096)));

    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 4096);
  });

  it('refuses a file type the policy does not accept, before reserving anything', async () => {
    const res = await post(upload(new File(['x'], 'evil.svg', { type: 'image/svg+xml' })));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_INVALID_FILE_TYPE');
    // An invalid file must not create a usage transaction only to refund it.
    expect(reserveStorageMock).not.toHaveBeenCalled();
    expect(refundStorageMock).not.toHaveBeenCalled();
  });

  it('refuses a request with no file at all', async () => {
    const res = await post(upload(null));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_NO_FILE_PROVIDED');
  });

  it('reports a full workspace as a quota error, not a generic failure', async () => {
    reserveStorageMock.mockResolvedValue({
      allowed: false,
      reason: 'quota_exceeded',
      currentBytes: 1_073_741_824,
      limitBytes: 1_073_741_824,
    });

    const res = await post(upload(imageFile()));

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('QUOTA_EXCEEDED_STORAGE');
    expect(createMediaAssetRecordMock).not.toHaveBeenCalled();
  });

  it('accepts the `video` and `file` form fields as well as `image`', async () => {
    for (const field of ['video', 'file']) {
      vi.clearAllMocks();
      requireContextMock.mockResolvedValue(mockContext());
      reserveStorageMock.mockResolvedValue({ allowed: true });
      uploadToStorageMock.mockResolvedValue('https://storage.example/a.mp4');
      createMediaAssetRecordMock.mockImplementation(async (_w: string, a: Record<string, unknown>) => a);

      const res = await post(upload(
        new File([new Uint8Array(2048)], 'clip.mp4', { type: 'video/mp4' }),
        field,
      ));

      expect(res.status, field).toBe(200);
      expect(createMediaAssetRecordMock.mock.calls[0][1].type).toBe('video');
    }
  });
});
