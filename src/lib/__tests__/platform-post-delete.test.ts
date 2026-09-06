import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const postsGetMock = vi.fn();
const postUpdateMock = vi.fn();
const canonicalUpdateMock = vi.fn();
const docPaths: string[] = [];

vi.mock('@/lib/platform/registry', () => ({ getAdapterForChannel: getAdapterForChannelMock }));
vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  getLinkedInConnectionForDestination: vi.fn(),
}));
vi.mock('@/lib/oauth/token-refresh', () => ({ refreshConnectionToken: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/intelligence/canonical-social-posts', () => ({
  canonicalSocialPostId: (channel: string, key: string, externalId: string) => `${channel}_${key}_${externalId}`,
  socialPostAccountKey: (connection: { accountKey?: string; provider: string }) => connection.accountKey || connection.provider,
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({ where: () => ({ limit: () => ({ get: postsGetMock }) }) }),
    doc: (path: string) => {
      docPaths.push(path);
      return { update: canonicalUpdateMock };
    },
  },
}));

const connection = { provider: 'meta', accountKey: 'page_1', productId: 'prod_1', status: 'connected', metadata: {} };

describe('deletePlatformPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docPaths.length = 0;
    getConnectionForChannelMock.mockResolvedValue(connection);
    postsGetMock.mockResolvedValue({ docs: [{ ref: { update: postUpdateMock } }] });
    canonicalUpdateMock.mockResolvedValue(undefined);
  });

  it('deletes through the account the post belongs to, then reconciles both records', async () => {
    const deletePost = vi.fn().mockResolvedValue({ ok: true });
    getAdapterForChannelMock.mockReturnValue({ deletePost });

    const { deletePlatformPost } = await import('../social/platform-post-delete');
    const result = await deletePlatformPost('ws_1', {
      channel: 'facebook', externalId: 'fb_1', productId: 'prod_1', destinationId: 'page_1', actorUid: 'user_1',
    });

    expect(result.ok).toBe(true);
    expect(getConnectionForChannelMock).toHaveBeenCalledWith('ws_1', 'facebook', 'prod_1', undefined, 'page_1');
    expect(deletePost).toHaveBeenCalledWith(connection, { channel: 'facebook', externalId: 'fb_1', destinationId: 'page_1' });
    expect(postUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ platformDeletedAt: expect.any(String), updatedBy: 'user_1' }));
    expect(docPaths).toEqual(['workspaces/ws_1/socialPosts/facebook_page_1_fb_1']);
    expect(canonicalUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(String), metricsStatus: 'unsupported' }));
  });

  it('reports the platform’s refusal without touching any record', async () => {
    getAdapterForChannelMock.mockReturnValue({
      deletePost: vi.fn().mockResolvedValue({ ok: false, reason: 'not_found', error: 'gone' }),
    });

    const { deletePlatformPost } = await import('../social/platform-post-delete');
    const result = await deletePlatformPost('ws_1', { channel: 'facebook', externalId: 'fb_1' });

    expect(result).toEqual({ ok: false, reason: 'not_found', error: 'gone', restriction: undefined });
    expect(postUpdateMock).not.toHaveBeenCalled();
    expect(canonicalUpdateMock).not.toHaveBeenCalled();
  });

  it('still succeeds when the canonical record is missing or the reconciliation fails', async () => {
    getAdapterForChannelMock.mockReturnValue({ deletePost: vi.fn().mockResolvedValue({ ok: true }) });
    postsGetMock.mockRejectedValue(new Error('firestore down'));
    canonicalUpdateMock.mockRejectedValue(new Error('5 NOT_FOUND: no document to update'));

    const { deletePlatformPost } = await import('../social/platform-post-delete');
    const result = await deletePlatformPost('ws_1', { channel: 'facebook', externalId: 'fb_1' });

    expect(result.ok).toBe(true);
  });

  it('answers unsupported for a channel without a delete, and not_connected without an account', async () => {
    getAdapterForChannelMock.mockReturnValue({});
    const { deletePlatformPost } = await import('../social/platform-post-delete');
    expect(await deletePlatformPost('ws_1', { channel: 'tiktok', externalId: 'tt_1' })).toEqual(expect.objectContaining({ ok: false, reason: 'unsupported' }));

    getAdapterForChannelMock.mockReturnValue({ deletePost: vi.fn() });
    getConnectionForChannelMock.mockResolvedValue(null);
    expect(await deletePlatformPost('ws_1', { channel: 'facebook', externalId: 'fb_1' })).toEqual(expect.objectContaining({ ok: false, reason: 'not_connected' }));
  });
});
