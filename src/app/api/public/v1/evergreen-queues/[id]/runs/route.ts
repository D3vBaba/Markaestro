import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { listEvergreenRuns } from '@/lib/evergreen/storage';
import { EVERGREEN_PUBLIC_RATE_LIMIT, getScopedEvergreenQueue } from '@/lib/public-api/evergreen';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.read', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    await getScopedEvergreenQueue(ctx, id);
    const runs = await listEvergreenRuns(ctx.workspaceId, id);
    return Response.json({ runs, count: runs.length }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
