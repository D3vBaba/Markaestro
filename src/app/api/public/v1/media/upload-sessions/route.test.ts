import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
const signedUrlMock = vi.fn();
const sessionSetMock = vi.fn();
const getEffectiveLimitsMock = vi.fn();
const reserveStorageMock = vi.fn();
const refundStorageMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  requirePublicApiContext: requirePublicApiContextMock,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: () => ({ set: sessionSetMock }),
  },
}));

vi.mock('firebase-admin', () => ({
  storage: () => ({
    bucket: () => ({
      file: () => ({ getSignedUrl: signedUrlMock }),
    }),
  }),
}));

vi.mock('@/lib/stripe/entitlements', () => ({
  getEffectiveLimits: getEffectiveLimitsMock,
}));

vi.mock('@/lib/usage', () => ({
  reserveStorage: reserveStorageMock,
  refundStorage: refundStorageMock,
}));

function request() {
  return new Request('http://localhost/api/public/v1/media/upload-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'launch.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1_024,
    }),
  });
}

describe('POST /api/public/v1/media/upload-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePublicApiContextMock.mockResolvedValue({
      workspaceId: 'ws_1',
      clientId: 'cli_1',
      ownerUid: 'user_1',
      principalType: 'api_client',
      rateLimitHeaders: { 'X-RateLimit-Limit': '20' },
    });
    getEffectiveLimitsMock.mockResolvedValue({ tier: 'starter', storageGb: 10 });
    reserveStorageMock.mockResolvedValue({
      allowed: true,
      currentBytes: 1_024,
      limitBytes: 10 * 1024 ** 3,
    });
    signedUrlMock.mockResolvedValue(['https://storage.example/upload']);
    sessionSetMock.mockResolvedValue(undefined);
    refundStorageMock.mockResolvedValue(undefined);
  });

  it('reserves the declared bytes before returning a signed direct-upload URL', async () => {
    const { POST } = await import('./route');
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(getEffectiveLimitsMock).toHaveBeenCalledWith('user_1', 'ws_1');
    expect(reserveStorageMock).toHaveBeenCalledWith('ws_1', 1_024, { tier: 'starter', storageGb: 10 });
    expect(body.uploadSession).toMatchObject({
      uploadUrl: 'https://storage.example/upload',
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': 'image/jpeg' },
    });
    expect(sessionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ quotaReserved: true, reservedBytes: 1_024 }),
    );
    expect(refundStorageMock).not.toHaveBeenCalled();
  });

  it('does not issue a URL when the storage cap is exhausted', async () => {
    reserveStorageMock.mockResolvedValue({
      allowed: false,
      currentBytes: 10 * 1024 ** 3,
      limitBytes: 10 * 1024 ** 3,
      reason: 'quota_exceeded',
    });
    const { POST } = await import('./route');
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toBe('QUOTA_EXCEEDED_STORAGE');
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(sessionSetMock).not.toHaveBeenCalled();
  });

  it('refunds the reserved bytes if URL or session creation fails', async () => {
    sessionSetMock.mockRejectedValue(new Error('firestore unavailable'));
    const { POST } = await import('./route');
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(refundStorageMock).toHaveBeenCalledWith('ws_1', 1_024);
  });
});
