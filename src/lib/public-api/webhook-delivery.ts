import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { getWebhookEndpointDeliveryConfig } from './webhooks';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { assertSafeWebhookUrl } from './webhook-url';

const MAX_WEBHOOK_DELIVERIES_PER_WORKSPACE = 25;
const WEBHOOK_DELIVERY_CONCURRENCY = 5;
const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_LEASE_MS = 60_000;
const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Six attempts spread over roughly a day: 1m, 5m, 25m, 2h, 6h, 24h. The old
// table (1m, 5m, 15m, 60m, five attempts) covered a one-hour outage; a
// customer whose receiver was down overnight lost every event permanently.
const MAX_WEBHOOK_ATTEMPTS = 6;
const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  25 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];
// Exhausted deliveries keep a replayable dead-letter window before the normal
// retention TTL removes them: long enough to notice an outage after a weekend,
// short enough that a replay cannot resurrect ancient events.
export const WEBHOOK_DEAD_LETTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Endpoint circuit breaker: after this many consecutive failed attempts the
 * endpoint is marked degraded and its queued deliveries back off to one slow
 * probe instead of each retrying on its own clock. Protects our worker as
 * much as their server: the 25-per-tick budget was otherwise entirely
 * consumed by a dead endpoint.
 */
export const WEBHOOK_BREAKER_THRESHOLD = 10;
const WEBHOOK_BREAKER_PROBE_DELAY_MS = 15 * 60_000;
const LEGACY_WEBHOOK_DISCOVERY_UNTIL_MS = Date.parse('2026-08-25T00:00:00.000Z');

