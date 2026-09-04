import { nextEvergreenRunAt } from './scheduling';

export const UNDERPERFORMANCE_INDEX = 0.6;
export const MAX_INTERVAL_DAYS = 365;

/**
 * Adaptive cadence: a strong occurrence earns a shorter gap (20% tighter), a
 * weak one a longer gap (50% looser), inside the plan floor and the yearly
 * ceiling. The floor is 30 days for every channel except X, which repeats
 * well at 7. Rounded to whole days so the schedule stays readable.
 */
export function adaptInterval(input: {
  intervalDays: number;
  healthy: boolean;
  floorDays: number;
}): number {
  const raw = input.healthy ? input.intervalDays * 0.8 : input.intervalDays * 1.5;
  return Math.max(input.floorDays, Math.min(MAX_INTERVAL_DAYS, Math.round(raw)));
}

export function cadenceFloorDays(channels: string[]): number {
  return channels.length > 0 && channels.every((channel) => channel === 'x') ? 7 : 30;
}

/**
 * Per-variant retirement. A caption that underperforms twice in a row is
 * switched off, as long as at least one other caption stays enabled;
 * otherwise the queue-level pause (two weak runs) remains the safety net.
 */
export function nextVariantState(input: {
  consecutiveUnderperformingRuns: number;
  healthy: boolean;
  enabledVariants: number;
}): { consecutiveUnderperformingRuns: number; retire: boolean } {
  const consecutive = input.healthy ? 0 : input.consecutiveUnderperformingRuns + 1;
  return {
    consecutiveUnderperformingRuns: consecutive,
    retire: !input.healthy && consecutive >= 2 && input.enabledVariants > 1,
  };
}

/** The next `count` planned dates from `nextRunAt`, for showing a queue's rhythm. */
export function upcomingRunDates(input: {
  nextRunAt: string | null;
  intervalDays: number;
  timeZone: string;
  localHour: number;
  localMinute: number;
  count?: number;
}): string[] {
  if (!input.nextRunAt) return [];
  const dates = [input.nextRunAt];
  let cursor = new Date(input.nextRunAt);
  for (let i = 1; i < (input.count ?? 3); i += 1) {
    cursor = nextEvergreenRunAt({
      after: cursor,
      intervalDays: input.intervalDays,
      timeZone: input.timeZone,
      localHour: input.localHour,
      localMinute: input.localMinute,
    });
    dates.push(cursor.toISOString());
  }
  return dates;
}
