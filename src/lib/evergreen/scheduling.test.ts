import { upcomingRunDates } from './scheduling';
import { describe, expect, it } from 'vitest';
import { deterministicRunId, evergreenGenerationDueAt, nextEvergreenRunAt, zonedDateTimeToUtc } from './scheduling';

describe('evergreen scheduling', () => {
  it('preserves the local wall clock across daylight-saving changes', () => {
    const beforeSpring = new Date('2026-03-07T18:00:00.000Z');
    expect(nextEvergreenRunAt({
      after: beforeSpring,
      intervalDays: 2,
      timeZone: 'America/Los_Angeles',
      localHour: 10,
      localMinute: 30,
    }).toISOString()).toBe('2026-03-09T17:30:00.000Z');

    const beforeFall = new Date('2026-10-31T17:00:00.000Z');
    expect(nextEvergreenRunAt({
      after: beforeFall,
      intervalDays: 2,
      timeZone: 'America/Los_Angeles',
      localHour: 10,
      localMinute: 30,
    }).toISOString()).toBe('2026-11-02T18:30:00.000Z');
  });

  it('creates stable run ids and generation lead times', () => {
    const runAt = zonedDateTimeToUtc({ year: 2026, month: 9, day: 20, hour: 10, minute: 0, second: 0 }, 'UTC');
    expect(deterministicRunId('queue-1', runAt.toISOString())).toBe('queue-1_20260920100000');
    expect(evergreenGenerationDueAt(runAt).toISOString()).toBe('2026-09-18T10:00:00.000Z');
  });
});

describe('upcomingRunDates', () => {
  it('returns the next planned dates one interval apart', () => {
    const dates = upcomingRunDates({ nextRunAt: '2026-09-10T10:00:00.000Z', intervalDays: 30, timeZone: 'UTC', localHour: 10, localMinute: 0 });
    expect(dates).toHaveLength(3);
    expect(dates[0]).toBe('2026-09-10T10:00:00.000Z');
    expect(Date.parse(dates[1]) - Date.parse(dates[0])).toBe(30 * 86_400_000);
  });
  it('is empty without a next run', () => {
    expect(upcomingRunDates({ nextRunAt: null, intervalDays: 30, timeZone: 'UTC', localHour: 10, localMinute: 0 })).toEqual([]);
  });
});
