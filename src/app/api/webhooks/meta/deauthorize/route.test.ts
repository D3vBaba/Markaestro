import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteConnectionsForMetaUserMock = vi.fn();

vi.mock('@/lib/social/meta-deletion', () => ({
  deleteConnectionsForMetaUser: deleteConnectionsForMetaUserMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const META_SECRET = 'meta_secret';

function sign(payload: object, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

function request(body: string) {
  return new Request('http://localhost/api/webhooks/meta/deauthorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('POST /api/webhooks/meta/deauthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.META_APP_SECRET = META_SECRET;
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.THREADS_APP_SECRET;
  });

  it('rejects a forged signature with 400 and does not delete', async () => {
    const { POST } = await import('./route');
    const valid = sign({ user_id: 'u_1', algorithm: 'HMAC-SHA256' }, 'wrong_secret');
    const res = await POST(request(`signed_request=${encodeURIComponent(valid)}`));
    expect(res.status).toBe(400);
    expect(deleteConnectionsForMetaUserMock).not.toHaveBeenCalled();
  });

  it('returns 500 when no app secret is configured', async () => {
    delete process.env.META_APP_SECRET;
    const { POST } = await import('./route');
    const valid = sign({ user_id: 'u_1', algorithm: 'HMAC-SHA256' }, META_SECRET);
    const res = await POST(request(`signed_request=${encodeURIComponent(valid)}`));
    expect(res.status).toBe(500);
  });

  it('deletes connections for the deauthorized user and returns 200', async () => {
    deleteConnectionsForMetaUserMock.mockResolvedValueOnce({ deleted: 2, paths: ['a', 'b'] });
    const { POST } = await import('./route');
    const token = sign({ user_id: 'u_42', algorithm: 'HMAC-SHA256' }, META_SECRET);
    const res = await POST(request(`signed_request=${encodeURIComponent(token)}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, provider: 'meta', deleted: 2 });
    expect(deleteConnectionsForMetaUserMock).toHaveBeenCalledWith('meta', 'u_42');
  });

  it('returns 500 so Meta retries when deletion throws', async () => {
    deleteConnectionsForMetaUserMock.mockRejectedValueOnce(new Error('firestore down'));
    const { POST } = await import('./route');
    const token = sign({ user_id: 'u_42', algorithm: 'HMAC-SHA256' }, META_SECRET);
    const res = await POST(request(`signed_request=${encodeURIComponent(token)}`));
    expect(res.status).toBe(500);
  });
});
