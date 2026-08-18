import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminDocMock = vi.fn();
const getConnectionForChannelMock = vi.fn();
const getAccessTokenMock = vi.fn();
const fetchTikTokPublishStatusMock = vi.fn();
const incrementApiClientStatMock = vi.fn();
const enqueueWebhookEventMock = vi.fn();
const refreshConnectionTokenMock = vi.fn();
const sendTikTokInboxEmailMock = vi.fn();

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

vi.mock('@/lib/tiktok-inbox-emails', () => ({
  sendTikTokInboxEmail: sendTikTokInboxEmailMock,
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

  it('stores TikTok public post ids when publish status completes', async () => {
    const postRef = buildPostRef(buildPendingTikTokPost());
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValueOnce({
      status: 'PUBLISH_COMPLETE',
      publiclyAvailablePostId: 'video_789',
    });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'published' });
    expect(postRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'published',
      externalId: 'video_789',
      tiktokPublishId: 'publish_123',
      tiktokPublicPostId: 'video_789',
      publishResults: [
        {
          channel: 'tiktok',
          success: true,
          pending: false,
          externalId: 'video_789',
        },
      ],
      publishedChannels: ['tiktok'],
    }));
  });

  it('treats a live public post id as published even while status still reports SEND_TO_USER_INBOX', async () => {
    // Confirmed against real accounts: TikTok's status never flips to
    // PUBLISH_COMPLETE for content the creator finishes posting natively
    // from their inbox -- publiclyAvailablePostId showing up is the only
    // reliable "it's live" signal for that flow.
    const postRef = buildPostRef(buildPendingTikTokPost({
      status: 'platform_action_required',
      nextAction: 'open_tiktok_inbox_and_complete_posting',
      actionRequiredAt: '2026-08-01T00:00:00.000Z',
      publishResults: [{ channel: 'tiktok', success: true, pending: false }],
    }));
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValueOnce({
      status: 'SEND_TO_USER_INBOX',
      publiclyAvailablePostId: '7671932290360020237',
    });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'published' });
    expect(postRef.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'published',
      externalId: '7671932290360020237',
      tiktokPublicPostId: '7671932290360020237',
    }));
  });

  it('keeps the original actionRequiredAt when re-polling a still-stuck inbox post', async () => {
    const originalActionRequiredAt = '2026-08-01T00:00:00.000Z';
    const postRef = buildPostRef(buildPendingTikTokPost({
      status: 'platform_action_required',
      nextAction: 'open_tiktok_inbox_and_complete_posting',
      actionRequiredAt: originalActionRequiredAt,
      publishResults: [{ channel: 'tiktok', success: true, pending: false }],
    }));
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValueOnce({ status: 'SEND_TO_USER_INBOX' });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'platform_action_required' });
    const lastUpdate = postRef.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate).not.toHaveProperty('actionRequiredAt');
    expect(lastUpdate).toEqual(expect.objectContaining({
      status: 'platform_action_required',
      nextAction: 'open_tiktok_inbox_and_complete_posting',
    }));
  });

  it('never routes a Direct Post into the inbox hand-off', async () => {
    // A Direct Post publishes to the profile, so it is never waiting on the
    // creator. Reporting it as action-required would send them into the TikTok
    // app looking for a draft that does not exist.
    const postRef = buildPostRef(buildPendingTikTokPost({
      settings: { __type: 'tiktok', postMode: 'direct_post', privacyLevel: 'PUBLIC_TO_EVERYONE' },
    }));
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValue({ status: 'SEND_TO_USER_INBOX' });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'still_processing' });
    expect(sendTikTokInboxEmailMock).not.toHaveBeenCalled();
    expect(postRef.update).toHaveBeenLastCalledWith(expect.not.objectContaining({
      status: 'platform_action_required',
    }));
  });

  it('still hands an inbox-mode post off to the creator', async () => {
    const postRef = buildPostRef(buildPendingTikTokPost());
    adminDocMock.mockReturnValue(postRef);
    fetchTikTokPublishStatusMock.mockResolvedValue({ status: 'SEND_TO_USER_INBOX' });

    const { pollTikTokPublishWithRetries } = await import('../social/tiktok-publish-poll-worker');
    const outcome = await pollTikTokPublishWithRetries('ws_123', 'post_123', {
      attempts: 1,
      intervalMs: 0,
    });

    expect(outcome).toEqual({ status: 'platform_action_required' });
    expect(sendTikTokInboxEmailMock).toHaveBeenCalledTimes(1);
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

describe('TikTok scheduled polling backoff', () => {
  it('does not poll a post before its next scheduled check', async () => {
    const { isTikTokPollDue } = await import('../social/tiktok-publish-poll-worker');
    expect(isTikTokPollDue({ tiktokNextPollAt: '2026-08-18T12:01:00.000Z' }, Date.parse('2026-08-18T12:00:00.000Z'))).toBe(false);
    expect(isTikTokPollDue({ tiktokNextPollAt: '2026-08-18T11:59:00.000Z' }, Date.parse('2026-08-18T12:00:00.000Z'))).toBe(true);
    expect(isTikTokPollDue({}, Date.parse('2026-08-18T12:00:00.000Z'))).toBe(true);
  });

  it('backs inbox hand-offs off much more aggressively than active publishes', async () => {
    const { getTikTokPollDelayMs } = await import('../social/tiktok-publish-poll-worker');
    expect(getTikTokPollDelayMs({ status: 'publishing' }, { status: 'still_processing' })).toBe(60_000);
    expect(getTikTokPollDelayMs(
      { status: 'platform_action_required', tiktokPollAttemptCount: 3 },
      { status: 'platform_action_required' },
    )).toBe(24 * 60 * 60_000);
    expect(getTikTokPollDelayMs(
      {
        status: 'platform_action_required',
        tiktokPollStartedAt: new Date(Date.now() - 11 * 24 * 60 * 60_000).toISOString(),
      },
      { status: 'platform_action_required' },
    )).toBeNull();
    expect(getTikTokPollDelayMs({ status: 'publishing' }, { status: 'published' })).toBeNull();
  });
});
