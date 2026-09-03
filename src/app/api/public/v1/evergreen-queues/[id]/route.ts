import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { evergreenQueueIdSchema, updateEvergreenQueueSchema } from '@/lib/evergreen/schemas';
import { archiveEvergreenQueue, updateEvergreenQueue } from '@/lib/evergreen/storage';
import { EVERGREEN_PUBLIC_RATE_LIMIT, evergreenMutationResponse, getScopedEvergreenQueue } from '@/lib/public-api/evergreen';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.read', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    return Response.json({ queue: await getScopedEvergreenQueue(ctx, id) }, { headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.write', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    await getScopedEvergreenQueue(ctx, id);
    const input = updateEvergreenQueueSchema.parse(await req.json());
    return evergreenMutationResponse(req, ctx, input, () =>
      updateEvergreenQueue(ctx.workspaceId, id, ctx.ownerUid || `api_client:${ctx.clientId}`, input));
  } catch (error) {
    return publicApiError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  try {
    const ctx = await requirePublicApiContext(req, { scope: 'evergreen.write', rateLimit: EVERGREEN_PUBLIC_RATE_LIMIT });
    const id = evergreenQueueIdSchema.parse((await params).id);
    await getScopedEvergreenQueue(ctx, id);
    return evergreenMutationResponse(req, ctx, null, () =>
      archiveEvergreenQueue(ctx.workspaceId, id, ctx.ownerUid || `api_client:${ctx.clientId}`));
  } catch (error) {
    return publicApiError(error);
  }
}
