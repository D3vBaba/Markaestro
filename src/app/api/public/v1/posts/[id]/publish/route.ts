import { adminDb } from '@/lib/firebase-admin';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { getPublicPost } from '@/lib/public-api/posts';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { incrementApiClientStat } from '@/lib/public-api/analytics';

const PUBLISH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.publish',
      rateLimit: PUBLISH_RATE_LIMIT,
    });
    const { id } = await params;
    const post = await getPublicPost(ctx.workspaceId, id);

    const status = String(post.status || '');
    if (!['draft', 'scheduled', 'failed'].includes(status)) {
      return Response.json({
        error: 'VALIDATION_POST_NOT_PUBLISHABLE',
      }, { status: 400, headers: ctx.rateLimitHeaders });
    }

    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = idempotencyKey ? createRequestHash(JSON.stringify({ postId: id })) : null;

    if (idempotencyKey && requestHash) {
      const replay = await loadIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash);
      if (replay) {
        Object.entries(ctx.rateLimitHeaders).forEach(([key, value]) => replay.headers.set(key, value));
        return replay;
      }
    }

    const now = new Date().toISOString();
    const runRef = adminDb.collection(`workspaces/${ctx.workspaceId}/job_runs`).doc();
    const run = {
      id: runRef.id,
      type: 'publish_post',
      resourceType: 'post',
      resourceId: id,
      status: 'queued',
      message: 'Publish queued',
      details: {},
      createdByType: ctx.principalType,
      createdById: ctx.clientId,
      attemptCount: 0,
      nextAttemptAt: now,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    };
    await runRef.set(run);
    await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'publish_queued');

    const body = {
      run: {
        id: run.id,
        type: run.type,
        status: run.status,
        resourceType: run.resourceType,
        resourceId: run.resourceId,
        createdAt: run.createdAt,
      },
    };

    await enqueueWebhookEvent(ctx.workspaceId, 'post.publish.queued', {
      postId: id,
      channel: post.channel,
      status: post.status,
      runId: run.id,
    });

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 202, body);
    }

    return Response.json(body, { status: 202, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
