import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreStub } from '@/test/route-harness';
import { createEvergreenQueueSchema, updateEvergreenQueueSchema } from './schemas';

const db = createFirestoreStub();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
vi.mock('@/lib/media/asset-store', () => ({ syncPostMediaReferences: vi.fn() }));
vi.mock('@/lib/workers/due-workspaces', () => ({ markWorkspaceDue: vi.fn() }));
vi.mock('@/lib/stripe/entitlements', () => ({ getEffectiveLimits: vi.fn() }));
vi.mock('@/lib/social/post-preflight', () => ({ getSocialPostPreflightIssues: vi.fn() }));
vi.mock('@/lib/public-api/webhooks', () => ({ enqueueWebhookEvent: vi.fn() }));
vi.mock('@/lib/inbox', () => ({ createInboxItem: vi.fn() }));

const input = { productId: 'brand', sourcePostId: 'source', name: 'My queue', variants: [{ caption: 'Approved caption' }] };
beforeEach(() => db.reset());

describe('Evergreen cadence compatibility', () => {
  it.each([undefined, 'adaptive', 'fixed'])('creates a fixed queue for cadenceMode %s', async (cadenceMode) => {
    db.set('workspaces/ws/posts/source', {
      productId: 'brand', status: 'published', publishedAt: '2026-08-01T10:00:00.000Z',
      channel: 'x', content: 'Original', mediaUrls: [], metricsByChannel: { x: { views: 1000, likes: 20 } },
    });
    const parsed = createEvergreenQueueSchema.parse({ ...input, cadenceMode });
    if (cadenceMode === undefined) expect(parsed.cadenceMode).toBe('fixed');
    const { createEvergreenQueue } = await import('./storage');
    const queue = await createEvergreenQueue('ws', 'owner', parsed);
    expect(queue).toMatchObject({ cadenceMode: 'fixed', intervalDays: 30, status: 'draft' });
    expect(db.get(`workspaces/ws/evergreenQueues/${queue.id}`)?.cadenceMode).toBe('fixed');
  });

  it('accepts legacy update inputs', () => {
    expect(updateEvergreenQueueSchema.parse({ version: 2, cadenceMode: 'adaptive' })).toMatchObject({ version: 2 });
  });

  it('reads a legacy queue without resuming it or re-enabling a disabled caption', async () => {
    db.set('workspaces/ws/evergreenQueues/old', { cadenceMode: 'adaptive', intervalDays: 45, status: 'paused', pauseReason: 'PERFORMANCE_DECAY' });
    db.set('workspaces/ws/evergreenQueues/old/variants/v', { caption: 'Old caption', enabled: false, retiredReason: 'UNDERPERFORMED' });
    const { getEvergreenQueue } = await import('./storage');
    expect(await getEvergreenQueue('ws', 'old')).toMatchObject({
      cadenceMode: 'fixed', intervalDays: 45, status: 'paused', pauseReason: 'PERFORMANCE_DECAY',
      variants: [expect.objectContaining({ enabled: false, retiredReason: 'UNDERPERFORMED' })],
    });
    expect(db.writes).toEqual([]);
  });
});

describe('Evergreen review actions', () => {
  const runPath = 'workspaces/ws/evergreenQueues/q/runs/r';
  const postPath = 'workspaces/ws/posts/occurrence';
  function seedReview(status: string) {
    db.reset({
      'workspaces/ws/evergreenQueues/q': { productId: 'brand', name: 'My queue', status: 'active', intervalDays: 30 },
      [runPath]: { status: 'needs_review', occurrencePostId: 'occurrence', plannedAt: '2099-01-01T10:00:00.000Z' },
      [postPath]: { status, content: 'Approved caption', channel: 'x', targetChannels: ['x'], mediaUrls: [] },
    });
  }

  it('approves a draft at its planned time without changing the queue interval', async () => {
    seedReview('draft');
    const { approveEvergreenRun } = await import('./storage');
    await approveEvergreenRun('ws', 'q', 'r', 'owner');
    expect(db.get(postPath)).toMatchObject({ status: 'scheduled', scheduledAt: '2099-01-01T10:00:00.000Z' });
    expect(db.get(runPath)?.status).toBe('scheduled');
    expect(db.get('workspaces/ws/evergreenQueues/q')?.intervalDays).toBe(30);
  });

  it('skips a draft and preserves the run history', async () => {
    seedReview('draft');
    const { skipEvergreenRun } = await import('./storage');
    await skipEvergreenRun('ws', 'q', 'r', 'owner');
    expect(db.has(postPath)).toBe(false);
    expect(db.get(runPath)).toMatchObject({ status: 'skipped', reason: 'SKIPPED_IN_REVIEW' });
  });

  it.each(['scheduled', 'publishing', 'published'])('does not offer or mutate a %s post left in an old review run', async (status) => {
    seedReview(status);
    const { listEvergreenReviews, approveEvergreenRun, skipEvergreenRun } = await import('./storage');
    expect(await listEvergreenReviews('ws', 'brand')).toEqual([]);
    await expect(approveEvergreenRun('ws', 'q', 'r', 'owner')).rejects.toThrow('VALIDATION_EVERGREEN_RUN_NOT_REVIEWABLE');
    await expect(skipEvergreenRun('ws', 'q', 'r', 'owner')).rejects.toThrow('VALIDATION_EVERGREEN_RUN_NOT_REVIEWABLE');
    expect(db.writes).toEqual([]);
  });
});
