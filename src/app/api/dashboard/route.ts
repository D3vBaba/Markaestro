import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk } from '@/lib/api-response';
import { socialChannels } from '@/lib/schemas';

export const runtime = 'nodejs';


type RecentPost = {
  id: string;
  channel?: string;
  status?: string;
  content?: string;
  publishedAt?: string;
  scheduledAt?: string;
  createdAt?: string;
};

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'dashboard.read');
    const ws = ctx.workspaceId;
    const productsRef = adminDb.collection(`workspaces/${ws}/products`);
    const postsRef = adminDb.collection(`workspaces/${ws}/posts`);
    const count = async (query: FirebaseFirestore.Query) => (
      await query.count().get()
    ).data().count;

    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayWindows: Array<{ date: string; label: string; start: string; end: string }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const start = `${dateStr}T00:00:00.000Z`;
      dayWindows.push({
        date: dateStr,
        label: dayNames[d.getDay()],
        start,
        end: new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    const [
      totalProducts,
      activeProducts,
      totalPosts,
      publishedPosts,
      scheduledPosts,
      channelCounts,
      dayCounts,
      recentPublishedSnap,
      recentScheduledSnap,
    ] = await Promise.all([
      count(productsRef),
      count(productsRef.where('status', '==', 'active')),
      count(postsRef),
      count(postsRef.where('status', '==', 'published')),
      count(postsRef.where('status', '==', 'scheduled')),
      Promise.all(socialChannels.map((channel) => count(postsRef.where('channel', '==', channel)))),
      Promise.all(dayWindows.map(async ({ start, end }) => Promise.all([
        count(postsRef.where('status', '==', 'published').where('publishedAt', '>=', start).where('publishedAt', '<', end)),
        count(postsRef.where('status', '==', 'scheduled').where('scheduledAt', '>=', start).where('scheduledAt', '<', end)),
      ]))),
      postsRef.where('status', '==', 'published').orderBy('publishedAt', 'desc').limit(5).get(),
      postsRef.where('status', '==', 'scheduled').where('scheduledAt', '>=', now.toISOString()).orderBy('scheduledAt', 'asc').limit(5).get(),
    ]);

    const postsByChannel = Object.fromEntries(
      socialChannels.map((channel, index) => [channel, channelCounts[index]]),
    );
    const dailyPosts = dayWindows.map((day, index) => ({
      date: day.date,
      label: day.label,
      published: dayCounts[index][0],
      scheduled: dayCounts[index][1],
    }));
    // Soonest upcoming posts first, then the most recently published ones:
    // both ordered by distance from now so the list reads as "up next".
    const nowMs = now.getTime();
    const distanceFromNow = (p: RecentPost) =>
      Math.abs(Date.parse(p.publishedAt || p.scheduledAt || p.createdAt || '') - nowMs) || Number.MAX_SAFE_INTEGER;
    const recentPosts = [...recentScheduledSnap.docs, ...recentPublishedSnap.docs]
      .map((d) => ({ id: d.id, ...d.data() } as RecentPost))
      .sort((a, b) => distanceFromNow(a) - distanceFromNow(b))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        channel: p.channel,
        status: p.status,
        content: (p.content || '').slice(0, 80),
        date: p.publishedAt || p.scheduledAt || p.createdAt,
      }));

    return apiOk({
      workspaceId: ws,
      metrics: {
        totalProducts,
        activeProducts,
        totalPosts,
        publishedPosts,
        scheduledPosts,
        postsByChannel,
      },
      dailyPosts,
      recentPosts,
    });
  } catch (error) {
    return apiError(error);
  }
}
