import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createPostSchema, paginationSchema } from '@/lib/schemas';
import { executeListQuery, type FieldFilter } from '@/lib/firestore-list-query';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { getManualPublishChannels, resolveInAppDeliveryMode } from '@/lib/manual-publish-settings';
import { isManualReminderDeliveryMode } from '@/lib/manual-publish-flow';

export const runtime = 'nodejs';


export async function GET(req: Request) {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const { limit, status } = paginationSchema.parse({
      limit: url.searchParams.get('limit') ?? 50,
      status: url.searchParams.get('status') ?? undefined,
    });
    const channel = url.searchParams.get('channel') ?? undefined;
    // Brands are stored as `products`; posts link to one via productId.
    const productId = url.searchParams.get('productId') ?? undefined;

    const filters: FieldFilter[] = [];
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      filters.push(statuses.length === 1
        ? { field: 'status', op: '==', value: statuses[0] }
        : { field: 'status', op: 'in', value: statuses });
    }
    if (channel) filters.push({ field: 'channel', op: '==', value: channel });
    if (productId) filters.push({ field: 'productId', op: '==', value: productId });

    const posts = await executeListQuery(
      adminDb.collection(`workspaces/${ctx.workspaceId}/posts`),
      { filters, orderByField: 'createdAt', limit },
    );
    return apiOk({ workspaceId: ctx.workspaceId, posts, count: posts.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireContext(req);
    requirePermission(ctx, 'posts.write');
    const body = await req.json();
    const data = createPostSchema.parse(body);

    // Scheduling queues an outbound publish, so it requires a verified email.
    // Creating drafts (or any other status) stays open to unverified users.
    if (data.status === 'scheduled' && !ctx.emailVerified) {
      return apiOk(
        { error: 'EMAIL_NOT_VERIFIED', message: 'Verify your email to publish.' },
        403,
      );
    }

    // Workspace publishing defaults: channels set to manual posting make the
    // post a manual reminder unless the request picked a mode explicitly.
    const manualChannels = await getManualPublishChannels(ctx.workspaceId);
    const deliveryMode = resolveInAppDeliveryMode(
      data.targetChannels?.length ? data.targetChannels : [data.channel],
      data.deliveryMode,
      manualChannels,
    );
    const isManualReminder = isManualReminderDeliveryMode(deliveryMode);

    if (data.status === 'scheduled') {
      const issues = await getSocialPostPreflightIssues(
        ctx.workspaceId,
        data.productId || undefined,
        data,
        // Manual posts never contact the platform, so a connected/ready
        // channel isn't required to schedule their reminder.
        { requireReadyChannels: !isManualReminder },
      );
      if (issues.length > 0) {
        return apiOk({ error: 'VALIDATION_ERROR', issues }, 400);
      }
    }

    const now = new Date().toISOString();

    const payload = {
      ...data,
      ...(deliveryMode ? { deliveryMode } : {}),
      workspaceId: ctx.workspaceId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await adminDb
      .collection(`workspaces/${ctx.workspaceId}/posts`)
      .add(payload);

    return apiCreated({ id: ref.id, ...payload });
  } catch (error) {
    return apiError(error);
  }
}
