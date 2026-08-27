import crypto from 'crypto';
import { CloudTasksClient } from '@google-cloud/tasks';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

const DUE_COLLECTION = 'worker_due_workspaces';
const DISPATCH_LEASE_MS = 10 * 60_000;

export type WorkspaceWorkReason =
  | 'scheduled_post'
  | 'publish_run'
  | 'webhook_delivery'
  | 'analytics'
  | 'intelligence_job'
  | 'daily_job'
  | 'experiment_close'
  | 'legacy_sweep';

export type DueWorkspaceClaim = {
  workspaceId: string;
  version: number;
  leaseId: string;
  source: 'due';
};

export type LegacyWorkspaceDispatch = {
  workspaceId: string;
  source: 'legacy';
};

export type WorkspaceDispatch = DueWorkspaceClaim | LegacyWorkspaceDispatch;

function valueMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function dueMillis(value: Date | string | number): number {
  const millis = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('VALIDATION_INVALID_WORKER_DUE_AT');
  return millis;
}

/**
 * Mark a workspace for background processing. The earliest due time wins and
 * every write increments `version`, allowing a task to avoid deleting work
 * that arrived while it was running.
 */
export async function markWorkspaceDue(
  workspaceId: string,
  dueAt: Date | string | number,
  reason: WorkspaceWorkReason,
): Promise<void> {
  const ref = adminDb.doc(`${DUE_COLLECTION}/${workspaceId}`);
  const requestedMs = dueMillis(dueAt);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const existingMs = valueMillis(data.nextDueAt);
    const pendingMs = valueMillis(data.pendingNextDueAt);
    const claimIsActive = valueMillis(data.dispatchLeaseUntil) > Date.now();

    // Do not merge work discovered during an active dispatch into the claimed
    // timestamp. That timestamp has already been consumed and is commonly in
    // the past. Keeping it as the minimum would make completion retain the old
    // value and dispatch the same workspace on every scheduler tick forever.
    // Instead, accumulate the earliest follow-up separately; completion
    // promotes it after the current claim has finished.
    const dueUpdate = claimIsActive
      ? {
          pendingNextDueAt: Timestamp.fromMillis(
            pendingMs > 0 ? Math.min(pendingMs, requestedMs) : requestedMs,
          ),
        }
      : {
          nextDueAt: Timestamp.fromMillis(
            existingMs > 0 ? Math.min(existingMs, requestedMs) : requestedMs,
          ),
        };

    tx.set(ref, {
      workspaceId,
      ...dueUpdate,
      version: (Number(data.version) || 0) + 1,
      reasons: FieldValue.arrayUnion(reason),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

/** Claim due records with an expiring dispatch lease. */
export async function claimDueWorkspaces(limit = 50): Promise<DueWorkspaceClaim[]> {
  const now = Date.now();
  const snap = await adminDb.collection(DUE_COLLECTION)
    .where('nextDueAt', '<=', Timestamp.fromMillis(now))
    .orderBy('nextDueAt', 'asc')
    .limit(Math.max(limit * 3, limit))
    .get();
  const claims: DueWorkspaceClaim[] = [];

  for (const doc of snap.docs) {
    if (claims.length >= limit) break;
    const claim = await adminDb.runTransaction(async (tx) => {
      const current = await tx.get(doc.ref);
      if (!current.exists) return null;
      const data = current.data() || {};
      if (valueMillis(data.nextDueAt) > now) return null;
      if (valueMillis(data.dispatchLeaseUntil) > now) return null;
      const leaseId = crypto.randomUUID();
      const version = Number(data.version) || 0;
      tx.set(doc.ref, {
        dispatchLeaseId: leaseId,
        dispatchLeaseUntil: Timestamp.fromMillis(now + DISPATCH_LEASE_MS),
        lastDispatchedAt: new Date(now).toISOString(),
      }, { merge: true });
      return {
        workspaceId: doc.id,
        version,
        leaseId,
        source: 'due' as const,
      };
    });
    if (claim) claims.push(claim);
  }
  return claims;
}

/**
 * Delete the queue record only if no writer added or advanced work while the
 * task ran. A changed version is retained and becomes eligible immediately.
 */
export async function completeWorkspaceDue(claim: DueWorkspaceClaim): Promise<void> {
  const ref = adminDb.doc(`${DUE_COLLECTION}/${claim.workspaceId}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (data.dispatchLeaseId !== claim.leaseId) return;
    const pendingMs = valueMillis(data.pendingNextDueAt);

    if (pendingMs > 0) {
      tx.set(ref, {
        nextDueAt: Timestamp.fromMillis(pendingMs),
        pendingNextDueAt: FieldValue.delete(),
        dispatchLeaseId: FieldValue.delete(),
        dispatchLeaseUntil: FieldValue.delete(),
      }, { merge: true });
      return;
    }

    if ((Number(data.version) || 0) === claim.version) {
      tx.delete(ref);
      return;
    }
    tx.set(ref, {
      dispatchLeaseId: FieldValue.delete(),
      dispatchLeaseUntil: FieldValue.delete(),
    }, { merge: true });
  });
}

export async function releaseWorkspaceDueClaim(
  claim: DueWorkspaceClaim,
  retryAt = Date.now() + 60_000,
): Promise<void> {
  const ref = adminDb.doc(`${DUE_COLLECTION}/${claim.workspaceId}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.dispatchLeaseId !== claim.leaseId) return;
    const currentDue = valueMillis(snap.data()?.nextDueAt);
    tx.set(ref, {
      nextDueAt: Timestamp.fromMillis(currentDue > 0 ? Math.min(currentDue, retryAt) : retryAt),
      dispatchLeaseId: FieldValue.delete(),
      dispatchLeaseUntil: FieldValue.delete(),
    }, { merge: true });
  });
}

/** Persistent gate for low-frequency compatibility/global phases. */
export async function claimPeriodicWorkerPhase(name: string, intervalMs: number): Promise<boolean> {
  const ref = adminDb.doc(`_workerSchedules/${name}`);
  const now = Date.now();
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && valueMillis(snap.data()?.nextRunAt) > now) return false;
    tx.set(ref, {
      lastRunAt: new Date(now).toISOString(),
      nextRunAt: Timestamp.fromMillis(now + intervalMs),
    }, { merge: true });
    return true;
  });
}

