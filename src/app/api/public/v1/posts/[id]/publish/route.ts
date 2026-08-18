import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { requirePublicApiContext } from '@/lib/public-api/auth';
import { publicApiError } from '@/lib/public-api/response';
import { assertPublicPostInBrandScope, getPublicPost } from '@/lib/public-api/posts';
import { createRequestHash, getIdempotencyKey, loadIdempotentResponse, persistIdempotentResponse } from '@/lib/public-api/idempotency';
import { enqueueWebhookEvent } from '@/lib/public-api/webhooks';
import { incrementApiClientStat } from '@/lib/public-api/usage';
import { LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from '@/lib/tiktok-draft-flow';
import { getPublishRunSkipReason } from '@/lib/public-api/publish-runs';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';


const PUBLISH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const PUBLISH_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type PublishRun = {
  id: string;
  type: string;
  resourceType: string;
  resourceId: string;
  status: string;
  message?: string;
  details?: Record<string, unknown>;
  createdByType?: string;
  createdById?: string;
  attemptCount?: number;
  nextAttemptAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePublicApiContext(req, {
      scope: 'posts.publish',
      rateLimit: PUBLISH_RATE_LIMIT,
    });
    const { id } = await params;
    const post = await getPublicPost(ctx.workspaceId, id);
    assertPublicPostInBrandScope(post, ctx.productId);
    const skipReason = getPublishRunSkipReason(post);
    if (skipReason) {
      return Response.json({
        error: 'VALIDATION_POST_ALREADY_PUBLISHING',
        message: skipReason,
      }, { status: 409, headers: ctx.rateLimitHeaders });
    }

    const status = String(post.status || '');
    if (!['draft', 'scheduled', 'failed', 'partial_failed', PLATFORM_ACTION_REQUIRED_STATUS, LEGACY_EXPORTED_FOR_REVIEW_STATUS].includes(status)) {
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

    const postRef = adminDb.doc(`workspaces/${ctx.workspaceId}/posts/${id}`);
    const newRunRef = adminDb.collection(`workspaces/${ctx.workspaceId}/job_runs`).doc();
    const queued = await adminDb.runTransaction<{ created: boolean; run: PublishRun }>(async (tx) => {
      const latestSnap = await tx.get(postRef);
      if (!latestSnap.exists) throw new Error('NOT_FOUND');
      const latestPost = { id: latestSnap.id, ...latestSnap.data() } as Record<string, unknown>;
      assertPublicPostInBrandScope(latestPost, ctx.productId);

      const existingRunId = typeof latestPost.publishRunId === 'string'
        ? latestPost.publishRunId
        : '';
      if (existingRunId) {
        const existingRef = adminDb.doc(`workspaces/${ctx.workspaceId}/job_runs/${existingRunId}`);
        const existingSnap = await tx.get(existingRef);
        const existing = existingSnap.data() as Record<string, unknown> | undefined;
        if (existingSnap.exists && ['queued', 'running'].includes(String(existing?.status || ''))) {
          return {
            created: false,
            run: {
              id: existingSnap.id,
              type: String(existing?.type || 'publish_post'),
              resourceType: String(existing?.resourceType || 'post'),
              resourceId: String(existing?.resourceId || id),
              status: String(existing?.status || 'queued'),
              createdAt: String(existing?.createdAt || new Date().toISOString()),
            },
          };
        }
      }

      const latestSkipReason = getPublishRunSkipReason(latestPost);
      if (latestSkipReason) throw new Error('VALIDATION_POST_ALREADY_PUBLISHING');
      const latestStatus = String(latestPost.status || '');
      if (!['draft', 'scheduled', 'failed', 'partial_failed', PLATFORM_ACTION_REQUIRED_STATUS, LEGACY_EXPORTED_FOR_REVIEW_STATUS].includes(latestStatus)) {
        throw new Error('VALIDATION_POST_NOT_PUBLISHABLE');
      }

      const now = new Date().toISOString();
      const run = {
        id: newRunRef.id,
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
        expiresAt: Timestamp.fromMillis(Date.now() + PUBLISH_RUN_RETENTION_MS),
      };
      tx.set(newRunRef, run);
      tx.set(postRef, {
        publishRunId: newRunRef.id,
        publishRunStatus: 'queued',
        publishQueuedAt: now,
        scheduledAt: null,
        updatedAt: now,
      }, { merge: true });
      return { created: true, run };
    });
    const run = queued.run;
    if (queued.created) {
      await incrementApiClientStat(ctx.workspaceId, ctx.clientId, 'publish_queued');
      await markWorkspaceDue(ctx.workspaceId, Date.now(), 'publish_run').catch((error) => {
        logger.warn('public publish due marker failed; compatibility sweep will recover it', {
          event: 'worker.mark_due_failed',
          workspaceId: ctx.workspaceId,
          runId: run.id,
          err: error,
        });
      });
    }

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

    if (queued.created) {
      await enqueueWebhookEvent(ctx.workspaceId, 'post.publish.queued', {
        postId: id,
        channel: post.channel,
        status: post.status,
        runId: run.id,
      });
    }

    if (idempotencyKey && requestHash) {
      await persistIdempotentResponse(ctx.workspaceId, idempotencyKey, requestHash, 202, body);
    }

    return Response.json(body, { status: 202, headers: ctx.rateLimitHeaders });
  } catch (error) {
    return publicApiError(error);
  }
}
