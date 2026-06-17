import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  extractSignedRequest,
  metaSecretsFromEnv,
  verifyMetaSignedRequest,
} from '@/lib/social/meta-signed-request';
import { deleteConnectionsForMetaUser } from '@/lib/social/meta-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta "Deauthorize" / Threads "Uninstall" callback.
 *
 * Fired when a user removes the app (or a permission) from their Facebook,
 * Instagram or Threads account. Meta POSTs a signed_request carrying the
 * app-scoped user id; we verify it and remove every platform connection that
 * belongs to that user so their tokens stop being used.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const result = verifyMetaSignedRequest(extractSignedRequest(rawBody), metaSecretsFromEnv());

  if (!result.ok) {
    logger.warn('meta deauthorize signature rejected', {
      event: 'meta.webhook.deauthorize.rejected',
      reason: result.reason,
    });
    // 500 on missing config (so Meta retries once we fix it); 400 on a
    // forged/malformed delivery (no retry — it will never validate).
    const status = result.reason === 'no_secrets' ? 500 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const userId = typeof result.payload.user_id === 'string' ? result.payload.user_id : '';

  try {
    const { deleted } = await deleteConnectionsForMetaUser(result.provider, userId);
    logger.info('meta deauthorize processed', {
      event: 'meta.webhook.deauthorize.processed',
      provider: result.provider,
      deleted,
    });
    return NextResponse.json({ received: true, provider: result.provider, deleted });
  } catch (err) {
    logger.error('meta deauthorize handler failed', {
      event: 'meta.webhook.deauthorize.handler_failed',
      provider: result.provider,
      err: err instanceof Error ? err : new Error('Unknown error'),
    });
    // 500 so Meta retries — deleteConnectionsForMetaUser is idempotent.
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }
}
