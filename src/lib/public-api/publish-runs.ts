import { adminDb } from '@/lib/firebase-admin';
import { getConnectionForChannel } from '@/lib/platform/connections';
import { publishPostMultiChannel } from '@/lib/social/publisher';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { acquirePublishLock, assertPublishRateLimit, getPublishDestinationKey, releasePublishLock } from './publish-throttle';
import { enqueueWebhookEvent } from './webhooks';
import { incrementApiClientStat } from './analytics';

const MAX_PUBLIC_RUNS_PER_WORKSPACE = 20;

function nextRetryIso(seconds: number) {
  return new Date(Date.now() + (seconds * 1000)).toISOString();
}

async function claimQueuedRun(workspaceId: string, runId: string) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/job_runs/${runId}`);
  const startedAt = new Date().toISOString();

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as { status?: string; nextAttemptAt?: string };
    if (data.status !== 'queued') return null;
    if (data.nextAttemptAt && data.nextAttemptAt > startedAt) return null;

    tx.set(ref, {
      status: 'running',
      startedAt,
      message: 'Publish started',
    }, { merge: true });
    return { id: runId, ...snap.data(), status: 'running', startedAt };
  });
}

async function deferRun(
  workspaceId: string,
  runId: string,
  reason: string,
  retryAfterSeconds: number,
) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/job_runs/${runId}`);
  const snap = await ref.get();
  const attemptCount = ((snap.data()?.attemptCount as number) || 0) + 1;
  await ref.set({
    status: 'queued',
    message: reason,
    attemptCount,
    nextAttemptAt: nextRetryIso(retryAfterSeconds),
  }, { merge: true });
}

async function markRunFinished(
  workspaceId: string,
  runId: string,
  status: 'succeeded' | 'failed',
  message: string,
  details: Record<string, unknown> = {},
) {
  await adminDb.doc(`workspaces/${workspaceId}/job_runs/${runId}`).set({
    status,
    message,
    details,
    finishedAt: new Date().toISOString(),
  }, { merge: true });
}

async function resolveConnectionForPost(
  workspaceId: string,
  post: Record<string, unknown>,
): Promise<PlatformConnection | null> {
  return getConnectionForChannel(
    workspaceId,
    String(post.channel) as SocialChannel,
    typeof post.productId === 'string' && post.productId ? post.productId : undefined,
  );
}

