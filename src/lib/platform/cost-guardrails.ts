import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function providerUsageRef(workspaceId: string, provider: string, now = new Date()) {
  return adminDb.doc(`workspaces/${workspaceId}/providerUsage/${monthKey(now)}_${provider}`);
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
}) {
  const now = new Date();
  const ref = providerUsageRef(input.workspaceId, input.provider, now);
  const amount = Math.max(0, input.estimatedCostUsd);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const spent = Number(snap.data()?.estimatedCostUsd) || 0;
    if (
      input.hardBudgetUsd != null
      && Number.isFinite(input.hardBudgetUsd)
      && input.hardBudgetUsd >= 0
      && spent + amount > input.hardBudgetUsd
    ) {
      throw new Error('CHANNEL_BILLING_ACTION_REQUIRED');
    }
    tx.set(ref, {
      provider: input.provider,
      month: monthKey(now),
      requests: FieldValue.increment(1),
      estimatedCostUsd: FieldValue.increment(amount),
      [`operations.${input.operation}.requests`]: FieldValue.increment(1),
      [`operations.${input.operation}.estimatedCostUsd`]: FieldValue.increment(amount),
      updatedAt: now.toISOString(),
    }, { merge: true });
  });
}

export function xWriteCostUsd(content: string): number {
  const basic = Number(process.env.X_API_BASIC_WRITE_COST_USD || '0.015');
  const withUrl = Number(process.env.X_API_URL_WRITE_COST_USD || '0.2');
  return /https?:\/\//i.test(content) ? withUrl : basic;
}

export function xReadCostUsd(resources = 1): number {
  return Number(process.env.X_API_READ_COST_USD || '0.005') * Math.max(0, resources);
}

export function xUserReadCostUsd(resources = 1): number {
  return Number(process.env.X_API_USER_READ_COST_USD || '0.01') * Math.max(0, resources);
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
