const DAY_MS = 24 * 60 * 60 * 1000;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Convert a wall-clock time to UTC, including DST transitions. */
export function zonedDateTimeToUtc(parts: LocalParts, timeZone: string): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = localParts(new Date(guess), timeZone);
    const wantedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const delta = wantedAsUtc - seenAsUtc;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

export function nextEvergreenRunAt(input: {
  after: Date;
  intervalDays: number;
  timeZone: string;
  localHour: number;
  localMinute: number;
}): Date {
  const current = localParts(input.after, input.timeZone);
  const localNoon = Date.UTC(current.year, current.month - 1, current.day, 12, 0, 0);
  const targetDate = new Date(localNoon + input.intervalDays * DAY_MS);
  return zonedDateTimeToUtc({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: input.localHour,
    minute: input.localMinute,
    second: 0,
  }, input.timeZone);
}

export function evergreenGenerationDueAt(runAt: Date, leadHours = 48): Date {
  return new Date(runAt.getTime() - leadHours * 60 * 60 * 1000);
}

export function deterministicRunId(queueId: string, plannedAt: string): string {
  const compact = plannedAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${queueId}_${compact}`;
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