async function processSingleRun(workspaceId: string, runId: string) {
  const runSnap = await adminDb.doc(`workspaces/${workspaceId}/job_runs/${runId}`).get();
  if (!runSnap.exists) return null;

  const run = runSnap.data() as { resourceId?: string };
  if (!run.resourceId) {
    await markRunFinished(workspaceId, runId, 'failed', 'Run has no resourceId');
    return { runId, status: 'failed' };
  }

  const postRef = adminDb.doc(`workspaces/${workspaceId}/posts/${run.resourceId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    await markRunFinished(workspaceId, runId, 'failed', 'Post not found');
    return { runId, status: 'failed' };
  }

  const post = postSnap.data() as Record<string, unknown>;
  const clientId = typeof post.createdById === 'string' && post.createdByType === 'api_client'
    ? post.createdById
    : null;
  const connection = await resolveConnectionForPost(workspaceId, post);
  if (!connection) {
    await postRef.set({
      status: 'failed',
      errorMessage: `${String(post.channel)} integration is not configured or disabled`,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    await markRunFinished(workspaceId, runId, 'failed', 'No connected platform account');
    if (clientId) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
    }
    await enqueueWebhookEvent(workspaceId, 'post.failed', {
      postId: run.resourceId,
      channel: post.channel,
      status: 'failed',
      error: `${String(post.channel)} integration is not configured or disabled`,
    });
    return { runId, status: 'failed' };
  }

  const destinationKey = getPublishDestinationKey(String(post.channel) as SocialChannel, connection);
  const rateLimitResult = await assertPublishRateLimit(destinationKey, String(post.channel) as SocialChannel);
  if (!rateLimitResult.allowed) {
    await deferRun(workspaceId, runId, 'Publish deferred due to platform rate limit', rateLimitResult.retryAfterSeconds);
    return { runId, status: 'deferred' };
  }

  const lockAcquired = await acquirePublishLock(destinationKey, runId);
  if (!lockAcquired) {
    await deferRun(workspaceId, runId, 'Publish deferred because destination is busy', 15);
    return { runId, status: 'deferred' };
  }

  try {
    await postRef.set({
      status: 'publishing',
      updatedAt: new Date().toISOString(),
      errorMessage: '',
    }, { merge: true });

    const result = await publishPostMultiChannel(
      workspaceId,
      typeof post.productId === 'string' && post.productId ? post.productId : undefined,
      {
        content: String(post.content || ''),
        channel: String(post.channel) as SocialChannel,
        mediaUrls: Array.isArray(post.mediaUrls)
          ? post.mediaUrls.filter((value): value is string => typeof value === 'string')
          : [],
        deliveryMode: post.deliveryMode === 'user_review' ? 'user_review' : 'direct_publish',
      },
    );

    if (result.pending) {
      await postRef.set({
        status: 'publishing',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await markRunFinished(workspaceId, runId, 'succeeded', 'Publish handed off to platform', {
        pending: true,
        externalId: result.externalId || '',
      });
      return { runId, status: 'succeeded' };
    }

    if (result.reviewRequired) {
      await postRef.set({
        status: 'exported_for_review',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        nextAction: result.nextAction || 'open_tiktok_inbox_and_complete_editing',
        exportedForReviewAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await markRunFinished(workspaceId, runId, 'succeeded', 'Post exported for manual review', {
        reviewRequired: true,
        externalId: result.externalId || '',
        nextAction: result.nextAction || 'open_tiktok_inbox_and_complete_editing',
      });
      if (clientId) {
        await incrementApiClientStat(workspaceId, clientId, 'publish_exported_for_review');
      }
      await enqueueWebhookEvent(workspaceId, 'post.exported_for_review', {
        postId: run.resourceId,
        channel: post.channel,
        status: 'exported_for_review',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        nextAction: result.nextAction || 'open_tiktok_inbox_and_complete_editing',
      });
      return { runId, status: 'succeeded' };
    }

    if (result.success) {
      await postRef.set({
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
        publishResults: result.channels,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await markRunFinished(workspaceId, runId, 'succeeded', 'Post published', {
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
      });
      if (clientId) {
        await incrementApiClientStat(workspaceId, clientId, 'publish_succeeded');
      }
      await enqueueWebhookEvent(workspaceId, 'post.published', {
        postId: run.resourceId,
        channel: post.channel,
        status: 'published',
        externalId: result.externalId || '',
        externalUrl: result.externalUrl || '',
      });
      return { runId, status: 'succeeded' };
    }

    await postRef.set({
      status: 'failed',
      errorMessage: result.error || 'Unknown publishing error',
      publishResults: result.channels,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    await markRunFinished(workspaceId, runId, 'failed', result.error || 'Unknown publishing error');
    if (clientId) {
      await incrementApiClientStat(workspaceId, clientId, 'publish_failed');
    }
    await enqueueWebhookEvent(workspaceId, 'post.failed', {
      postId: run.resourceId,
      channel: post.channel,
      status: 'failed',
      error: result.error || 'Unknown publishing error',
    });
    return { runId, status: 'failed' };
  } finally {
    await releasePublishLock(destinationKey, runId);
  }
}

export async function processQueuedPublicPublishRuns(workspaceId: string) {
  const nowIso = new Date().toISOString();
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/job_runs`)
    .where('type', '==', 'publish_post')
    .where('status', '==', 'queued')
    .limit(MAX_PUBLIC_RUNS_PER_WORKSPACE)
    .get();

  const results: Array<{ runId: string; status: string }> = [];

  for (const doc of snap.docs) {
    const nextAttemptAt = doc.data()?.nextAttemptAt as string | undefined;
    if (nextAttemptAt && nextAttemptAt > nowIso) continue;

    const claimed = await claimQueuedRun(workspaceId, doc.id);
    if (!claimed) continue;
    const result = await processSingleRun(workspaceId, doc.id);
    if (result) results.push(result);
  }

  return results;
}
