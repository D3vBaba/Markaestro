import { describe, expect, it } from 'vitest';
import { adaptInterval, cadenceFloorDays, nextVariantState, upcomingRunDates } from './cadence';

describe('adaptInterval', () => {
  it('tightens after a healthy run and loosens after a weak one', () => {
    expect(adaptInterval({ intervalDays: 30, healthy: true, floorDays: 30 })).toBe(30);
    expect(adaptInterval({ intervalDays: 45, healthy: true, floorDays: 30 })).toBe(36);
    expect(adaptInterval({ intervalDays: 30, healthy: false, floorDays: 30 })).toBe(45);
    expect(adaptInterval({ intervalDays: 300, healthy: false, floorDays: 30 })).toBe(365);
  });
  it('uses the X floor only when every channel is X', () => {
    expect(cadenceFloorDays(['x'])).toBe(7);
    expect(cadenceFloorDays(['x', 'threads'])).toBe(30);
    expect(cadenceFloorDays([])).toBe(30);
  });
});

describe('nextVariantState', () => {
  it('retires a caption after two weak runs when another caption remains', () => {
    expect(nextVariantState({ consecutiveUnderperformingRuns: 1, healthy: false, enabledVariants: 3 })).toEqual({ consecutiveUnderperformingRuns: 2, retire: true });
    expect(nextVariantState({ consecutiveUnderperformingRuns: 1, healthy: false, enabledVariants: 1 })).toEqual({ consecutiveUnderperformingRuns: 2, retire: false });
    expect(nextVariantState({ consecutiveUnderperformingRuns: 1, healthy: true, enabledVariants: 3 })).toEqual({ consecutiveUnderperformingRuns: 0, retire: false });
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
