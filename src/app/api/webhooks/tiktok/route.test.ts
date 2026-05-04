import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findPostByTikTokPublishIdMock = vi.fn();
const pollTikTokPublishForPostMock = vi.fn();

vi.mock('@/lib/social/tiktok-publish-poll-worker', () => ({
  findPostByTikTokPublishId: findPostByTikTokPublishIdMock,
  pollTikTokPublishForPost: pollTikTokPublishForPostMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const SECRET = 'webhook_secret';

function buildBody(publishId: string | null = 'pub_abc') {
  return JSON.stringify({
    client_key: 'ck',
    event: 'post.publish.complete',
    create_time: 1_700_000_000,
    user_openid: 'u_open',
    content: publishId === null ? '' : JSON.stringify({ publish_id: publishId, post_id: 'post_xyz' }),
  });
}

function signedRequest(body: string, opts: { ageSeconds?: number; tamper?: boolean; secret?: string } = {}) {
  const t = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
  const sig = crypto.createHmac('sha256', opts.secret ?? SECRET).update(`${t}.${body}`).digest('hex');
  const header = `t=${t},s=${sig}`;
  return new Request('http://localhost/api/webhooks/tiktok', {
    method: 'POST',
    headers: { 'tiktok-signature': header, 'content-type': 'application/json' },
    body: opts.tamper ? body + ' ' : body,
  });
}

describe('POST /api/webhooks/tiktok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TIKTOK_CLIENT_SECRET = SECRET;
  });

  it('rejects with 401 when the signature does not match', async () => {
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody(), { tamper: true }));
    expect(res.status).toBe(401);
    expect(findPostByTikTokPublishIdMock).not.toHaveBeenCalled();
  });

  it('rejects with 401 when timestamp is outside the replay window', async () => {
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody(), { ageSeconds: 600 }));
    expect(res.status).toBe(401);
    expect(findPostByTikTokPublishIdMock).not.toHaveBeenCalled();
  });

  it('rejects with 401 when secret is missing', async () => {
    delete process.env.TIKTOK_CLIENT_SECRET;
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody()));
    expect(res.status).toBe(401);
  });

  it('returns 200 and ignores events without a publish_id', async () => {
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody(null)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: 'no_publish_id' });
    expect(findPostByTikTokPublishIdMock).not.toHaveBeenCalled();
  });

  it('returns 200 when the publish_id is unknown', async () => {
    findPostByTikTokPublishIdMock.mockResolvedValueOnce(null);
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: 'unknown_publish_id' });
    expect(pollTikTokPublishForPostMock).not.toHaveBeenCalled();
  });

  it('dispatches to pollTikTokPublishForPost for known publish_ids', async () => {
    const fakeRef = Symbol('ref');
    findPostByTikTokPublishIdMock.mockResolvedValueOnce({ workspaceId: 'ws_1', postRef: fakeRef });
    pollTikTokPublishForPostMock.mockResolvedValueOnce({ status: 'published' });

    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: 'published' });
    expect(findPostByTikTokPublishIdMock).toHaveBeenCalledWith('pub_abc');
    expect(pollTikTokPublishForPostMock).toHaveBeenCalledWith('ws_1', fakeRef);
  });

  it('returns 500 so TikTok retries when the handler throws', async () => {
    findPostByTikTokPublishIdMock.mockRejectedValueOnce(new Error('firestore down'));
    const { POST } = await import('./route');
    const res = await POST(signedRequest(buildBody()));
    expect(res.status).toBe(500);
  });
});
