import { getEvergreenQueueAnalytics } from '@/lib/evergreen/analytics';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { EVERGREEN_PUBLIC_RATE_LIMIT, getScopedEvergreenQueue } from '@/lib/public-api/evergreen';
import { publicApiError } from '@/lib/public-api/response';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.read', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    await getScopedEvergreenQueue(ctx, id);
    const analytics = await getEvergreenQueueAnalytics(ctx.workspaceId, id);
    return Response.json({ analytics }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
