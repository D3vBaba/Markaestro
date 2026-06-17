import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { logger } from '@/lib/logger';
import { adminDb } from '@/lib/firebase-admin';
import { getAppUrl } from '@/lib/oauth/config';
import {
  extractSignedRequest,
  metaSecretsFromEnv,
  verifyMetaSignedRequest,
} from '@/lib/social/meta-signed-request';
import { deleteConnectionsForMetaUser } from '@/lib/social/meta-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Status records Meta (and the user) can poll via the returned `url`. */
const STATUS_COLLECTION = 'meta_data_deletion_requests';

/**
 * Meta "Data Deletion Request" / Threads "Delete" callback.
 *
 * Meta POSTs a signed_request when a user asks for their data to be deleted.
 * We must (a) delete the data tied to that app-scoped user id and (b) respond
 * with exactly `{ url, confirmation_code }` so Meta can show the user a status
 * link. The `url` serves the GET handler below.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const result = verifyMetaSignedRequest(extractSignedRequest(rawBody), metaSecretsFromEnv());

  if (!result.ok) {
    logger.warn('meta data deletion signature rejected', {
      event: 'meta.webhook.data_deletion.rejected',
      reason: result.reason,
    });
    const status = result.reason === 'no_secrets' ? 500 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const userId = typeof result.payload.user_id === 'string' ? result.payload.user_id : '';
  const confirmationCode = crypto.randomUUID().replace(/-/g, '');
  const statusRef = adminDb.doc(`${STATUS_COLLECTION}/${confirmationCode}`);

  try {
    const { deleted } = await deleteConnectionsForMetaUser(result.provider, userId);
    await statusRef.set({
      confirmationCode,
      provider: result.provider,
      status: 'completed',
      deletedConnections: deleted,
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    logger.info('meta data deletion processed', {
      event: 'meta.webhook.data_deletion.processed',
      provider: result.provider,
      deleted,
      confirmationCode,
    });
  } catch (err) {
    // Record the failure but still hand back a confirmation_code + url — Meta
    // validates the response shape, and the status URL will report 'failed'
    // until a retry (Meta redelivers) completes the deletion.
    await statusRef
      .set({
        confirmationCode,
        provider: result.provider,
        status: 'failed',
        requestedAt: new Date().toISOString(),
      })
      .catch(() => {});
    logger.error('meta data deletion handler failed', {
      event: 'meta.webhook.data_deletion.handler_failed',
      provider: result.provider,
      confirmationCode,
      err: err instanceof Error ? err : new Error('Unknown error'),
    });
  }

  const statusUrl = `${getAppUrl()}/api/webhooks/meta/data-deletion?id=${confirmationCode}`;
  // Meta requires exactly this shape.
  return NextResponse.json({ url: statusUrl, confirmation_code: confirmationCode });
}

/**
 * Status endpoint linked from the POST response. Meta and the user open this
 * to confirm the deletion. Returns a small JSON status for a confirmation code.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 });
  }

  const snap = await adminDb.doc(`${STATUS_COLLECTION}/${id}`).get();
  if (!snap.exists) {
    return NextResponse.json({ confirmation_code: id, status: 'not_found' }, { status: 404 });
  }

  const data = snap.data() as { status?: string; completedAt?: string };
  return NextResponse.json({
    confirmation_code: id,
    status: data.status ?? 'unknown',
    ...(data.completedAt ? { completed_at: data.completedAt } : {}),
  });
}
