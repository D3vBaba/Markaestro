import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { decrypt } from '@/lib/crypto';
import { buildWebhookSecret } from './keys';
import type { PublicWebhookEvent } from './scopes';

type WebhookActor = {
  workspaceId: string;
  principalType: 'api_client' | 'user';
  clientId: string;
};

export async function createWebhookEndpoint(
  ctx: WebhookActor,
  input: { url: string; events: PublicWebhookEvent[] },
) {
  const ref = adminDb.collection(`workspaces/${ctx.workspaceId}/webhook_endpoints`).doc();
  const now = new Date().toISOString();
  const secret = buildWebhookSecret();

  await ref.set({
    url: input.url,
    events: input.events,
    status: 'active',
    secretHash: secret.secretHash,
    secretEncrypted: secret.secretEncrypted,
    createdByType: ctx.principalType,
    createdById: ctx.clientId,
    createdAt: now,
    updatedAt: now,
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
    });
  }

  await batch.commit();
}

export async function getWebhookEndpointSecret(workspaceId: string, endpointId: string) {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`).get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const secretEncrypted = snap.data()?.secretEncrypted as string | undefined;
  if (!secretEncrypted) throw new Error('NOT_FOUND');
  return decrypt(secretEncrypted);
}
