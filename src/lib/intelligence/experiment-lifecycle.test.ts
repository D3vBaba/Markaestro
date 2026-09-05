import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreStub } from '@/test/route-harness';

const db = createFirestoreStub();
const inbox = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: db.adminDb }));
vi.mock('@/lib/inbox', () => ({ createInboxItem: inbox }));
vi.mock('@/lib/workers/due-workspaces', () => ({ markWorkspaceDue: vi.fn() }));

const now = new Date('2026-09-04T12:00:00.000Z');
const path = 'workspaces/ws/experiments/test';
const experiment = {
  name: 'Caption test', status: 'running', platform: 'instagram', metric: 'views',
  armAPostId: 'a', armBPostId: 'b', targetSamplePerArm: 4, createdBy: 'owner',
};

function seed(endsAt: string, measured = true) {
  db.reset({
    [path]: { ...experiment, endsAt },
    'workspaces/ws/posts/a': { metricsByChannel: measured ? { instagram: { views: 1000 } } : {} },
    'workspaces/ws/posts/b': { metricsByChannel: measured ? { instagram: { views: 1 } } : {} },
  });
}

beforeEach(() => { db.reset(); vi.clearAllMocks(); });

describe('scheduled experiment completion', () => {
  it('keeps a large observed gap running until its requested end date', async () => {
    seed('2026-09-10T12:00:00.000Z');
    // Enough observations to trigger the deleted half-sample early-stop path.
    for (const id of ['a', 'b']) for (let i = 0; i < 2; i++) {
      db.set(`workspaces/ws/socialPosts/${id}${i}`, {
        markaestroPostId: id, platform: 'instagram', latestMetrics: { views: id === 'a' ? 1000 + i : 1 + i },
      });
    }
    const { processDueExperiments } = await import('./experiment-lifecycle');
    await processDueExperiments('ws', now);
    expect(db.get(path)?.status).toBe('running');
    expect(db.get(path)?.endsAt).toBe('2026-09-10T12:00:00.000Z');
    expect(db.writes).toEqual([]);
    expect(inbox).not.toHaveBeenCalled();
  });

  it('uses the full requested sample target when the experiment ends', async () => {
    seed(now.toISOString());
    const { closeExperimentIfDue } = await import('./experiment-lifecycle');
    expect(await closeExperimentIfDue('ws', 'test', now)).toEqual({ closed: true, status: 'inconclusive' });
    expect(db.get(path)).toMatchObject({ status: 'complete', result: { status: 'inconclusive', reason: 'ended', armACount: 1, armBCount: 1 } });
    expect(inbox).toHaveBeenCalledOnce();
    expect(await closeExperimentIfDue('ws', 'test', now)).toEqual({ closed: false });
    expect(inbox).toHaveBeenCalledOnce();
  });

  it('finishes without inventing a winner when metrics are missing', async () => {
    seed(now.toISOString(), false);
    const { closeExperimentIfDue } = await import('./experiment-lifecycle');
    expect(await closeExperimentIfDue('ws', 'test', now)).toEqual({ closed: true, status: 'inconclusive' });
    expect(db.get(path)?.result).toMatchObject({ reason: 'missing_metrics', effectPercent: null });
  });
});
