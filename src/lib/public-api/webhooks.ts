import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { decrypt } from '@/lib/crypto';
import { buildWebhookSecret } from './keys';
import type { PublicWebhookEvent } from './scopes';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';
import { logger } from '@/lib/logger';
import { assertSafeWebhookUrl } from './webhook-url';
import { executeListQueryPage } from '@/lib/firestore-list-query';

const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a rotated webhook secret keeps signing alongside its replacement.
 *
 * A rotate that invalidates the old secret the instant it is issued breaks
 * every delivery until the customer has redeployed their receiver, which makes
 * rotation something people avoid doing. During the window both signatures are
 * sent (`X-Markaestro-Signature` carries the new one, and the previous one is
 * appended), so a receiver that still holds the old secret keeps verifying
 * while it rolls out the new one.
 */
export const WEBHOOK_SECRET_GRACE_MS = 24 * 60 * 60 * 1000;
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
  // Reject private, loopback, and metadata targets before the endpoint is
  // stored, so a blocked URL never reaches the delivery worker at all.
  await assertSafeWebhookUrl(input.url);

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

/**
 * Endpoints for the settings list.
 *
 * "Delete" is a soft disable, so an unfiltered listing accumulates tombstones
 * the customer cannot act on. Active-only is the useful default;
 * `includeDisabled` is what the "show disabled" affordance passes so a
 * disabled endpoint can be found and re-enabled.
 */
