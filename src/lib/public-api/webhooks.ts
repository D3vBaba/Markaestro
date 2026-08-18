import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { decrypt } from '@/lib/crypto';
import { buildWebhookSecret } from './keys';
import type { PublicWebhookEvent } from './scopes';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { logger } from '@/lib/logger';

const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE = Math.max(
  1,
  Number(process.env.MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE || 25),
);

type WebhookActor = {
  workspaceId: string;
  principalType: 'api_client' | 'user';
  clientId: string;
};

export async function createWebhookEndpoint(
  ctx: WebhookActor,
  input: { url: string; events: PublicWebhookEvent[] },
) {
  const endpoints = adminDb.collection(`workspaces/${ctx.workspaceId}/webhook_endpoints`);
  const ref = endpoints.doc();
  const now = new Date().toISOString();
  const secret = buildWebhookSecret();
  const endpoint = {
    url: input.url,
    events: input.events,
    status: 'active',
    secretHash: secret.secretHash,
    secretEncrypted: secret.secretEncrypted,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt: now,
    updatedAt: now,
  };

  // A transaction makes the cap hold even when multiple clients attempt to
  // register endpoints at the same time. This is a cold administration path,
  // so reading at most 25 small endpoint documents is preferable to allowing
  // an unbounded per-event delivery fan-out.
  await adminDb.runTransaction(async (tx) => {
    const active = await tx.get(
      endpoints.where('status', '==', 'active').limit(MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE),
    );
    if (active.size >= MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE) {
      throw new Error('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    }
    tx.create(ref, endpoint);
  });

  return {
    id: ref.id,
    url: input.url,
    events: input.events,
    status: 'active',
    secret: secret.secret,
    createdAt: now,
  };
}

export async function listWebhookEndpoints(workspaceId: string) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/webhook_endpoints`).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      url: data.url,
      events: data.events || [],
      status: data.status || 'disabled',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}

export async function disableWebhookEndpoint(workspaceId: string, endpointId: string) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  await ref.set({
    status: 'disabled',
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function enqueueWebhookEvent(
  workspaceId: string,
  eventType: PublicWebhookEvent,
  payload: Record<string, unknown>,
) {
  const endpointsSnap = await adminDb
    .collection(`workspaces/${workspaceId}/webhook_endpoints`)
    .where('status', '==', 'active')
    .get();

  const now = new Date().toISOString();
  const event = {
    id: `evt_${crypto.randomUUID()}`,
    type: eventType,
    createdAt: now,
    workspaceId,
    data: payload,
  };

  const batch = adminDb.batch();
  let deliveryCount = 0;
  for (const endpoint of endpointsSnap.docs) {
    const data = endpoint.data() as { events?: string[] };
    if (!data.events?.includes(eventType)) continue;

    const deliveryRef = adminDb.collection(`workspaces/${workspaceId}/webhook_deliveries`).doc();
    batch.set(deliveryRef, {
      endpointId: endpoint.id,
      eventType,
      payload: event,
      status: 'pending',
      attemptCount: 0,
      responseCode: null,
      lastError: '',
      nextAttemptAt: now,
      createdAt: now,
      lastAttemptAt: null,
      expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_DELIVERY_RETENTION_MS),
    });
    deliveryCount++;
  }

  await batch.commit();
  if (deliveryCount > 0) {
    await markWorkspaceDue(workspaceId, now, 'webhook_delivery').catch((error) => {
      logger.warn('webhook delivery due marker failed; compatibility sweep will recover it', {
        event: 'worker.mark_due_failed',
        workspaceId,
        err: error,
      });
    });
  }
}

export async function getWebhookEndpointSecret(workspaceId: string, endpointId: string) {
  const config = await getWebhookEndpointDeliveryConfig(workspaceId, endpointId);
  return config.secret;
}

export async function getWebhookEndpointDeliveryConfig(workspaceId: string, endpointId: string) {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  if (snap.data()?.status !== 'active') throw new Error('WEBHOOK_ENDPOINT_DISABLED');
  const secretEncrypted = snap.data()?.secretEncrypted as string | undefined;
  if (!secretEncrypted) throw new Error('NOT_FOUND');
  const url = snap.data()?.url as string | undefined;
  if (!url) throw new Error('NOT_FOUND');
  return { url, secret: decrypt(secretEncrypted) };
}
