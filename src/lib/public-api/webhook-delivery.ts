import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { getWebhookEndpointDeliveryConfig } from './webhooks';

const MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE = 25;
const WEBHOOK_DELIVERY_CONCURRENCY = 5;
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_LEASE_MS = 60_000;
const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const LEGACY_WEBHOOK_DISCOVERY_UNTIL_MS = Date.parse('2026-08-25T00:00:00.000Z');

function signPayload(secret: string, timestamp: string, body: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function computeNextAttempt(attemptCount: number) {
  const idx = Math.min(Math.max(attemptCount - 1, 0), WEBHOOK_RETRY_DELAYS_MS.length - 1);
  return new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[idx]).toISOString();
}

export async function processPendingWebhookDeliveries(workspaceId: string) {
  const nowIso = new Date().toISOString();
  const collection = adminDb.collection(`workspaces/${workspaceId}/webhook_deliveries`);
  // The due query is the steady-state path. The bounded legacy query keeps
  // deliveries created before nextAttemptAt was introduced from getting stuck,
  // and also provides a safe rollout fallback while the composite index builds.
  const [dueSnap, initialLegacySnap] = await Promise.all([
    collection
      .where('status', 'in', ['pending', 'retrying'])
      .where('nextAttemptAt', '<=', nowIso)
      .orderBy('nextAttemptAt', 'asc')
      .limit(MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE)
      .get()
      .catch((error) => {
        logger.warn('webhook due query unavailable; using bounded fallback', {
          event: 'webhook.delivery_due_query_fallback',
          workspaceId,
          err: error,
        });
        return null;
      }),
    Date.now() < LEGACY_WEBHOOK_DISCOVERY_UNTIL_MS
      ? collection
          .where('status', 'in', ['pending', 'retrying'])
          .limit(MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE)
          .get()
      : Promise.resolve(null),
  ]);
  let legacySnap = initialLegacySnap;
  // After the compatibility window, run the legacy query only as an index or
  // service fallback. This keeps the steady-state worker at one bounded query.
  if (!dueSnap && !legacySnap) {
    legacySnap = await collection
      .where('status', 'in', ['pending', 'retrying'])
      .limit(MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE)
      .get();
  }
  const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of dueSnap?.docs ?? []) byId.set(doc.id, doc);
  for (const doc of legacySnap?.docs ?? []) {
    const nextAttemptAt = doc.data()?.nextAttemptAt as string | undefined;
    if (!nextAttemptAt || nextAttemptAt <= nowIso) byId.set(doc.id, doc);
  }
  const deliveries = [...byId.values()].slice(0, MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE);
  const results: Array<{ deliveryId: string; status: string }> = [];
  const endpointCache = new Map<string, ReturnType<typeof getWebhookEndpointDeliveryConfig>>();

  const endpointConfig = (endpointId: string) => {
    let pending = endpointCache.get(endpointId);
    if (!pending) {
      pending = getWebhookEndpointDeliveryConfig(workspaceId, endpointId);
      endpointCache.set(endpointId, pending);
    }
    return pending;
  };

  const processOne = async (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const leaseId = crypto.randomUUID();
    const claimed = await adminDb.runTransaction(async (tx) => {
      const latest = await tx.get(doc.ref);
      if (!latest.exists) return null;
      const current = latest.data() as {
        status?: string;
        nextAttemptAt?: string;
        deliveryLeaseId?: string;
        deliveryLeaseExpiresAt?: string;
      };
      if (!['pending', 'retrying'].includes(current.status || '')) return null;
      if (current.nextAttemptAt && current.nextAttemptAt > nowIso) return null;
      if (current.deliveryLeaseId && current.deliveryLeaseExpiresAt && current.deliveryLeaseExpiresAt > nowIso) {
        return null;
      }
      tx.set(doc.ref, {
        deliveryLeaseId: leaseId,
        deliveryLeaseExpiresAt: new Date(Date.now() + WEBHOOK_LEASE_MS).toISOString(),
      }, { merge: true });
      return latest.data() as {
        endpointId?: string;
        payload?: Record<string, unknown>;
        attemptCount?: number;
      };
    });
    if (!claimed?.endpointId || !claimed.payload) return;

    let config: Awaited<ReturnType<typeof getWebhookEndpointDeliveryConfig>>;
    try {
      config = await endpointConfig(claimed.endpointId);
    } catch {
      await doc.ref.set({
        status: 'failed',
        lastError: 'Webhook endpoint not available',
        lastAttemptAt: nowIso,
        expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS),
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      results.push({ deliveryId: doc.id, status: 'failed' });
      return;
    }

    const attemptCount = (claimed.attemptCount || 0) + 1;
    const body = JSON.stringify(claimed.payload);
    const timestamp = new Date().toISOString();
    const signature = signPayload(config.secret, timestamp, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Markaestro-Event': String(claimed.payload.type || ''),
          'X-Markaestro-Timestamp': timestamp,
          'X-Markaestro-Signature': signature,
        },
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        await doc.ref.set({
          status: 'delivered',
          responseCode: response.status,
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: '',
          expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS),
          deliveryLeaseId: FieldValue.delete(),
          deliveryLeaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'delivered' });
        return;
      }

      if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        await doc.ref.set({
          status: 'failed',
          responseCode: response.status,
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: `Webhook responded ${response.status}`,
          expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS),
          deliveryLeaseId: FieldValue.delete(),
          deliveryLeaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'failed' });
        return;
      }

      await doc.ref.set({
        status: 'retrying',
        responseCode: response.status,
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: `Webhook responded ${response.status}`,
        nextAttemptAt: computeNextAttempt(attemptCount),
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
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
          expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS),
          deliveryLeaseId: FieldValue.delete(),
          deliveryLeaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        results.push({ deliveryId: doc.id, status: 'failed' });
        return;
      }

      await doc.ref.set({
        status: 'retrying',
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: message,
        nextAttemptAt: computeNextAttempt(attemptCount),
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      results.push({ deliveryId: doc.id, status: 'retrying' });
    } finally {
      clearTimeout(timeout);
    }
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < deliveries.length) {
      await processOne(deliveries[cursor++]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WEBHOOK_DELIVERY_CONCURRENCY, deliveries.length) }, () => worker()),
  );

  return results;
}
