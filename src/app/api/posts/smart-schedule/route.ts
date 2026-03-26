import { requireContext } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const querySchema = z.object({
  channel: z.enum(['facebook', 'instagram', 'tiktok']).optional(),
});

/**
 * Industry best-practice optimal posting windows (UTC).
 * These are baseline recommendations; in a future iteration this would
 * be replaced with per-workspace engagement analytics.
 */
const OPTIMAL_WINDOWS: Record<string, { day: number; hour: number; score: number }[]> = {
  instagram: [
    // Mon-Fri mornings and lunch
    { day: 1, hour: 11, score: 95 }, { day: 1, hour: 14, score: 80 },
    { day: 2, hour: 10, score: 90 }, { day: 2, hour: 13, score: 85 },
    { day: 3, hour: 11, score: 92 }, { day: 3, hour: 17, score: 78 },
    { day: 4, hour: 10, score: 88 }, { day: 4, hour: 14, score: 82 },
    { day: 5, hour: 9, score: 85 },  { day: 5, hour: 13, score: 80 },
    { day: 6, hour: 10, score: 75 }, { day: 0, hour: 11, score: 70 },
  ],
  facebook: [
    { day: 1, hour: 9, score: 90 },  { day: 1, hour: 13, score: 88 },
    { day: 2, hour: 10, score: 92 }, { day: 2, hour: 14, score: 85 },
    { day: 3, hour: 9, score: 95 },  { day: 3, hour: 12, score: 90 },
    { day: 4, hour: 10, score: 88 }, { day: 4, hour: 15, score: 82 },
    { day: 5, hour: 9, score: 80 },  { day: 5, hour: 12, score: 78 },
    { day: 6, hour: 11, score: 72 }, { day: 0, hour: 12, score: 68 },
  ],
  tiktok: [
    { day: 1, hour: 12, score: 88 }, { day: 1, hour: 19, score: 95 },
    { day: 2, hour: 15, score: 92 }, { day: 2, hour: 20, score: 90 },
    { day: 3, hour: 11, score: 85 }, { day: 3, hour: 19, score: 93 },
    { day: 4, hour: 12, score: 90 }, { day: 4, hour: 19, score: 92 },
    { day: 5, hour: 15, score: 88 }, { day: 5, hour: 20, score: 85 },
    { day: 6, hour: 10, score: 80 }, { day: 6, hour: 19, score: 90 },
    { day: 0, hour: 11, score: 78 }, { day: 0, hour: 19, score: 88 },
  ],
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SmartSlot = {
  day: number;
  dayName: string;
  hour: number;
  label: string;
  score: number;
  reason: string;
  suggestedDate: string;
};

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${period}`;
}

function getNextDateForDay(dayOfWeek: number, hour: number): Date {
  const now = new Date();
  const today = now.getUTCDay();
  let daysAhead = dayOfWeek - today;
  if (daysAhead < 0) daysAhead += 7;
  if (daysAhead === 0 && now.getUTCHours() >= hour) daysAhead += 7;
  const result = new Date(now);
  result.setUTCDate(result.getUTCDate() + daysAhead);
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { channel } = querySchema.parse({ channel: url.searchParams.get('channel') || undefined });

    // Get existing scheduled posts to avoid conflicts
    const postsSnap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .where('status', '==', 'scheduled')
      .get();

    const scheduledTimes = new Set<string>();
    for (const doc of postsSnap.docs) {
      const data = doc.data();
      if (data.scheduledAt) {
        const d = new Date(data.scheduledAt);
        scheduledTimes.add(`${d.getUTCDay()}-${d.getUTCHours()}`);
      }
    }

    const channels = channel ? [channel] : ['instagram', 'facebook', 'tiktok'];
    const suggestions: Record<string, SmartSlot[]> = {};

    for (const ch of channels) {
      const windows = OPTIMAL_WINDOWS[ch] || [];
      const slots: SmartSlot[] = windows
        .map((w) => {
          const conflict = scheduledTimes.has(`${w.day}-${w.hour}`);
          const adjustedScore = conflict ? w.score - 15 : w.score;
          const suggestedDate = getNextDateForDay(w.day, w.hour);

          return {
            day: w.day,
            dayName: DAY_NAMES[w.day],
            hour: w.hour,
            label: `${DAY_NAMES[w.day]} at ${formatHour(w.hour)}`,
            score: Math.max(0, adjustedScore),
            reason: conflict
              ? 'Good window but you already have a post scheduled nearby'
              : adjustedScore >= 90
                ? 'Peak engagement window for this channel'
                : adjustedScore >= 80
                  ? 'Strong engagement window'
                  : 'Moderate engagement expected',
            suggestedDate: suggestedDate.toISOString(),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      suggestions[ch] = slots;
    }

    return apiOk({ suggestions });
  } catch (error) {
    return apiError(error);
  }
}
