import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/intelligence/tracked-links` had `GET` and `POST` and nothing else.
 * The redirect route already honoured `active === false` and the list already
 * returned `active`, so the feature was designed and then never given an
 * endpoint: once created, a public unauthenticated short link redirected
 * forever, with no way to repoint or retire it.
 *
 * The invariant these tests hold is that every mutation reaches BOTH stored
 * copies of the link. The root `trackedLinks/{code}` is what the redirect
 * reads; `workspaces/{ws}/trackedLinks/{code}` is what the dashboard lists.
 * Writing one and not the other is how a link a customer believes is retired
 * keeps sending people to a dead page.
 */

const batchSet = vi.fn();
const batchCommit = vi.fn(async () => undefined);

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    doc: (path: string) => ({ path }),
    batch: () => ({ set: batchSet, commit: batchCommit, create: vi.fn() }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function load() {
  return import('@/lib/intelligence/conversions');
}

describe('updateTrackedLink', () => {
  it('writes both stored copies in one batch', async () => {
    const { updateTrackedLink } = await load();

    await updateTrackedLink('ws1', 'abc', { destination: 'https://example.com/new' }, 'uid1');

    expect(batchCommit).toHaveBeenCalledOnce();
    const paths = batchSet.mock.calls.map(([ref]) => ref.path);
    expect(paths).toEqual(['trackedLinks/abc', 'workspaces/ws1/trackedLinks/abc']);
  });

  it('stamps the mutation so an edited link is distinguishable from a stale one', async () => {
    const { updateTrackedLink } = await load();

    await updateTrackedLink('ws1', 'abc', { label: 'Spring' }, 'uid1');

    for (const [, payload] of batchSet.mock.calls) {
      expect(payload).toMatchObject({ label: 'Spring', updatedBy: 'uid1' });
      expect(typeof payload.updatedAt).toBe('string');
    }
  });

  it('merges rather than replaces, so counters survive an edit', async () => {
    const { updateTrackedLink } = await load();

    await updateTrackedLink('ws1', 'abc', { label: 'Spring' }, 'uid1');

    for (const [, , options] of batchSet.mock.calls) {
      expect(options).toEqual({ merge: true });
    }
  });
});

describe('retireTrackedLink', () => {
  it('soft deletes, because click and conversion rows reference the code', async () => {
    // The attribution window runs 90 days. A hard delete would strand
    // attribution data that still has months of work left to do.
    const { retireTrackedLink } = await load();

    await retireTrackedLink('ws1', 'abc', 'uid1');

    expect(batchSet).toHaveBeenCalledTimes(2);
    for (const [, payload] of batchSet.mock.calls) {
      expect(payload.active).toBe(false);
      expect(typeof payload.deletedAt).toBe('string');
    }
  });

  it('retires both copies, so the redirect stops serving it too', async () => {
    const { retireTrackedLink } = await load();

    await retireTrackedLink('ws1', 'abc', 'uid1');

    const paths = batchSet.mock.calls.map(([ref]) => ref.path);
    expect(paths).toContain('trackedLinks/abc');
    expect(paths).toContain('workspaces/ws1/trackedLinks/abc');
  });
});

describe('trackedLinkRow', () => {
  it('treats a document with no `active` field as active', async () => {
    // Links created before the field existed must not vanish from the list.
    const { trackedLinkRow } = await import('@/lib/intelligence/tracked-link-rows');
    expect(trackedLinkRow({ code: 'abc' }, 'https://app.example').active).toBe(true);
  });

  it('reports the retirement timestamp so the UI can label a retired link', async () => {
    const { trackedLinkRow } = await import('@/lib/intelligence/tracked-link-rows');
    const row = trackedLinkRow(
      { code: 'abc', active: false, deletedAt: '2026-08-29T00:00:00.000Z' },
      'https://app.example',
    );
    expect(row.active).toBe(false);
    expect(row.deletedAt).toBe('2026-08-29T00:00:00.000Z');
    expect(row.url).toBe('https://app.example/r/abc');
  });
});
