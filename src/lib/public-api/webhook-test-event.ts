/**
 * Send one test delivery to a single endpoint.
 *
 * The fastest way for an integrator to confirm their signature verification
 * works is to receive a real, signed delivery on demand, rather than to wait
 * for a post to publish and find out then. Paired with the delivery log, this
 * turns "is my verification right?" into a question they can answer in one
 * click instead of one release.
 *
 * Deliberately targets one endpoint, unlike `enqueueWebhookEvent`, which fans
 * an event out to every subscriber: testing your own endpoint must not deliver
 * to your colleague's.
 *
 * Lives in its own module rather than in `webhooks.ts` so the test path cannot
 * be reached by the normal event fan-out by accident.
 */

import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { logger } from '@/lib/logger';

/** Matches `WEBHOOK_DELIVERY_RETENTION_MS` in webhooks.ts. */
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The event type a test delivery carries.
 *
 * `post.published` rather than a bespoke `test` type: a receiver should be
 * exercised on a shape it will actually get, and a type that only ever appears
 * in tests is a branch that only ever gets tested. `data.test` marks it, so a
 * receiver that wants to ignore test traffic can.
 */
const TEST_EVENT_TYPE = 'post.published';

export async function sendWebhookTestEvent(workspaceId: string, endpointId: string) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const endpoint = snap.data() as { status?: string; url?: string };
  if (endpoint.status !== 'active') throw new Error('WEBHOOK_ENDPOINT_DISABLED');

  const now = new Date().toISOString();
  const event = {
    id: `evt_${crypto.randomUUID()}`,
    type: TEST_EVENT_TYPE,
    createdAt: now,
    workspaceId,
    data: {
      // Named so it is unmistakable in a log, and so a receiver can drop it
      // before it reaches anything that acts on a real publish.
      test: true,
      postId: 'post_test',
      channel: 'instagram',
      externalUrl: null,
      publishedAt: now,
    },
  };

  const deliveryRef = adminDb.collection(`workspaces/${workspaceId}/webhook_deliveries`).doc();
  await deliveryRef.set({
    endpointId,
    eventType: TEST_EVENT_TYPE,
    payload: event,
    status: 'pending',
    attemptCount: 0,
    responseCode: null,
    lastError: '',
    nextAttemptAt: now,
    createdAt: now,
    lastAttemptAt: null,
    // Marked on the delivery too, so the delivery log can label it rather than
    // leaving someone to wonder which of yesterday's rows was the test.
    isTest: true,
    expiresAt: Timestamp.fromMillis(Date.now() + DELIVERY_RETENTION_MS),
  });

  await markWorkspaceDue(workspaceId, now, 'webhook_delivery').catch((error: unknown) => {
    logger.warn('webhook test delivery due marker failed; compatibility sweep will recover it', {
      event: 'worker.mark_due_failed',
      workspaceId,
      err: error,
    });
  });

  return { deliveryId: deliveryRef.id, eventId: event.id, url: endpoint.url ?? '' };
}
