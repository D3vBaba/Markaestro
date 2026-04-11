import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createSlideshowSchema, paginationSchema } from '@/lib/schemas';
import { executeListQuery } from '@/lib/firestore-list-query';
import { workspaceSlideshowsCollection, serializeSlideshowDoc } from '@/lib/slideshows/firestore';

export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });

    const filters = status
      ? [{ field: 'status', op: '==' as const, value: status }]
      : [];

    const slideshows = await executeListQuery(
      workspaceSlideshowsCollection(ctx.workspaceId),
      { filters, orderByField: 'createdAt', limit },
    );

    return apiOk({ workspaceId: ctx.workspaceId, slideshows, count: slideshows.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'campaigns.write');

    const body = await req.json();
    const input = createSlideshowSchema.parse(body);

    const ref = workspaceSlideshowsCollection(ctx.workspaceId).doc();
    const doc = serializeSlideshowDoc(ref.id, {
      workspaceId: ctx.workspaceId,
      productId: input.productId,
      title: input.title || '',
      prompt: input.prompt,
      channel: input.channel,
      slideCount: input.slideCount,
      caption: input.caption || '',
      aspectRatio: input.aspectRatio,
      renderMode: input.renderMode,
      visualStyle: input.visualStyle,
      imageStyle: input.imageStyle,
      imageProvider: input.imageProvider,
      createdBy: ctx.uid,
    });

    await adminDb.doc(`workspaces/${ctx.workspaceId}/slideshows/${ref.id}`).set(doc);

    return apiCreated(doc);
  } catch (error) {
    return apiError(error);
  }
}
