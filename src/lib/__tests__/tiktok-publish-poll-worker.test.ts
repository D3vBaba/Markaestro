import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminDocMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const getAccessTokenMock = vi.fn();
const fetchTikTokPublishStatusMock = vi.fn();
const incrementApiClientStatMock = vi.fn();
const enqueueWebhookEventMock = vi.fn();
const refreshConnectionTokenMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: adminDocMock,
  },
}));

vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
}));

vi.mock('@/lib/platform/base-adapter', () => ({
  getAccessToken: getAccessTokenMock,
}));

vi.mock('@/lib/platform/adapters/tiktok-publishing', () => ({
  fetchTikTokPublishStatus: fetchTikTokPublishStatusMock,
}));

vi.mock('@/lib/oauth/token-refresh', () => ({
  refreshConnectionToken: refreshConnectionTokenMock,
}));

vi.mock('@/lib/public-api/usage', () => ({
  incrementApiClientStat: incrementApiClientStatMock,
}));

vi.mock('@/lib/public-api/webhooks', () => ({
  enqueueWebhookEvent: enqueueWebhookEventMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function buildPostRef(post: Record<string, unknown>) {
  return {
    id: 'post_123',
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => post,
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function buildPendingTikTokPost(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'tiktok',
    status: 'publishing',
    externalId: 'publish_123',
    productId: 'prod_123',
    publishResults: [
      { channel: 'tiktok', success: false, pending: true },
    ],
    errorMessage: 'previous TikTok failure',
    publishStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('pollTikTokPublishWithRetries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getConnectionForChannelMock.mockResolvedValue({ accessTokenEncrypted: 'encrypted' });
    getAccessTokenMock.mockReturnValue('access_token_123');
  });

  it('keeps polling until TikTok confirms the inbox handoff', async () => {
    const postRef = buildPostRef(buildPendingTikTokPost());
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock
      .mockResolvedValueOnce({ status: 'PROCESSING_UPLOAD', uploadedBytes: 1024 })
      .mockResolvedValueOnce({ status: 'SEND_TO_USER_INBOX' });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 4,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'platform_action_required' });
    expect(adminDocMock).toHaveBeenCalledWith('workspaces/ws_123/posts/post_123');
    expect(fetchTikTokPublishStatusMock).toHaveBeenCalledTimes(2);
    expect(postRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'platform_action_required',
      nextAction: 'open_tiktok_inbox_and_complete_posting',
      errorMessage: '',
      publishResults: [
        { channel: 'tiktok', success: true, pending: false },
      ],
      publishedChannels: ['tiktok'],
    }));
  });

  it('returns still_processing after exhausting the retry budget', async () => {
    const postRef = buildPostRef(buildPendingTikTokPost());
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValue({ status: 'PROCESSING_DOWNLOAD', downloadedBytes: 256 });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 3,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'still_processing' });
    expect(fetchTikTokPublishStatusMock).toHaveBeenCalledTimes(3);
    expect(postRef.update).toHaveBeenCalledTimes(3);
    expect(postRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      tiktokLastStatus: 'PROCESSING_DOWNLOAD',
      tiktokDownloadedBytes: 256,
    }));
  });

  it('refreshes the TikTok token and retries when status polling gets access_token_invalid', async () => {
    const postRef = buildPostRef(buildPendingTikTokPost());
    const staleConnection = { accessTokenEncrypted: 'old_encrypted', refreshTokenEncrypted: 'refresh_encrypted' };
    const refreshedConnection = { accessTokenEncrypted: 'new_encrypted', refreshTokenEncrypted: 'refresh_encrypted' };
    adminDocMock.mockReturnValue(postRef);
    getConnectionForChannelMock.mockResolvedValue(staleConnection);
    getAccessTokenMock
      .mockReturnValueOnce('old_access_token')
      .mockReturnValueOnce('new_access_token');
    fetchTikTokPublishStatusMock
      .mockResolvedValueOnce({
        error: 'The access token is invalid or not found in the request. | code=access_token_invalid',
      })
      .mockResolvedValueOnce({ status: 'SEND_TO_USER_INBOX' });
    refreshConnectionTokenMock.mockResolvedValue(refreshedConnection);

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'platform_action_required' });
    expect(refreshConnectionTokenMock).toHaveBeenCalledWith(
      'ws_123',
      'tiktok',
      staleConnection,
      'prod_123',
    );
    expect(fetchTikTokPublishStatusMock).toHaveBeenNthCalledWith(1, 'old_access_token', 'publish_123');
    expect(fetchTikTokPublishStatusMock).toHaveBeenNthCalledWith(2, 'new_access_token', 'publish_123');
  });

  it('resolves webhook publish ids through the durable TikTok mapping', async () => {
    const mappingRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          workspaceId: 'ws_123',
          postId: 'post_123',
        }),
      }),
    };
    const postRef = buildPostRef(buildPendingTikTokPost());
    adminDocMock.mockImplementation((path: string) => (
      path.startsWith('tiktok_publish_mappings/')
        ? mappingRef
        : postRef
    ));

    const { findPostByTikTokPublishId } = await import('../social/tiktok-publish-poll-worker');
    const match = await findPostByTikTokPublishId('publish_123');

    expect(match).toEqual({ workspaceId: 'ws_123', postRef });
    expect(adminDocMock).toHaveBeenCalledWith(expect.stringMatching(/^tiktok_publish_mappings\/[a-f0-9]{64}$/));
    expect(adminDocMock).toHaveBeenCalledWith('workspaces/ws_123/posts/post_123');
  });
});
