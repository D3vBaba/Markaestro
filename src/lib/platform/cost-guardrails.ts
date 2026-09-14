import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

const PROVIDER_USAGE_DEDUPE_RETENTION_MS = 35 * 24 * 60 * 60_000;

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function providerUsageRef(workspaceId: string, provider: string, now = new Date()) {
  return adminDb.doc(`workspaces/${workspaceId}/providerUsage/${monthKey(now)}_${provider}`);
}

function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function providerUsageDedupeRef(
  workspaceId: string,
  provider: string,
  dedupeKey: string,
  now = new Date(),
) {
  const digest = createHash('sha256').update(dedupeKey).digest('hex');
  return adminDb.doc(`workspaces/${workspaceId}/providerUsageDedupe/${dayKey(now)}_${provider}_${digest}`);
}

export async function assertProviderBudget(
  workspaceId: string,
  provider: string,
  hardBudgetUsd: number | null,
): Promise<void> {
  if (hardBudgetUsd == null || !Number.isFinite(hardBudgetUsd) || hardBudgetUsd < 0) return;
  const snap = await providerUsageRef(workspaceId, provider).get();
  const spent = Number(snap.data()?.estimatedCostUsd) || 0;
  if (spent >= hardBudgetUsd) throw new Error('CHANNEL_BILLING_ACTION_REQUIRED');
}

export async function recordProviderUsage(input: {
  workspaceId: string;
  provider: string;
  operation: string;
  estimatedCostUsd: number;
  queueId?: string;
}) {
  const now = new Date();
  const ref = providerUsageRef(input.workspaceId, input.provider, now);
  await ref.set({
    provider: input.provider,
    month: monthKey(now),
    requests: FieldValue.increment(1),
    estimatedCostUsd: FieldValue.increment(Math.max(0, input.estimatedCostUsd)),
    [`operations.${input.operation}.requests`]: FieldValue.increment(1),
    [`operations.${input.operation}.estimatedCostUsd`]: FieldValue.increment(Math.max(0, input.estimatedCostUsd)),
    updatedAt: now.toISOString(),
  }, { merge: true });
}

/**
 * Atomically reserve paid provider usage before opening a provider socket.
 * Concurrent workers cannot both observe the same remaining budget and spend
 * through it. Reservations are intentionally conservative: a provider can
 * charge for a rejected request, so failures are not refunded automatically.
 */
export async function reserveProviderUsage(input: {
  workspaceId: string;
  provider: string;
  operation: string;
  estimatedCostUsd: number;
  hardBudgetUsd: number | null;
  /** Provider resource key when repeated reads are billed once per UTC day. */
  dailyDedupeKey?: string;
}) {
  const now = new Date();
  const ref = providerUsageRef(input.workspaceId, input.provider, now);
  const amount = Math.max(0, input.estimatedCostUsd);
  const dedupeRef = input.dailyDedupeKey
    ? providerUsageDedupeRef(input.workspaceId, input.provider, input.dailyDedupeKey, now)
    : null;
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const dedupeSnap = dedupeRef ? await tx.get(dedupeRef) : null;
    const spent = Number(snap.data()?.estimatedCostUsd) || 0;
    // X bills the same Post resource once per UTC day even when it is read
    // through several queries. Keep request volume, but reserve spend once.
    const chargedAmount = dedupeSnap?.exists ? 0 : amount;
    if (
      input.hardBudgetUsd != null
      && Number.isFinite(input.hardBudgetUsd)
      && input.hardBudgetUsd >= 0
      && spent + chargedAmount > input.hardBudgetUsd
    ) {
      throw new Error('CHANNEL_BILLING_ACTION_REQUIRED');
    }
    tx.set(ref, {
      provider: input.provider,
      month: monthKey(now),
      requests: FieldValue.increment(1),
      estimatedCostUsd: FieldValue.increment(chargedAmount),
      [`operations.${input.operation}.requests`]: FieldValue.increment(1),
      [`operations.${input.operation}.estimatedCostUsd`]: FieldValue.increment(chargedAmount),
      updatedAt: now.toISOString(),
    }, { merge: true });
    if (dedupeRef && !dedupeSnap?.exists) {
      tx.create(dedupeRef, {
        provider: input.provider,
        day: dayKey(now),
        estimatedCostUsd: amount,
        createdAt: now.toISOString(),
        expiresAt: Timestamp.fromMillis(now.getTime() + PROVIDER_USAGE_DEDUPE_RETENTION_MS),
      });
    }
  });
  return now;
}

