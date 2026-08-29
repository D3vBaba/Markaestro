import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Nothing told a user their Instagram token had died until they tried to
 * publish. For a scheduled post that means finding out after the publish
 * window has passed, which is the failure this warning exists to prevent.
 */

const sendResendEmailMock = vi.fn(async () => undefined);
const getUnavailableSocialChannelsMock = vi.fn();
const collectionMock = vi.fn();
const docMock = vi.fn();
const runTransactionMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: collectionMock, doc: docMock, runTransaction: runTransactionMock },
}));

vi.mock('@/lib/resend', () => ({ sendResendEmail: sendResendEmailMock }));

vi.mock('@/lib/social/channel-status', () => ({
  getUnavailableSocialChannels: getUnavailableSocialChannelsMock,
}));

vi.mock('@/lib/auth-emails', () => ({
  BRAND: { panelBg: '#fff', border: '#eee', ink: '#111', accent: '#000' },
  brandWrap: ({ bodyHtml }: { bodyHtml: string }) => bodyHtml,
  escapeHtml: (value: string) => value,
  getBaseUrl: () => 'https://app.example.com',
  getEmailTranslator: async () => (key: string) => key,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** Notice docs, keyed by path, so the cooldown can be observed across calls. */
const notices = new Map<string, { lastSentAt?: string }>();

function scheduledPostDocs(posts: Array<Record<string, unknown>>) {
  return {
    where: () => ({
      orderBy: () => ({
        limit: () => ({ get: async () => ({ docs: posts.map((data) => ({ data: () => data })) }) }),
      }),
    }),
    // The members query used for recipients.
    limit: () => ({ get: async () => ({ docs: [] }) }),
  };
}

function wireCollections(posts: Array<Record<string, unknown>>, members: Array<Record<string, unknown>>) {
  collectionMock.mockImplementation((path: string) => {
    if (path.endsWith('/posts')) return scheduledPostDocs(posts);
    if (path.endsWith('/members')) {
      return {
        where: () => ({
          limit: () => ({ get: async () => ({ docs: members.map((data) => ({ data: () => data })) }) }),
        }),
      };
    }
    throw new Error(`unexpected collection ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notices.clear();
  docMock.mockImplementation((path: string) => ({ path }));
  runTransactionMock.mockImplementation(async (callback: (tx: {
    get: (ref: { path: string }) => Promise<{ data: () => { lastSentAt?: string } | undefined }>;
    set: (ref: { path: string }, value: { lastSentAt: string }, options?: unknown) => void;
  }) => unknown) => callback({
    get: async (ref) => ({ data: () => notices.get(ref.path) }),
    set: (ref, value) => { notices.set(ref.path, { ...notices.get(ref.path), ...value }); },
  }));
});

const upcomingPost = {
  status: 'scheduled',
  scheduledAt: '2026-08-29T18:00:00.000Z',
  productId: 'brand1',
  channel: 'instagram',
  targetChannels: ['instagram'],
};

describe('notifyUnreadyChannelsForUpcomingPosts', () => {
  it('emails when an upcoming post targets a channel that cannot publish', async () => {
    wireCollections([upcomingPost], [{ email: 'owner@example.com', role: 'owner' }]);
    getUnavailableSocialChannelsMock.mockResolvedValue([
      { channel: 'instagram', reason: 'Instagram is not ready: token expired.' },
    ]);
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    const result = await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);

    expect(result).toEqual({ atRisk: 1, notified: 1 });
    expect(sendResendEmailMock).toHaveBeenCalledOnce();
  });

  it('stays quiet when every targeted channel is ready', async () => {
    wireCollections([upcomingPost], [{ email: 'owner@example.com', role: 'owner' }]);
    getUnavailableSocialChannelsMock.mockResolvedValue([]);
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    const result = await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);

    expect(result).toEqual({ atRisk: 0, notified: 0 });
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it('ignores posts scheduled beyond the 24 hour window', async () => {
    wireCollections(
      [{ ...upcomingPost, scheduledAt: '2026-09-05T18:00:00.000Z' }],
      [{ email: 'owner@example.com', role: 'owner' }],
    );
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    const result = await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);

    // A channel nobody is about to publish to is a dashboard banner, not an
    // email; the readiness lookup should not even run.
    expect(getUnavailableSocialChannelsMock).not.toHaveBeenCalled();
    expect(result.notified).toBe(0);
  });

  it('sends one warning per channel per cooldown window, not one per tick', async () => {
    wireCollections([upcomingPost], [{ email: 'owner@example.com', role: 'owner' }]);
    getUnavailableSocialChannelsMock.mockResolvedValue([
      { channel: 'instagram', reason: 'Instagram is not ready: token expired.' },
    ]);
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);
    // The tick runs constantly and the token stays broken until someone
    // reconnects it. Without the cooldown this is an email every minute.
    const secondResult = await notifyUnreadyChannelsForUpcomingPosts(
      'ws1',
      new Date(NOW.getTime() + 60 * 60_000),
    );

    expect(secondResult.notified).toBe(0);
    expect(sendResendEmailMock).toHaveBeenCalledOnce();
  });

  it('warns again once the cooldown has elapsed', async () => {
    wireCollections([upcomingPost], [{ email: 'owner@example.com', role: 'owner' }]);
    getUnavailableSocialChannelsMock.mockResolvedValue([
      { channel: 'instagram', reason: 'Instagram is not ready: token expired.' },
    ]);
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);
    const later = await notifyUnreadyChannelsForUpcomingPosts(
      'ws1',
      new Date(NOW.getTime() + 73 * 60 * 60_000),
    );

    expect(later.notified).toBe(1);
    expect(sendResendEmailMock).toHaveBeenCalledTimes(2);
  });

  it('still reports risk when there is nobody to email', async () => {
    wireCollections([upcomingPost], []);
    getUnavailableSocialChannelsMock.mockResolvedValue([
      { channel: 'instagram', reason: 'Instagram is not ready: token expired.' },
    ]);
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    const result = await notifyUnreadyChannelsForUpcomingPosts('ws1', NOW);

    expect(result.atRisk).toBe(1);
    expect(result.notified).toBe(0);
    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it('never throws: a failed warning must not fail the tick that found it', async () => {
    collectionMock.mockImplementation(() => { throw new Error('firestore unavailable'); });
    const { notifyUnreadyChannelsForUpcomingPosts } = await import('@/lib/channel-health-emails');

    await expect(notifyUnreadyChannelsForUpcomingPosts('ws1', NOW))
      .resolves.toEqual({ atRisk: 0, notified: 0 });
  });
});
