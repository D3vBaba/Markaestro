import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The post document holds `errorMessage`, `lastErrorCode`, and
 * `lastErrorCategory`, and every attempt overwrites them. Attempts 1 through 3
 * of a post that succeeded on the fourth were unrecoverable, so "why did this
 * take four tries" and "did this ever succeed on Instagram" had no answer.
 */

const batchSetMock = vi.fn();
const batchCommitMock = vi.fn(async () => undefined);
const collectionMock = vi.fn();
const warnMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: collectionMock,
    batch: () => ({ set: batchSetMock, commit: batchCommitMock }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { fromMillis: (ms: number) => ({ __ms: ms }) },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: warnMock, error: vi.fn(), critical: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  collectionMock.mockReturnValue({ doc: (id: string) => ({ id }) });
  batchCommitMock.mockResolvedValue(undefined);
});

const attempt = {
  attemptId: 'att_1',
  attemptNumber: 2,
  channel: 'instagram',
  outcome: 'failed' as const,
  startedAt: '2026-08-29T10:00:00.000Z',
  finishedAt: '2026-08-29T10:00:04.000Z',
  errorCode: 'PLATFORM_REJECTED',
  errorCategory: 'platform',
  rawError: 'OAuthException: (#100) media is not ready',
};

describe('recordPublishAttempt', () => {
  it('writes one row per channel under the post', async () => {
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', [
      attempt,
      { ...attempt, channel: 'facebook', outcome: 'published', externalId: 'fb_1' },
    ]);

    expect(collectionMock).toHaveBeenCalledWith('workspaces/ws1/posts/post1/publishAttempts');
    expect(batchSetMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledOnce();
  });

  it('keys each row by attempt AND channel so a fan-out keeps every result', async () => {
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', [
      attempt,
      { ...attempt, channel: 'facebook' },
    ]);

    // Keyed on attemptId alone, the second write would overwrite the first and
    // a multi-channel post would keep only its last channel's outcome.
    const ids = batchSetMock.mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('att_1_instagram');
    expect(ids).toContain('att_1_facebook');
  });

  it('records the outcome, attempt number, and platform error per channel', async () => {
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', [attempt]);

    expect(batchSetMock.mock.calls[0][1]).toMatchObject({
      workspaceId: 'ws1',
      postId: 'post1',
      attemptNumber: 2,
      channel: 'instagram',
      outcome: 'failed',
      errorCode: 'PLATFORM_REJECTED',
      errorCategory: 'platform',
      rawError: 'OAuthException: (#100) media is not ready',
    });
  });

  it('truncates the platform error so the trail is not a copy of their response log', async () => {
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', [{ ...attempt, rawError: 'x'.repeat(5000) }]);

    const written = batchSetMock.mock.calls[0][1] as { rawError: string };
    expect(written.rawError.length).toBeLessThanOrEqual(501);
  });

  it('sets a TTL so the trail expires on its own', async () => {
    const { recordPublishAttempt, PUBLISH_ATTEMPT_RETENTION_MS } =
      await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', [attempt]);

    const written = batchSetMock.mock.calls[0][1] as { expiresAt: { __ms: number } };
    expect(written.expiresAt.__ms).toBeGreaterThan(Date.now());
    expect(written.expiresAt.__ms).toBeLessThanOrEqual(Date.now() + PUBLISH_ATTEMPT_RETENTION_MS);
  });

  it('does nothing at all for an empty attempt list', async () => {
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await recordPublishAttempt('ws1', 'post1', []);
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  it('never throws: losing an audit row must not fail a successful publish', async () => {
    batchCommitMock.mockRejectedValueOnce(new Error('firestore unavailable'));
    const { recordPublishAttempt } = await import('@/lib/social/publish-attempts');

    await expect(recordPublishAttempt('ws1', 'post1', [attempt])).resolves.toBeUndefined();
    // The gap is logged rather than silent.
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('publish attempt trail'),
      expect.objectContaining({ event: 'publish.attempt_trail_failed' }),
    );
  });
});

describe('truncateRawError', () => {
  it('returns null for anything that is not usable text', async () => {
    const { truncateRawError } = await import('@/lib/social/publish-attempts');
    expect(truncateRawError(undefined)).toBeNull();
    expect(truncateRawError('   ')).toBeNull();
    expect(truncateRawError(42)).toBeNull();
  });
});