let tasksClient: CloudTasksClient | null = null;

export function cloudTasksDispatchEnabled(): boolean {
  return process.env.WORKER_CLOUD_TASKS_ENABLED === '1'
    && Boolean(process.env.WORKER_TASKS_QUEUE)
    && Boolean(process.env.WORKER_TASKS_TARGET_ORIGIN);
}

export async function enqueueWorkspaceTask(dispatch: WorkspaceDispatch): Promise<string> {
  const project = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const location = process.env.WORKER_TASKS_LOCATION || 'us-central1';
  const queue = process.env.WORKER_TASKS_QUEUE || '';
  const targetOrigin = (process.env.WORKER_TASKS_TARGET_ORIGIN || '').replace(/\/$/, '');
  const workerSecret = process.env.WORKER_SECRET || '';
  if (!project || !queue || !targetOrigin || !workerSecret) {
    throw new Error('WORKER_CLOUD_TASKS_NOT_CONFIGURED');
  }

  tasksClient ||= new CloudTasksClient();
  const parent = tasksClient.queuePath(project, location, queue);
  const body = Buffer.from(JSON.stringify(dispatch)).toString('base64');
  const [task] = await tasksClient.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${targetOrigin}/api/worker/workspace/${encodeURIComponent(dispatch.workspaceId)}`,
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': workerSecret,
        },
        body,
      },
      dispatchDeadline: { seconds: 300 },
    },
  });
  return task.name || '';
}
