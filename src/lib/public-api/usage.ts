import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const PUBLIC_API_STAT_EVENTS = [
  'request',
  'media_upload',
  'post_create',
  'publish_queued',
  'publish_succeeded',
  'publish_action_required',
  'publish_failed',
] as const;

export type PublicApiStatEvent = (typeof PUBLIC_API_STAT_EVENTS)[number];

function currentDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export async function incrementApiClientStat(
  workspaceId: string,
  clientId: string,
  event: PublicApiStatEvent,
  amount = 1,
) {
  const now = new Date().toISOString();
  const dayKey = currentDayKey();
  const monthKey = currentMonthKey();
  const clientRef = adminDb.doc(`workspaces/${workspaceId}/api_clients/${clientId}`);
  const dailyRef = adminDb.doc(`workspaces/${workspaceId}/api_clients/${clientId}/daily_stats/${dayKey}`);

  // These are telemetry counters, not a read-modify-write business invariant.
  // Atomic transforms avoid two reads plus a contention-prone transaction on
  // every API request while preserving the existing document/response shape.
  const batch = adminDb.batch();
  batch.set(clientRef, {
      usage: {
        ...(event === 'request' ? { totalRequests: FieldValue.increment(amount) } : {}),
        currentMonth: monthKey,
        currentMonthCounts: { [event]: FieldValue.increment(amount) },
        ...(event === 'request' ? { lastRequestAt: now } : {}),
        lastActivityAt: now,
      },
      ...(event === 'request' ? { lastUsedAt: now } : {}),
      updatedAt: now,
    }, { merge: true });
  batch.set(dailyRef, {
      date: dayKey,
      counts: { [event]: FieldValue.increment(amount) },
      updatedAt: now,
    }, { merge: true });
  await batch.commit();
}

export async function getApiClientUsage(workspaceId: string, days = 14) {
  const clientsSnap = await adminDb.collection(`workspaces/${workspaceId}/api_clients`).get();
  const now = new Date();
  const dayKeys = Array.from({ length: days }, (_, idx) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1 - idx));
    return date.toISOString().slice(0, 10);
  });

  const clients = await Promise.all(clientsSnap.docs.map(async (doc) => {
    const data = doc.data() as {
      name?: string;
      status?: string;
      archived?: boolean;
      scopes?: string[];
      keyPrefix?: string;
      createdAt?: string;
      lastUsedAt?: string | null;
      productId?: string | null;
      origin?: string;
      usage?: {
        totalRequests?: number;
        currentMonth?: string;
        currentMonthCounts?: Record<string, number>;
        lastRequestAt?: string | null;
        lastActivityAt?: string | null;
      };
    };

    const statsRefs = dayKeys.map((dayKey) => adminDb.doc(`workspaces/${workspaceId}/api_clients/${doc.id}/daily_stats/${dayKey}`));
    const statSnaps = await adminDb.getAll(...statsRefs);
    const trend = statSnaps.map((snap, index) => {
      const counts = (snap.data()?.counts || {}) as Record<string, number>;
      return {
        date: dayKeys[index],
        label: dayKeys[index].slice(5),
        requests: counts.request || 0,
        queued: counts.publish_queued || 0,
        succeeded: counts.publish_succeeded || 0,
        actionRequired: (counts.publish_action_required || 0) + (counts.publish_exported_for_review || 0),
        failed: counts.publish_failed || 0,
      };
    });

    return {
      id: doc.id,
      name: data.name || doc.id,
      status: data.status || 'revoked',
      archived: data.archived === true,
      scopes: data.scopes || [],
      keyPrefix: data.keyPrefix || '',
      createdAt: data.createdAt || '',
      lastUsedAt: data.lastUsedAt || data.usage?.lastRequestAt || null,
      productId: data.productId || null,
      origin: data.origin === 'oauth' ? 'oauth' : 'manual',
      usage: {
        totalRequests: data.usage?.totalRequests || 0,
        currentMonth: data.usage?.currentMonth || currentMonthKey(),
        currentMonthCounts: data.usage?.currentMonthCounts || {},
      },
      trend,
    };
  }));
  clients.sort((a, b) => {
    const diff = (b.usage.currentMonthCounts.request || 0) - (a.usage.currentMonthCounts.request || 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  const totals = clients.reduce((acc, client) => {
    acc.totalRequests += client.usage.totalRequests || 0;
    acc.currentMonthRequests += client.usage.currentMonthCounts.request || 0;
    acc.publishQueued += client.usage.currentMonthCounts.publish_queued || 0;
    acc.publishSucceeded += client.usage.currentMonthCounts.publish_succeeded || 0;
    acc.publishActionRequired += (client.usage.currentMonthCounts.publish_action_required || 0) + (client.usage.currentMonthCounts.publish_exported_for_review || 0);
    acc.publishFailed += client.usage.currentMonthCounts.publish_failed || 0;
    return acc;
  }, {
    totalRequests: 0,
    currentMonthRequests: 0,
    publishQueued: 0,
    publishSucceeded: 0,
    publishActionRequired: 0,
    publishFailed: 0,
  });

  return {
    clients,
    totals,
    days: dayKeys,
  };
}
