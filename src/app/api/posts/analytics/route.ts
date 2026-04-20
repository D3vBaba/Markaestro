import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { adminDb } from '@/lib/firebase-admin';
import { apiError, apiOk } from '@/lib/api-response';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'analytics.read');

    const snap = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .get();

    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      channel: string;
      status: string;
      publishedAt?: string;
      scheduledAt?: string;
      createdAt?: string;
      errorMessage?: string;
    }>;

    // Aggregate by channel
    const byChannel: Record<string, { total: number; published: number; scheduled: number; draft: number; failed: number }> = {};
    for (const post of posts) {
      const ch = post.channel || 'unknown';
      if (!byChannel[ch]) byChannel[ch] = { total: 0, published: 0, scheduled: 0, draft: 0, failed: 0 };
      byChannel[ch].total++;
      if (post.status === 'published') byChannel[ch].published++;
      else if (post.status === 'scheduled') byChannel[ch].scheduled++;
      else if (post.status === 'draft') byChannel[ch].draft++;
      else if (post.status === 'failed') byChannel[ch].failed++;
    }

    // Published in last 7 / 30 days
    const now = Date.now();
    const published = posts.filter((p) => p.status === 'published');
    const last7 = published.filter((p) => p.publishedAt && now - new Date(p.publishedAt).getTime() < 7 * 86400_000).length;
    const last30 = published.filter((p) => p.publishedAt && now - new Date(p.publishedAt).getTime() < 30 * 86400_000).length;

    // Failed rate
    const total = posts.length;
    const totalPublished = published.length;
    const totalFailed = posts.filter((p) => p.status === 'failed').length;
    const totalScheduled = posts.filter((p) => p.status === 'scheduled').length;
    const totalDraft = posts.filter((p) => p.status === 'draft').length;
    const publishSuccessRate = totalPublished + totalFailed > 0
      ? Math.round((totalPublished / (totalPublished + totalFailed)) * 100)
      : 100;

    // Top channel by published count
    const topChannel = Object.entries(byChannel)
      .sort((a, b) => b[1].published - a[1].published)
      .at(0);

    return apiOk({
      ok: true,
      stats: {
        total,
        totalPublished,
        totalScheduled,
        totalDraft,
        totalFailed,
        publishSuccessRate,
        last7DaysPublished: last7,
        last30DaysPublished: last30,
        byChannel,
        topChannel: topChannel ? { channel: topChannel[0], published: topChannel[1].published } : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
