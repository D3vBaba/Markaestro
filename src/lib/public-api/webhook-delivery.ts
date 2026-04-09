import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { getAllMatchingDocs } from '@/lib/firestore-pagination';
import { getWebhookEndpointSecret } from './webhooks';

const MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE = 25;
const MAX_WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function signPayload(secret: string, timestamp: string, body: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function computeNextAttempt(attemptCount: number) {
  const idx = Math.min(Math.max(attemptCount - 1, 0), WEBHOOK_RETRY_DELAYS_MS.length - 1);
  return new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[idx]).toISOString();
}

export async function processPendingWebhookDeliveries(workspaceId: string) {
  const deliveries = await getAllMatchingDocs(
    adminDb
      .collection(`workspaces/${workspaceId}/webhook_deliveries`)
      .where('status', 'in', ['pending', 'retrying']),
    MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE,
  );

  const nowIso = new Date().toISOString();
  const results: Array<{ deliveryId: string; status: string }> = [];

  for (const doc of deliveries) {
    const data = doc.data() as {
      endpointId?: string;
      payload?: Record<string, unknown>;
      nextAttemptAt?: string;
      attemptCount?: number;
    };
    if (data.nextAttemptAt && data.nextAttemptAt > nowIso) continue;
    if (!data.endpointId || !data.payload) continue;

    const endpointSnap = await adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${data.endpointId}`).get();
    if (!endpointSnap.exists || endpointSnap.data()?.status !== 'active') {
      await doc.ref.set({
        status: 'failed',
        lastError: 'Webhook endpoint not available',
        lastAttemptAt: nowIso,
      }, { merge: true });
      results.push({ deliveryId: doc.id, status: 'failed' });
      continue;
    }

    const endpointUrl = endpointSnap.data()?.url as string;
    const attemptCount = (data.attemptCount || 0) + 1;
    const body = JSON.stringify(data.payload);
    const timestamp = new Date().toISOString();
    const secret = await getWebhookEndpointSecret(workspaceId, data.endpointId);
    const signature = signPayload(secret, timestamp, body);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Markaestro-Event': String(data.payload.type || ''),
          'X-Markaestro-Timestamp': timestamp,
          'X-Markaestro-Signature': signature,
        },
        body,
      });

      if (response.ok) {
        await doc.ref.set({
          status: 'delivered',
          responseCode: response.status,
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: '',
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'delivered' });
        continue;
      }

      if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        await doc.ref.set({
          status: 'failed',
          responseCode: response.status,
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: `Webhook responded ${response.status}`,
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'failed' });
        continue;
      }

      await doc.ref.set({
        status: 'retrying',
        responseCode: response.status,
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: `Webhook responded ${response.status}`,
        nextAttemptAt: computeNextAttempt(attemptCount),
      }, { merge: true });
      results.push({ deliveryId: doc.id, status: 'retrying' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook delivery failed';
      if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        await doc.ref.set({
          status: 'failed',
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: message,
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'failed' });
        continue;
      }

      await doc.ref.set({
        status: 'retrying',
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: message,
        nextAttemptAt: computeNextAttempt(attemptCount),
      }, { merge: true });
      results.push({ deliveryId: doc.id, status: 'retrying' });
    }
  }

  return results;
}
