import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, createFirestoreStub, mockContext } from '@/test/route-harness';

/**
 * `PUT /api/posts/[id]` decided whether to blank a post's platform link from
 * the shape of the patch alone, never from the post's current status. Editing
 * a typo on a post already live on Instagram therefore wiped `externalId`.
 *
 * The metrics poller keys on `externalId`, so that post silently stopped
 * collecting metrics forever, disappeared from analytics and the leaderboard,
 * and lost its "view on platform" link. Nothing on the platform changed and
 * nothing told the user.
 *
 * `DELETE` had the matching problem from the other direction: it never checked
 * whether the publisher was holding the post, so a delete mid-flight could
 * leave a live post with no record of itself.
 */

const db = createFirestoreStub();
const requireContextMock = vi.fn();
const preflightMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
vi.mock('@/lib/server-auth', () => ({ requireContext: () => requireContextMock() }));
vi.mock('@/lib/social/post-preflight', () => ({
  getSocialPostPreflightIssues: () => preflightMock(),
}));
vi.mock('@/lib/media/asset-store', () => ({
  syncPostMediaReferences: async () => undefined,
  releasePostMedia: async () => undefined,
}));
vi.mock('@/lib/workers/due-workspaces', () => ({ markWorkspaceDue: async () => undefined }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

const POST_PATH = 'workspaces/ws_1/posts/post_1';

function seedPost(overrides: Record<string, unknown> = {}) {
  db.reset({
    [POST_PATH]: {
      content: 'Original caption',
      channel: 'instagram',
      status: 'published',
      mediaUrls: ['https://example.com/a.jpg'],
      externalId: 'ig_12345',
      externalUrl: 'https://instagram.com/p/12345',
      publishResults: [{ channel: 'instagram', success: true }],
      publishedChannels: ['instagram'],
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireContextMock.mockResolvedValue(mockContext());
  preflightMock.mockResolvedValue([]);
  seedPost();
});

async function put(body: unknown) {
  const { PUT } = await import('./route');
  return callRoute(PUT, { method: 'PUT', body, params: { id: 'post_1' } });
}

async function del() {
  const { DELETE } = await import('./route');
  return callRoute(DELETE, { method: 'DELETE', params: { id: 'post_1' } });
}

describe('PUT /api/posts/[id] publish-state guard', () => {
  it('keeps a published post attached to the platform when its content is edited', async () => {
    const res = await put({ content: 'Fixed a typo' });

    expect(res.status).toBe(200);
    const stored = db.get(POST_PATH)!;
    // The whole point: the metrics poller keys on this.
    expect(stored.externalId).toBe('ig_12345');
    expect(stored.externalUrl).toBe('https://instagram.com/p/12345');
    expect(stored.publishResults).toEqual([{ channel: 'instagram', success: true }]);
  });

  it('records that a published post diverged from what is live', async () => {
    // Editing is allowed, because users legitimately fix a draft-of-record
    // after the fact, but the stored content no longer matches the platform
    // and the UI needs to be able to say so.
    await put({ content: 'Fixed a typo' });
    expect(typeof db.get(POST_PATH)!.contentDivergedAt).toBe('string');
  });

  it('does not mark divergence when nothing about the content changed', async () => {
    await put({ status: 'published' });
    expect(db.get(POST_PATH)!.contentDivergedAt).toBeUndefined();
  });

  it('clears publish state for a draft, where there is nothing live to detach from', async () => {
    seedPost({ status: 'draft', externalId: 'stale_id', externalUrl: 'https://stale' });

    await put({ content: 'New draft body' });

    const stored = db.get(POST_PATH)!;
    expect(stored.externalId).toBe('');
    expect(stored.externalUrl).toBe('');
    expect(stored.publishResults).toEqual([]);
  });

  it.each(['scheduled', 'failed', 'partial_failed'])(
    'clears publish state for a %s post',
    async (status) => {
      seedPost({ status, externalId: 'stale_id' });
      await put({ content: 'Rewritten' });
      expect(db.get(POST_PATH)!.externalId).toBe('');
    },
  );

  it('leaves a post that is mid-publish alone', async () => {
    seedPost({
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await put({ content: 'Sneaking an edit in' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_POST_IS_PUBLISHING');
    expect(db.get(POST_PATH)!.content).toBe('Original caption');
  });

  it('allows an edit once the publish lease has expired', async () => {
    // A post stuck in `publishing` because an instance died must not become
    // permanently uneditable, or the guard is its own trap.
    seedPost({
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await put({ content: 'Recovering a stuck post' });

    expect(res.status).toBe(200);
    expect(db.get(POST_PATH)!.content).toBe('Recovering a stuck post');
  });

  it('refuses to schedule for an unverified email', async () => {
    requireContextMock.mockResolvedValue(mockContext({ emailVerified: false }));
    const res = await put({ status: 'scheduled', scheduledAt: '2026-09-01T10:00:00.000Z' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('surfaces preflight issues instead of scheduling a post that cannot publish', async () => {
    preflightMock.mockResolvedValue([
      { channel: 'instagram', code: 'VALIDATION_INSTAGRAM_NOT_READY', message: 'Instagram is not ready: token expired' },
    ]);

    const res = await put({ status: 'scheduled', scheduledAt: '2026-09-01T10:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.issues)).toContain('token expired');
  });

  it('404s a post that does not exist', async () => {
    db.reset({});
    expect((await put({ content: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/posts/[id]', () => {
  it('deletes a post that is not being published', async () => {
    seedPost({ status: 'draft' });
    const res = await del();
    expect(res.status).toBe(200);
    expect(db.has(POST_PATH)).toBe(false);
  });

  it('refuses to delete a post the publisher is holding', async () => {
    // Deleting mid-flight leaves a live post with no record: the run keeps
    // going and can publish after the document is gone.
    seedPost({
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await del();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_POST_IS_PUBLISHING');
    expect(db.has(POST_PATH)).toBe(true);
  });

  it('deletes a post whose publish lease has expired', async () => {
    seedPost({
      status: 'publishing',
      publishLeaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect((await del()).status).toBe(200);
    expect(db.has(POST_PATH)).toBe(false);
  });

  it('404s a post that does not exist', async () => {
    db.reset({});
    expect((await del()).status).toBe(404);
  });
});
