import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_LEASE_MS = 10 * 60 * 1000;
// Old records live for only 24h. Keep replay compatibility through the rollout,
// then automatically remove the extra legacy lookup from the hot path.
const LEGACY_IDEMPOTENCY_READ_UNTIL_MS = Date.parse('2026-08-25T00:00:00.000Z');

export function getIdempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key')?.trim();
  if (key && (key.length > 500 || /[\u0000-\u001f\u007f]/.test(key))) {
    throw new Error('VALIDATION_IDEMPOTENCY_KEY_INVALID');
  }
  return key || null;
}

export function createRequestHash(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function createRequestHashParts(inputs: Array<string | Buffer>): string {
  const hash = crypto.createHash('sha256');
  for (const input of inputs) hash.update(input);
  return hash.digest('hex');
}

function idempotencyDocId(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function timestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function responseFromData(data: {
  responseStatus?: number;
  responseBody?: unknown;
}): Response {
  return Response.json(data.responseBody ?? {}, { status: data.responseStatus || 200 });
}

export async function loadIdempotentResponse(
  workspaceId: string,
  key: string,
  requestHash: string,
): Promise<Response | null> {
  type IdempotencyData = {
    requestHash?: string;
    responseStatus?: number;
    responseBody?: unknown;
    status?: string;
    leaseExpiresAt?: unknown;
  };

  // For one retention window after rollout, replay records written by the old
  // raw-key implementation. New records always use a fixed-length hash so a
  // caller-controlled key can never alter the Firestore document path.
  if (Date.now() < LEGACY_IDEMPOTENCY_READ_UNTIL_MS && !key.includes('/')) {
    const legacySnap = await adminDb
      .doc(`workspaces/${workspaceId}/idempotency_keys/${key}`)
      .get();
    if (legacySnap.exists) {
      const legacy = legacySnap.data() as IdempotencyData;
      if (legacy.requestHash !== requestHash) throw new Error('VALIDATION_IDEMPOTENCY_KEY_REUSED');
      if (legacy.responseStatus || legacy.responseBody !== undefined) return responseFromData(legacy);
    }
  }

  const ref = adminDb.doc(`workspaces/${workspaceId}/idempotency_keys/${idempotencyDocId(key)}`);
  const now = Date.now();
  const state = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as IdempotencyData;
      if (data.requestHash !== requestHash) throw new Error('VALIDATION_IDEMPOTENCY_KEY_REUSED');
      if (data.status === 'completed' || data.responseStatus || data.responseBody !== undefined) {
        return { kind: 'replay' as const, data };
      }
      if (data.status === 'processing' && timestampMillis(data.leaseExpiresAt) > now) {
        return { kind: 'processing' as const };
      }
    }

    tx.set(ref, {
      keyHash: idempotencyDocId(key),
      method: 'POST',
      requestHash,
      status: 'processing',
      createdAt: new Date(now).toISOString(),
      leaseExpiresAt: Timestamp.fromMillis(now + IDEMPOTENCY_LEASE_MS),
      expiresAt: Timestamp.fromMillis(now + IDEMPOTENCY_TTL_MS),
    }, { merge: true });
    return { kind: 'reserved' as const };
  });

  if (state.kind === 'replay') return responseFromData(state.data);
  if (state.kind === 'processing') {
    return Response.json(
      { error: 'IDEMPOTENCY_REQUEST_IN_PROGRESS', message: 'A request with this Idempotency-Key is still processing.' },
      { status: 409, headers: { 'Retry-After': '1' } },
    );
  }
  return null;
}

export async function persistIdempotentResponse(
  workspaceId: string,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  const now = Date.now();
  await adminDb.doc(`workspaces/${workspaceId}/idempotency_keys/${idempotencyDocId(key)}`).set({
    method: 'POST',
    requestHash,
    status: 'completed',
    responseStatus: status,
    responseBody: body,
    createdAt: new Date(now).toISOString(),
    completedAt: new Date(now).toISOString(),
    leaseExpiresAt: FieldValue.delete(),
    expiresAt: Timestamp.fromMillis(now + IDEMPOTENCY_TTL_MS),
  }, { merge: true });
}
