import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function getIdempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key')?.trim();
  return key || null;
}

export function createRequestHash(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function loadIdempotentResponse(
  workspaceId: string,
  key: string,
  requestHash: string,
): Promise<Response | null> {
  const ref = adminDb.doc(`workspaces/${workspaceId}/idempotency_keys/${key}`);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data() as {
    requestHash?: string;
    responseStatus?: number;
    responseBody?: unknown;
  };

  if (data.requestHash !== requestHash) {
    throw new Error('VALIDATION_IDEMPOTENCY_KEY_REUSED');
  }

  return Response.json(data.responseBody ?? {}, {
    status: data.responseStatus || 200,
  });
}

export async function persistIdempotentResponse(
  workspaceId: string,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  const now = Date.now();
  await adminDb.doc(`workspaces/${workspaceId}/idempotency_keys/${key}`).set({
    method: 'POST',
    requestHash,
    responseStatus: status,
    responseBody: body,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + IDEMPOTENCY_TTL_MS).toISOString(),
  }, { merge: true });
}
