import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePublicApiContextMock = vi.fn();
const signedUrlMock = vi.fn();
const sessionSetMock = vi.fn();
const checkAndIncrementUsageMock = vi.fn();
const refundUsageMock = vi.fn();

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

vi.mock('@/lib/usage', () => ({
  checkAndIncrementUsage: checkAndIncrementUsageMock,
  refundUsage: refundUsageMock,
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
    checkAndIncrementUsageMock.mockResolvedValue({ allowed: true, current: 1, limit: 100 });
    signedUrlMock.mockResolvedValue(['https://storage.example/upload']);
    sessionSetMock.mockResolvedValue(undefined);
    refundUsageMock.mockResolvedValue(undefined);
  });

  it('reserves quota before returning a signed direct-upload URL', async () => {
    const { POST } = await import('./route');
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(checkAndIncrementUsageMock).toHaveBeenCalledWith('user_1', 'mediaUploads', 'ws_1');
    expect(body.uploadSession).toMatchObject({
      uploadUrl: 'https://storage.example/upload',
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': 'image/jpeg' },
    });
    expect(sessionSetMock).toHaveBeenCalledWith(expect.objectContaining({ quotaReserved: true }));
    expect(refundUsageMock).not.toHaveBeenCalled();
  });

  it('does not issue a URL when the monthly media quota is exhausted', async () => {
    checkAndIncrementUsageMock.mockResolvedValue({
      allowed: false,
      current: 100,
      limit: 100,
      reason: 'quota_exceeded',
    });
    const { POST } = await import('./route');
    const response = await POST(request());

    expect(response.status).toBe(402);
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(sessionSetMock).not.toHaveBeenCalled();
  });

  it('refunds the reservation if URL or session creation fails', async () => {
    sessionSetMock.mockRejectedValue(new Error('firestore unavailable'));
    const { POST } = await import('./route');
    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(refundUsageMock).toHaveBeenCalledWith('user_1', 'mediaUploads', 1, 'ws_1');
  });
});
