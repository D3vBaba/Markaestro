import { describe, expect, it, vi } from 'vitest';
import { executeListQueryPage } from '../firestore-list-query';

function document(id: string, createdAt: string) {
  return { id, data: () => ({ createdAt }) };
}

function missingIndexCollection() {
  const docs = [
    document('oldest', '2026-01-01T00:00:00.000Z'),
    document('newest', '2026-03-01T00:00:00.000Z'),
    document('middle', '2026-02-01T00:00:00.000Z'),
  ];
  let calls = 0;
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    startAfter: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn(async () => {
      calls += 1;
      if (calls % 2 === 1) {
        throw Object.assign(new Error('FAILED_PRECONDITION: missing index'), { code: 9 });
      }
      return { docs };
    }),
  };
  return query;
}

describe('Firestore list pagination', () => {
  it('sorts before limiting and preserves order across fallback cursor pages', async () => {
    const collection = missingIndexCollection();
    const first = await executeListQueryPage(
      collection as never,
      { orderByField: 'createdAt', orderByDirection: 'desc', limit: 2 },
    );

    expect(first.items.map((item) => item.id)).toEqual(['newest', 'middle']);
    expect(first.nextCursor).toBeTruthy();

    const second = await executeListQueryPage(
      collection as never,
      {
        orderByField: 'createdAt',
        orderByDirection: 'desc',
        limit: 2,
        cursor: first.nextCursor || undefined,
      },
    );
    expect(second.items.map((item) => item.id)).toEqual(['oldest']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects malformed cursors before issuing a query', async () => {
    const collection = missingIndexCollection();
    await expect(executeListQueryPage(collection as never, { cursor: 'not-a-cursor' }))
      .rejects.toThrow('VALIDATION_INVALID_CURSOR');
    expect(collection.get).not.toHaveBeenCalled();
  });
});
