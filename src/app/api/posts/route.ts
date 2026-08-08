import { adminDb } from '@/lib/firebase-admin';
import { requireContext } from '@/lib/server-auth';
import { requirePermission } from '@/lib/rbac';
import { apiError, apiOk, apiCreated } from '@/lib/api-response';
import { createPostSchema, paginationSchema, postWindowSchema } from '@/lib/schemas';
import type { CollectionReference } from 'firebase-admin/firestore';
import { executeListQuery, type FieldFilter } from '@/lib/firestore-list-query';
import { getSocialPostPreflightIssues } from '@/lib/social/post-preflight';
import { getManualPublishChannels, resolveInAppDeliveryMode } from '@/lib/manual-publish-settings';
import { isManualReminderDeliveryMode } from '@/lib/manual-publish-flow';

export const runtime = 'nodejs';


// A post lands on the calendar under publishedAt when it has one, otherwise
// scheduledAt. Firestore can't OR across two fields in one query, so the window
// is two range reads merged by id. The ceiling only exists so a malformed range
// can't read the whole collection; a month never approaches it.
const WINDOW_SAFETY_LIMIT = 1000;

type PostDoc = { id: string } & Record<string, unknown>;

async function fetchPostsInWindow(
  collection: CollectionReference,
  from?: string,
  to?: string,
): Promise<{ posts: PostDoc[]; truncated: boolean }> {
  const readField = async (field: 'scheduledAt' | 'publishedAt') => {
    const filters: FieldFilter[] = [];
    if (from) filters.push({ field, op: '>=', value: from });
    if (to) filters.push({ field, op: '<', value: to });
    return executeListQuery(collection, {
      filters,
      orderByField: field,
      limit: WINDOW_SAFETY_LIMIT,
    });
  };

  const [scheduled, published] = await Promise.all([
    readField('scheduledAt'),
    readField('publishedAt'),
  ]);

  // A published post can match both reads; dedupe by id.
  const byId = new Map<string, PostDoc>();
  for (const post of [...scheduled, ...published]) byId.set(post.id, post);

  return {
    posts: [...byId.values()],
    truncated:
      scheduled.length >= WINDOW_SAFETY_LIMIT || published.length >= WINDOW_SAFETY_LIMIT,
  };
}

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
    const { from, to } = postWindowSchema.parse({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    const statuses = status
      ? status.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const collection = adminDb.collection(`workspaces/${ctx.workspaceId}/posts`);

    if (from || to) {
      const window = await fetchPostsInWindow(collection, from, to);
      // Secondary filters run in memory: combining a range with an equality on
      // another field would need a composite index per combination, and the
      // window already bounds the result set to one view's worth of posts.
      const posts = window.posts.filter((post) =>
        (statuses.length === 0 || statuses.includes(String(post.status ?? ''))) &&
        (!channel || post.channel === channel) &&
        (!productId || post.productId === productId)
      );
      return apiOk({
        workspaceId: ctx.workspaceId,
        posts,
        count: posts.length,
        // True only if a single window overflowed the safety ceiling, which
        // would mean the view is showing an incomplete month.
        truncated: window.truncated,
      });
    }

    const filters: FieldFilter[] = [];
    if (statuses.length > 0) {
      filters.push(statuses.length === 1
        ? { field: 'status', op: '==', value: statuses[0] }
        : { field: 'status', op: 'in', value: statuses });
    }
    if (channel) filters.push({ field: 'channel', op: '==', value: channel });
    if (productId) filters.push({ field: 'productId', op: '==', value: productId });

    const posts = await executeListQuery(
      collection,
      { filters, orderByField: 'createdAt', limit },
    );
    return apiOk({
      workspaceId: ctx.workspaceId,
      posts,
      count: posts.length,
      // Filling the limit exactly may mean more exist; callers that present a
      // list as complete need to know rather than assume.
      truncated: posts.length >= limit,
    });
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
        {
          // Manual posts never contact the platform, so a connected/ready
          // channel isn't required to schedule their reminder.
          requireReadyChannels: !isManualReminder,
          // Validate the specific linked account the post names, not just that
          // the channel has something connected.
          channelDestinations: data.channelDestinations,
        },
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
