import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { PLATFORM_CAPABILITY_REGISTRY } from './capabilities';

const QUARTER_MS = 90 * 24 * 60 * 60_000;

/**
 * Creates an operations review record once per quarter. This intentionally
 * does not scrape vendor docs: an operator verifies approvals, versions,
 * scopes and sunset dates against the linked official sources.
 */
export async function runQuarterlyCapabilityAuditIfDue(now = new Date()): Promise<boolean> {
  const scheduleRef = adminDb.doc('_platformCapabilityAuditSchedules/quarterly');
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(scheduleRef);
    const due = snapshot.data()?.nextRunAt;
    const dueMs = due instanceof Timestamp ? due.toMillis() : Date.parse(String(due || ''));
    if (Number.isFinite(dueMs) && dueMs > now.getTime()) return false;
    tx.set(scheduleRef, {
      lastRunAt: now.toISOString(),
      nextRunAt: Timestamp.fromMillis(now.getTime() + QUARTER_MS),
    }, { merge: true });
    return true;
  });
  if (!claimed) return false;

  const id = `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const platforms = Object.values(PLATFORM_CAPABILITY_REGISTRY).map((contract) => ({
    platform: contract.platform,
    apiProduct: contract.apiProduct,
    apiVersion: contract.apiVersion,
    approvalStatus: contract.approval.status,
    requiredScopes: contract.requiredScopes,
    docsUrl: contract.approval.docsUrl,
    previousAuditAt: contract.approval.lastAuditedAt,
    sunsetAt: contract.approval.sunsetAt,
    // The audit record used to omit the publishing block entirely, so an
    // operator reviewing platform contracts saw the approval and metrics
    // halves and had no way to notice that the publishing half had drifted.
    publishing: contract.publishing,
  }));
  await adminDb.doc(`_platformCapabilityAudits/${id}`).set({
    id,
    status: 'review_required',
    platforms,
    createdAt: now.toISOString(),
  });
  for (const platform of platforms) {
    if (platform.sunsetAt && Date.parse(platform.sunsetAt) - now.getTime() < QUARTER_MS) {
      logger.critical('platform API version sunset approaching', { event: 'platform.capability_sunset', platform: platform.platform, apiVersion: platform.apiVersion, sunsetAt: platform.sunsetAt });
    }
  }
  logger.warn('quarterly platform capability audit requires review', { event: 'platform.capability_audit_due', auditId: id, platforms: platforms.length });
  return true;
}
