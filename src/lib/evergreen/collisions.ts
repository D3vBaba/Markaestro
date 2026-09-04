/** Calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayKeyInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * An evergreen repost should not land on a day that already has a fresh post
 * for the same brand and channel. Walk forward one day at a time, at most
 * `maxShifts` days, until the day is free. Returns the original date when it
 * is free or when every candidate is busy.
 */
export function findCollisionFreeDate(input: {
  planned: Date;
  busyDays: Set<string>;
  timeZone: string;
  maxShifts?: number;
}): { date: Date; shiftedDays: number } {
  const max = input.maxShifts ?? 3;
  let candidate = new Date(input.planned);
  for (let shift = 0; shift <= max; shift += 1) {
    if (!input.busyDays.has(dayKeyInZone(candidate, input.timeZone))) {
      return { date: candidate, shiftedDays: shift };
    }
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return { date: new Date(input.planned), shiftedDays: 0 };
}

/**
 * Which of the scheduled posts block a queue: same brand, any shared channel,
 * and not an occurrence of this queue itself.
 */
export function busyDaysFor(input: {
  posts: Array<{ scheduledAt?: unknown; productId?: unknown; channel?: unknown; targetChannels?: unknown; evergreen?: unknown }>;
  productId: string;
  channels: string[];
  queueId: string;
  timeZone: string;
}): Set<string> {
  const busy = new Set<string>();
  for (const post of input.posts) {
    if (post.productId !== input.productId) continue;
    const own = post.evergreen && typeof post.evergreen === 'object' && (post.evergreen as { queueId?: unknown }).queueId === input.queueId;
    if (own) continue;
    const postChannels = Array.isArray(post.targetChannels) && post.targetChannels.length > 0
      ? post.targetChannels
      : [post.channel];
    if (!postChannels.some((channel) => input.channels.includes(String(channel)))) continue;
    if (typeof post.scheduledAt !== 'string') continue;
    const at = new Date(post.scheduledAt);
    if (Number.isNaN(at.getTime())) continue;
    busy.add(dayKeyInZone(at, input.timeZone));
  }
  return busy;
}
