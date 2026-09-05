import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreStub } from '@/test/route-harness';
import { deterministicRunId } from './scheduling';

const db = createFirestoreStub();
const markDue = vi.fn();
const pause = vi.fn();
const preflight = vi.fn();
const inbox = vi.fn();
const webhook = vi.fn();
const syncMedia = vi.fn();
type Ref = { path: string; get: () => Promise<unknown> };
type Transaction = ReturnType<typeof db.adminDb.batch> & { get: (ref: Ref) => Promise<unknown> };
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    ...db.adminDb,
    runTransaction: async (run: (tx: Transaction) => Promise<void>) => {
      const batch = db.adminDb.batch();
      await run({ ...batch, get: (ref: Ref) => ref.get() });
      await batch.commit();
    },
  },
}));
vi.mock('@/lib/workers/due-workspaces', () => ({ markWorkspaceDue: markDue }));
vi.mock('@/lib/evergreen/storage', () => ({ pauseEvergreenQueueForSystem: pause }));
vi.mock('@/lib/social/post-preflight', () => ({ getSocialPostPreflightIssues: preflight }));
vi.mock('@/lib/inbox', () => ({ createInboxItem: inbox }));
vi.mock('@/lib/public-api/webhooks', () => ({ enqueueWebhookEvent: webhook }));
vi.mock('@/lib/media/asset-store', () => ({ syncPostMediaReferences: syncMedia }));

const queuePath = 'workspaces/ws/evergreenQueues/q';
const plannedAt = '2026-09-05T10:00:00.000Z';
const runId = deterministicRunId('q', plannedAt);
const queue = {
  productId: 'brand', sourcePostId: 'source', channels: ['x'], status: 'active',
  nextRunAt: plannedAt, intervalDays: 30, cadenceMode: 'adaptive', runCount: 0,
  timeZone: 'UTC', localHour: 10, localMinute: 0, version: 1, createdBy: 'owner',
  reviewPolicy: 'approve_future_runs',
  contentReview: { confirmedBy: 'owner', confirmedAt: '2026-09-04T10:00:00Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
  preflight.mockResolvedValue([]);
  db.reset({
    [queuePath]: queue,
    [`${queuePath}/variants/caption`]: { caption: 'An approved caption', enabled: true, position: 0 },
    'workspaces/ws/posts/source': { status: 'published', content: 'Original', mediaUrls: [], metricsByChannel: { x: { views: 100000 } } },
  });
});
afterEach(() => vi.useRealTimers());

describe('Evergreen fixed scheduling', () => {
  it('keeps an existing adaptive queue on its configured interval without evaluation work', async () => {
    const { processDueEvergreenQueues } = await import('./worker');
    expect(await processDueEvergreenQueues('ws')).toEqual([expect.objectContaining({ status: 'generated' })]);
    expect(db.get(queuePath)).toMatchObject({ intervalDays: 30, nextRunAt: '2026-10-05T10:00:00.000Z' });
    expect(db.get(`${queuePath}/runs/${runId}`)).toMatchObject({ status: 'scheduled', evaluationDueAt: null, performanceIndex: null });
    expect(markDue.mock.calls.map((call) => call[2])).toEqual(['scheduled_post', 'evergreen_queue']);
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses legacy queues until their content is reviewed', async () => {
    db.set(queuePath, { ...queue, contentReview: null });
    const { processDueEvergreenQueues } = await import('./worker');
    await processDueEvergreenQueues('ws');
    expect(pause).toHaveBeenCalledWith('ws', 'q', 'EVERGREEN_CONTENT_REVIEW_REQUIRED');
    expect(db.writes).toEqual([]);
  });

  it('uses manual reminders for X, including existing direct-publish queues', async () => {
    db.set(queuePath, { ...queue, sourceSnapshot: { channelDeliveryModes: { x: 'direct_publish' } } });
    const { processDueEvergreenQueues } = await import('./worker');
    await processDueEvergreenQueues('ws');
    expect(db.get(`workspaces/ws/posts/evergreen_${runId}`)).toMatchObject({ channelDeliveryModes: { x: 'manual_reminder' } });
    expect(preflight.mock.calls[0][3]).toMatchObject({ manualChannels: ['x'] });
  });

  it('does not create another occurrence for an existing deterministic run', async () => {
    db.set(`${queuePath}/runs/${runId}`, { status: 'scheduled' });
    const { processDueEvergreenQueues } = await import('./worker');
    expect(await processDueEvergreenQueues('ws')).toEqual([expect.objectContaining({ status: 'duplicate' })]);
    expect(db.writes).toEqual([]);
    expect(webhook).not.toHaveBeenCalled();
  });

  it('keeps review-required occurrences as drafts', async () => {
    db.set(queuePath, { ...queue, reviewPolicy: 'review_each_run' });
    const { processDueEvergreenQueues } = await import('./worker');
    await processDueEvergreenQueues('ws');
    expect(db.get(`workspaces/ws/posts/evergreen_${runId}`)).toMatchObject({ status: 'draft', scheduledAt: null });
    expect(db.get(`${queuePath}/runs/${runId}`)?.status).toBe('needs_review');
    expect(markDue.mock.calls.map((call) => call[2])).toEqual(['evergreen_queue']);
    expect(inbox).toHaveBeenCalledOnce();
  });

  it('still pauses for unavailable publishing destinations', async () => {
    preflight.mockResolvedValue([{ code: 'CHANNEL_DISCONNECTED' }]);
    const { processDueEvergreenQueues } = await import('./worker');
    await processDueEvergreenQueues('ws');
    expect(pause).toHaveBeenCalledWith('ws', 'q', 'CHANNEL_DISCONNECTED');
    expect(db.writes).toEqual([]);
  });

  it('still moves an occurrence away from a fresh post on the same day', async () => {
    db.set('workspaces/ws/posts/fresh', { status: 'scheduled', scheduledAt: plannedAt, productId: 'brand', channel: 'x' });
    const { processDueEvergreenQueues } = await import('./worker');
    expect(await processDueEvergreenQueues('ws')).toEqual([expect.objectContaining({ reason: 'COLLISION_SHIFTED' })]);
    expect(db.get(queuePath)?.intervalDays).toBe(30);
    expect(db.has(`workspaces/ws/posts/evergreen_${runId}`)).toBe(false);
  });
});