export async function listWebhookEndpoints(
  workspaceId: string,
  options: { includeDisabled?: boolean } = {},
) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/webhook_endpoints`).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        url: data.url,
        events: data.events || [],
        status: data.status || 'disabled',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        rotatedAt: data.rotatedAt ?? null,
        // Surfaced so the UI can tell the customer how long their old secret
        // keeps working, rather than leaving them to guess.
        previousSecretExpiresAt: data.previousSecretExpiresAt ?? null,
      };
    })
    .filter((endpoint) => options.includeDisabled || endpoint.status === 'active');
}

export type UpdateWebhookEndpointInput = {
  url?: string;
  events?: PublicWebhookEvent[];
  status?: 'active' | 'disabled';
};

/**
 * Update a webhook endpoint in place.
 *
 * Before this existed, changing a URL or an event list meant delete-then-
 * recreate, which minted a new signing secret as a side effect: an edit that
 * silently invalidated the customer's receiver. The secret is untouched here.
 * A changed URL re-runs the SSRF guard, because an endpoint edited to point at
 * a private address is exactly as dangerous as one created that way.
 */
export async function updateWebhookEndpoint(
  workspaceId: string,
  endpointId: string,
  input: UpdateWebhookEndpointInput,
) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const current = snap.data() as Record<string, unknown>;

  if (input.url && input.url !== current.url) {
    await assertSafeWebhookUrl(input.url);
  }

  // Re-enabling has to respect the same cap as creating, or the limit is
  // trivially bypassed by disabling and re-enabling in a loop.
  if (input.status === 'active' && current.status !== 'active') {
    const active = await adminDb
      .collection(`workspaces/${workspaceId}/webhook_endpoints`)
      .where('status', '==', 'active')
      .limit(MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE)
      .get();
    if (active.size >= MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE) {
      throw new Error('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.url !== undefined) patch.url = input.url;
  if (input.events !== undefined) patch.events = input.events;
  if (input.status !== undefined) patch.status = input.status;

  await ref.set(patch, { merge: true });

  return {
    id: endpointId,
    url: (patch.url ?? current.url) as string,
    events: (patch.events ?? current.events ?? []) as PublicWebhookEvent[],
    status: (patch.status ?? current.status ?? 'disabled') as string,
    createdAt: (current.createdAt ?? null) as string | null,
    updatedAt: now,
  };
}

/**
 * Mint a new signing secret, returned once and never again.
 *
 * The outgoing secret keeps signing for {@link WEBHOOK_SECRET_GRACE_MS} so the
 * customer can roll their receiver over without dropping deliveries. Mirrors
 * `api-clients/[id]/rotate` in shape; that route has no grace window and
 * should get one (see the plan's note on backporting).
 */
export async function rotateWebhookEndpointSecret(workspaceId: string, endpointId: string) {
  const ref = adminDb.doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('NOT_FOUND');
  const current = snap.data() as Record<string, unknown>;
  if (current.status !== 'active') throw new Error('WEBHOOK_ENDPOINT_DISABLED');

  const secret = buildWebhookSecret();
  const now = new Date().toISOString();
  const previousSecretExpiresAt = new Date(Date.now() + WEBHOOK_SECRET_GRACE_MS).toISOString();

  await ref.set({
    secretHash: secret.secretHash,
    secretEncrypted: secret.secretEncrypted,
    // Carrying the *encrypted* previous secret, not the plaintext: the grace
    // window must not turn the endpoint document into a place where a
    // readable secret sits for a day.
    previousSecretEncrypted: current.secretEncrypted ?? null,
    previousSecretExpiresAt: current.secretEncrypted ? previousSecretExpiresAt : null,
    rotatedAt: now,
    updatedAt: now,
  }, { merge: true });

  return {
    id: endpointId,
    url: (current.url ?? '') as string,
    events: (current.events ?? []) as PublicWebhookEvent[],
    status: 'active',
    secret: secret.secret,
    rotatedAt: now,
    previousSecretExpiresAt: current.secretEncrypted ? previousSecretExpiresAt : null,
  };
}

/**
 * Provider response bodies are diagnostic data, not presentation strings, and
 * `lastError` can hold an entire HTML error page. Same discipline as
 * `userMessage`: enough to recognize the failure, never the whole body.
 */
const MAX_LAST_ERROR_LENGTH = 300;

function truncateLastError(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_LAST_ERROR_LENGTH
    ? `${trimmed.slice(0, MAX_LAST_ERROR_LENGTH)}…`
    : trimmed;
}

export type WebhookDeliverySummary = {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseCode: number | null;
  lastError: string;
  createdAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
};

/**
 * Delivery history for one endpoint, newest first.
 *
 * Attempts, response codes, retry state, and `lastError` were all being
 * recorded and none of it was exposed, so a customer whose endpoint had been
 * 500-ing for a week had no way to find that out. Deliberately does NOT return
 * the payload: it is already available to the endpoint owner at their own
 * receiver, and echoing it back turns this into a second copy of their data.
 */
export async function listWebhookDeliveries(
  workspaceId: string,
  endpointId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ deliveries: WebhookDeliverySummary[]; nextCursor: string | null }> {
  const endpoint = await adminDb
    .doc(`workspaces/${workspaceId}/webhook_endpoints/${endpointId}`)
    .get();
  if (!endpoint.exists) throw new Error('NOT_FOUND');

  const page = await executeListQueryPage<Record<string, unknown>>(
    adminDb.collection(`workspaces/${workspaceId}/webhook_deliveries`),
    {
      filters: [{ field: 'endpointId', op: '==', value: endpointId }],
      orderByField: 'createdAt',
      orderByDirection: 'desc',
      limit: Math.min(Math.max(options.limit ?? 25, 1), 100),
      cursor: options.cursor,
    },
  );

  return {
    deliveries: page.items.map((item) => ({
      id: String(item.id),
      eventType: typeof item.eventType === 'string' ? item.eventType : 'unknown',
      status: typeof item.status === 'string' ? item.status : 'unknown',
      attemptCount: Number(item.attemptCount) || 0,
      responseCode: typeof item.responseCode === 'number' ? item.responseCode : null,
      lastError: truncateLastError(item.lastError),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
      lastAttemptAt: typeof item.lastAttemptAt === 'string' ? item.lastAttemptAt : null,
      nextAttemptAt: typeof item.nextAttemptAt === 'string' ? item.nextAttemptAt : null,
    })),
    nextCursor: page.nextCursor,
  };
}

export type WebhookEndpointHealth = {
  endpointId: string;
  delivered24h: number;
  failed24h: number;
  pending: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

/** How many deliveries the rolling health summary reads per endpoint. */
const HEALTH_WINDOW_HOURS = 24;
const HEALTH_SCAN_LIMIT = 200;

/**
 * A 24-hour delivered/failed count per endpoint, so the settings list can show
 * a red endpoint without a click.
 *
 * Bounded to the most recent {@link HEALTH_SCAN_LIMIT} deliveries per
 * endpoint: this is a cold settings read, and an endpoint busy enough to
 * exceed that in a day is unambiguously healthy or unambiguously broken well
 * inside the window.
 */
export async function summarizeWebhookEndpointHealth(
  workspaceId: string,
  endpointIds: string[],
  now = new Date(),
): Promise<Record<string, WebhookEndpointHealth>> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_HOURS * 60 * 60_000).toISOString();
  const summaries: Record<string, WebhookEndpointHealth> = {};

  await Promise.all(endpointIds.map(async (endpointId) => {
    const summary: WebhookEndpointHealth = {
      endpointId,
      delivered24h: 0,
      failed24h: 0,
      pending: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
    summaries[endpointId] = summary;

    try {
      const snapshot = await adminDb
        .collection(`workspaces/${workspaceId}/webhook_deliveries`)
        .where('endpointId', '==', endpointId)
        .orderBy('createdAt', 'desc')
        .limit(HEALTH_SCAN_LIMIT)
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const status = typeof data.status === 'string' ? data.status : '';
        const lastAttemptAt = typeof data.lastAttemptAt === 'string' ? data.lastAttemptAt : null;
        const createdAt = typeof data.createdAt === 'string' ? data.createdAt : null;
        const at = lastAttemptAt || createdAt;

        if (status === 'pending' || status === 'retrying') summary.pending += 1;
        if (status === 'delivered') {
          if (at && at >= since) summary.delivered24h += 1;
          if (at && (!summary.lastSuccessAt || at > summary.lastSuccessAt)) summary.lastSuccessAt = at;
        }
        if (status === 'failed' || status === 'dead_letter') {
          if (at && at >= since) summary.failed24h += 1;
          if (at && (!summary.lastFailureAt || at > summary.lastFailureAt)) summary.lastFailureAt = at;
        }
      }
    } catch (error) {
      // A health summary that cannot be computed must not take the settings
      // page down with it. Zeroes plus a log beats a 500.
      logger.warn('webhook endpoint health summary failed', {
        event: 'webhook.health_summary_failed',
        workspaceId,
        endpointId,
        err: error,
      });
    }
  }));

  return summaries;
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
  const data = snap.data() ?? {};
  if (data.status !== 'active') throw new Error('WEBHOOK_ENDPOINT_DISABLED');
  const secretEncrypted = data.secretEncrypted as string | undefined;
  if (!secretEncrypted) throw new Error('NOT_FOUND');
  const url = data.url as string | undefined;
  if (!url) throw new Error('NOT_FOUND');

  // Inside the rotation grace window the previous secret still signs, so a
  // receiver mid-rollout can verify with either. Expired or absent, it is
  // simply not returned and only the current secret is used.
  const previousEncrypted = data.previousSecretEncrypted as string | undefined;
  const previousExpiresAt = data.previousSecretExpiresAt as string | undefined;
  const previousStillValid = Boolean(
    previousEncrypted && previousExpiresAt && Date.parse(previousExpiresAt) > Date.now(),
  );

  return {
    url,
    secret: decrypt(secretEncrypted),
    previousSecret: previousStillValid ? decrypt(previousEncrypted as string) : undefined,
  };
}
