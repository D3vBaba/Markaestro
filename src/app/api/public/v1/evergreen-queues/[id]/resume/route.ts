import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { evergreenQueueIdSchema } from '@/lib/evergreen/schemas';
import { resumeEvergreenQueue } from '@/lib/evergreen/storage';
import { EVERGREEN_PUBLIC_RATE_LIMIT, evergreenMutationResponse, getScopedEvergreenQueue } from '@/lib/public-api/evergreen';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.write', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    await getScopedEvergreenQueue(ctx, id);
    return evergreenMutationResponse(req, ctx, null, () =>
      resumeEvergreenQueue(ctx.workspaceId, id, ctx.ownerUid || `api_client:${ctx.clientId}`));
  } catch (error) {
    return publicApiError(error);
  }
}
