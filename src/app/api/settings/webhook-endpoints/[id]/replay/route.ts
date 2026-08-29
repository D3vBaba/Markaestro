import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { apiError, apiOk } from '@/lib/api-response';
import { requireContext } from '@/lib/server-auth';
import { requireAdmin } from '@/lib/rbac';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { markWorkspaceDue } from '@/lib/workers/due-workspaces';

export const runtime = 'nodejs';

const MAX_REPLAY_BATCH = 50;
const REPLAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  /** Specific dead-lettered deliveries to requeue. Omit to requeue all. */
  deliveryIds: z.array(z.string().trim().min(1).max(200)).max(MAX_REPLAY_BATCH).optional(),
});

/**
 * Requeue dead-lettered deliveries for one endpoint.
 *
 * This is the endpoint customers ask for after their first outage: retries
 * used to exhaust and the events were simply gone. A replay resets the
 * attempt counter, because the failures it burned belong to the outage the
 * customer has since fixed, not to the payload.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req);
    requireAdmin(ctx);
    await applyRateLimit(req, RATE_LIMITS.api, { key: `webhook-replay:${ctx.workspaceId}` });
    const { id } = await params;
    const input = bodySchema.parse(await req.json().catch(() => ({})));

    const endpointSnap = await adminDb.doc(`workspaces/${ctx.workspaceId}/webhook_endpoints/${id}`).get();
    if (!endpointSnap.exists) throw new Error('NOT_FOUND');
    if (endpointSnap.data()?.status !== 'active') throw new Error('WEBHOOK_ENDPOINT_DISABLED');

    const collection = adminDb.collection(`workspaces/${ctx.workspaceId}/webhook_deliveries`);
    let docs: FirebaseFirestore.DocumentSnapshot[];
    if (input.deliveryIds?.length) {
      docs = await Promise.all(input.deliveryIds.map((deliveryId) => collection.doc(deliveryId).get()));
    } else {
      const snapshot = await collection
        .where('endpointId', '==', id)
        .where('status', '==', 'dead_letter')
        .limit(MAX_REPLAY_BATCH)
        .get();
      docs = snapshot.docs;
    }

    const now = new Date().toISOString();
    const replayed: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const batch = adminDb.batch();

    for (const doc of docs) {
      if (!doc.exists) {
        skipped.push({ id: doc.id, reason: 'NOT_FOUND' });
        continue;
      }
      const data = doc.data() as { status?: string; endpointId?: string };
      if (data.endpointId !== id) {
        // Ids are caller-supplied; a delivery belonging to another endpoint is
        // reported rather than silently replayed against the wrong receiver.
        skipped.push({ id: doc.id, reason: 'WRONG_ENDPOINT' });
        continue;
      }
      if (data.status !== 'dead_letter' && data.status !== 'failed') {
        skipped.push({ id: doc.id, reason: 'NOT_REPLAYABLE' });
        continue;
      }
      batch.set(doc.ref, {
        status: 'pending',
        attemptCount: 0,
        lastError: '',
        nextAttemptAt: now,
        replayedAt: now,
        replayedBy: ctx.uid,
        deadLetteredAt: FieldValue.delete(),
        expiresAt: Timestamp.fromMillis(Date.now() + REPLAY_RETENTION_MS),
      }, { merge: true });
      replayed.push(doc.id);
    }

    if (replayed.length > 0) {
      // A replay is a deliberate act, so also clear the breaker: the operator
      // is telling us the receiver is back.
      batch.set(endpointSnap.ref, {
        consecutiveFailures: 0,
        degradedUntil: FieldValue.delete(),
      }, { merge: true });
      await batch.commit();
      await markWorkspaceDue(ctx.workspaceId, now, 'webhook_delivery').catch(() => undefined);
    }

    return apiOk({ replayed, skipped, count: replayed.length });
  } catch (error) {
    return apiError(error);
  }
}
