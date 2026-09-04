import { describe, expect, it } from 'vitest';
import { busyDaysFor, dayKeyInZone, findCollisionFreeDate } from './collisions';

describe('findCollisionFreeDate', () => {
  it('keeps a free day and shifts past busy ones', () => {
    const planned = new Date('2026-09-10T10:00:00Z');
    expect(findCollisionFreeDate({ planned, busyDays: new Set(), timeZone: 'UTC' })).toEqual({ date: planned, shiftedDays: 0 });
    const shifted = findCollisionFreeDate({ planned, busyDays: new Set(['2026-09-10', '2026-09-11']), timeZone: 'UTC' });
    expect(shifted.shiftedDays).toBe(2);
    expect(dayKeyInZone(shifted.date, 'UTC')).toBe('2026-09-12');
  });
  it('gives up and keeps the original when every candidate is busy', () => {
    const planned = new Date('2026-09-10T10:00:00Z');
    const busy = new Set(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
    expect(findCollisionFreeDate({ planned, busyDays: busy, timeZone: 'UTC' })).toEqual({ date: planned, shiftedDays: 0 });
  });
});

describe('busyDaysFor', () => {
  it('counts only the same brand and a shared channel, ignoring the queue\'s own occurrences', () => {
    const busy = busyDaysFor({
      posts: [
        { scheduledAt: '2026-09-10T15:00:00Z', productId: 'p1', channel: 'instagram' },
        { scheduledAt: '2026-09-11T15:00:00Z', productId: 'p2', channel: 'instagram' },
        { scheduledAt: '2026-09-12T15:00:00Z', productId: 'p1', channel: 'linkedin' },
        { scheduledAt: '2026-09-13T15:00:00Z', productId: 'p1', channel: 'instagram', evergreen: { queueId: 'q1' } },
      ],
      productId: 'p1',
      channels: ['instagram', 'threads'],
      queueId: 'q1',
      timeZone: 'UTC',
    });
    expect([...busy]).toEqual(['2026-09-10']);
  });
});