function signPayload(secret: string, timestamp: string, body: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function computeNextAttempt(attemptCount: number) {
  const idx = Math.min(Math.max(attemptCount - 1, 0), WEBHOOK_RETRY_DELAYS_MS.length - 1);
  // Jittered over a 50% band so an endpoint that went down under load does
  // not get every queued delivery back at the same instant when it recovers,
  // which is how it goes down a second time.
  const jittered = WEBHOOK_RETRY_DELAYS_MS[idx] * (0.75 + Math.random() * 0.5);
  return new Date(Date.now() + Math.round(jittered)).toISOString();
}

/**
 * Track endpoint-level failure so 500 consecutive failures stop looking like
 * 500 independent ones. Returns true when the endpoint has just tripped or
 * remains tripped. Best-effort: breaker bookkeeping must never fail a
 * delivery write.
 */
async function recordEndpointOutcome(
  workspaceId: string,
  endpointId: string,
  outcome: 'success' | 'failure',
): Promise<void> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`);
  try {
    if (outcome === 'success') {
      // First success restores the endpoint fully.
      await ref.set({
        consecutiveFailures: 0,
        degradedUntil: FieldValue.delete(),
        lastDeliveredAt: new Date().toISOString(),
      }, { merge: true });
      return;
    }
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const failures = (Number(snap.data()?.consecutiveFailures) || 0) + 1;
      tx.set(ref, {
        consecutiveFailures: failures,
        ...(failures >= WEBHOOK_BREAKER_THRESHOLD
          ? { degradedUntil: new Date(Date.now() + WEBHOOK_BREAKER_PROBE_DELAY_MS).toISOString() }
          : {}),
      }, { merge: true });
    });
  } catch (error) {
    logger.warn('webhook endpoint breaker bookkeeping failed', {
      event: 'webhook.breaker_update_failed',
      workspaceId,
      endpointId,
      err: error,
    });
  }
}

async function endpointDegradedUntil(workspaceId: string, endpointId: string): Promise<string | null> {
  try {
    const snap = await adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`).get();
    const value = snap.data()?.degradedUntil;
    return typeof value === 'string' && value > new Date().toISOString() ? value : null;
  } catch {
    return null;
  }
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

    // A tripped breaker defers the whole queue to one slow probe: the first
    // delivery past `degradedUntil` becomes the probe, and its success resets
    // the breaker for the rest. Deferral burns no attempt, so a long outage
    // does not exhaust the retry budget by itself.
    const degradedUntil = await endpointDegradedUntil(workspaceId, claimed.endpointId);
    if (degradedUntil) {
      await doc.ref.set({
        nextAttemptAt: degradedUntil,
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      await markWorkspaceDue(workspaceId, degradedUntil, 'webhook_delivery').catch(() => undefined);
      results.push({ deliveryId: doc.id, status: 'deferred' });
      return;
    }

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
    // During a rotation grace window both secrets sign the same payload, so a
    // receiver that has not yet redeployed keeps verifying. Sent as a separate
    // header rather than appended to the primary one, so a receiver that only
    // reads `X-Markaestro-Signature` is unaffected by the extra value.
    const previousSignature = config.previousSecret
      ? signPayload(config.previousSecret, timestamp, body)
      : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      // Re-check the destination on every attempt, not just at registration:
      // a hostname that resolved publicly when the endpoint was created can
      // resolve to a private address later (DNS rebinding). A throw here lands
      // in the catch below and is recorded as a retryable failure, which is
      // the correct fail-closed behaviour.
      await assertSafeWebhookUrl(config.url);

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Markaestro-Event': String(claimed.payload.type || ''),
          'X-Markaestro-Timestamp': timestamp,
          'X-Markaestro-Signature': signature,
          ...(previousSignature
            ? { 'X-Markaestro-Signature-Previous': previousSignature }
            : {}),
        },
        body,
        // Following a redirect would let a public URL bounce the request into
        // the private network, defeating the check above. Matches media/proxy.
        redirect: 'error',
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
        await recordEndpointOutcome(workspaceId, claimed.endpointId, 'success');
        results.push({ deliveryId: doc.id, status: 'delivered' });
        return;
      }

      if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        // Dead-lettered, not just failed: the payload stays replayable for a
        // week via POST .../replay, because a customer whose endpoint was down
        // for two hours used to lose those events permanently.
        await doc.ref.set({
          status: 'dead_letter',
          responseCode: response.status,
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: `Webhook responded ${response.status}`,
          deadLetteredAt: nowIso,
          expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS + WEBHOOK_DEAD_LETTER_RETENTION_MS),
          deliveryLeaseId: FieldValue.delete(),
          deliveryLeaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        await recordEndpointOutcome(workspaceId, claimed.endpointId, 'failure');
        results.push({ deliveryId: doc.id, status: 'dead_letter' });
        return;
      }

      const nextAttemptAt = computeNextAttempt(attemptCount);
      await doc.ref.set({
        status: 'retrying',
        responseCode: response.status,
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: `Webhook responded ${response.status}`,
        nextAttemptAt,
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      await markWorkspaceDue(workspaceId, nextAttemptAt, 'webhook_delivery').catch((error) => {
        logger.warn('webhook retry due marker failed; compatibility sweep will recover it', {
          event: 'worker.mark_due_failed',
          workspaceId,
          deliveryId: doc.id,
          err: error,
        });
      });
      await recordEndpointOutcome(workspaceId, claimed.endpointId, 'failure');
      results.push({ deliveryId: doc.id, status: 'retrying' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook delivery failed';
      if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        await doc.ref.set({
          status: 'dead_letter',
          attemptCount,
          lastAttemptAt: nowIso,
          lastError: message,
          deadLetteredAt: nowIso,
          expiresAt: new Date(Date.now() + WEBHOOK_RETENTION_MS + WEBHOOK_DEAD_LETTER_RETENTION_MS),
          deliveryLeaseId: FieldValue.delete(),
          deliveryLeaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        await recordEndpointOutcome(workspaceId, claimed.endpointId, 'failure');
        results.push({ deliveryId: doc.id, status: 'dead_letter' });
        return;
      }

      const nextAttemptAt = computeNextAttempt(attemptCount);
      await doc.ref.set({
        status: 'retrying',
        attemptCount,
        lastAttemptAt: nowIso,
        lastError: message,
        nextAttemptAt,
        deliveryLeaseId: FieldValue.delete(),
        deliveryLeaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      await markWorkspaceDue(workspaceId, nextAttemptAt, 'webhook_delivery').catch((markError) => {
        logger.warn('webhook retry due marker failed; compatibility sweep will recover it', {
          event: 'worker.mark_due_failed',
          workspaceId,
          deliveryId: doc.id,
          err: markError,
        });
      });
      await recordEndpointOutcome(workspaceId, claimed.endpointId, 'failure');
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