export function xWriteCostUsd(content: string): number {
  const basic = Number(process.env.X_API_BASIC_WRITE_COST_USD || '0.015');
  const withUrl = Number(process.env.X_API_URL_WRITE_COST_USD || '0.2');
  return /https?:\/\//i.test(content) ? withUrl : basic;
}

export function xReadCostUsd(resources = 1): number {
  return Number(process.env.X_API_READ_COST_USD || '0.001') * Math.max(0, resources);
}

export function xUserReadCostUsd(resources = 1): number {
  return Number(process.env.X_API_USER_READ_COST_USD || '0.001') * Math.max(0, resources);
}

export function xDeleteCostUsd(): number {
  return Number(process.env.X_API_DELETE_COST_USD || '0.01');
}

export function xWorkspaceHardBudgetUsd(): number | null {
  const value = process.env.X_API_WORKSPACE_HARD_BUDGET_USD;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Page reads settle at most one page of resources; X caps a page at 100. */
const MAX_SETTLED_RESOURCES = 100;

/**
 * Reconcile a reservation against the resources a provider actually billed.
 *
 * A page read cannot know its resource count before the response, so it
 * reserves the requested page size up front — the budget guarantee holds
 * while the socket is open — and settles here against what came back. X
 * bills per resource returned, so a server-side filtered request that
 * matched nothing costs nothing. Settlement reuses the same daily markers as
 * single-resource reads, so a Post already charged today settles to zero,
 * mirroring X's 24h UTC deduplication.
 */
export async function settleProviderUsage(input: {
  workspaceId: string;
  provider: string;
  operation: string;
  reservedCostUsd: number;
  /** Keep settlement in the same billing day/month as its reservation. */
  reservedAt: Date;
  unitCostUsd: number;
  resourceKeys: readonly string[];
}): Promise<void> {
  const now = new Date();
  const reserved = Math.max(0, input.reservedCostUsd);
  const unit = Math.max(0, input.unitCostUsd);
  const keys = [...new Set(input.resourceKeys)].slice(0, MAX_SETTLED_RESOURCES);
  const usageRef = providerUsageRef(input.workspaceId, input.provider, input.reservedAt);
  const dedupeRefs = keys.map((key) => providerUsageDedupeRef(input.workspaceId, input.provider, key, input.reservedAt));
  await adminDb.runTransaction(async (tx) => {
    const snaps = dedupeRefs.length > 0 ? await tx.getAll(...dedupeRefs) : [];
    const unbilled = snaps.filter((snap) => !snap.exists);
    const delta = unit * unbilled.length - reserved;
    if (delta !== 0) {
      tx.set(usageRef, {
        estimatedCostUsd: FieldValue.increment(delta),
        [`operations.${input.operation}.estimatedCostUsd`]: FieldValue.increment(delta),
        updatedAt: now.toISOString(),
      }, { merge: true });
    }
    for (const snap of unbilled) {
      tx.create(snap.ref, {
        provider: input.provider,
        day: dayKey(input.reservedAt),
        estimatedCostUsd: unit,
        createdAt: now.toISOString(),
        expiresAt: Timestamp.fromMillis(now.getTime() + PROVIDER_USAGE_DEDUPE_RETENTION_MS),
      });
    }
  });
}
