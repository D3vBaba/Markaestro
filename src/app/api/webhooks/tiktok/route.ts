import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  parseTikTokWebhookEvent,
  verifyTikTokWebhookSignature,
} from '@/lib/social/tiktok-webhook';
import {
  findPostByTikTokPublishId,
  pollTikTokPublishForPost,
} from '@/lib/social/tiktok-publish-poll-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('tiktok-signature');
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';

  const verification = verifyTikTokWebhookSignature(rawBody, signatureHeader, clientSecret);
  if (!verification.ok) {
    logger.warn('tiktok webhook signature rejected', {
      event: 'tiktok.webhook.rejected',
      reason: verification.reason,
    });
    // 401 keeps malformed/forged deliveries out of TikTok's success metrics
    // without triggering retries (TikTok retries on non-2xx for up to 72h —
    // we only want retries for transient *handler* errors, not auth failures).
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  const parsed = parseTikTokWebhookEvent(rawBody);
  if (!parsed) {
    return NextResponse.json({ received: true, ignored: 'unparseable_body' });
  }

  const { event, content } = parsed;
  const publishId = content.publish_id;
  if (!publishId) {
    return NextResponse.json({ received: true, ignored: 'no_publish_id' });
  }

  // Webhook is a *signal* to reconcile — we don't trust the payload for
  // state. fetchTikTokPublishStatus inside pollTikTokPublishForPost is the
  // authoritative source, which also makes redelivery naturally idempotent.
  try {
    const match = await findPostByTikTokPublishId(publishId);
    if (!match) {
      logger.info('tiktok webhook for unknown publish_id', {
        event: 'tiktok.webhook.unknown_publish_id',
        publishId,
        type: event.event,
      });
      return NextResponse.json({ received: true, ignored: 'unknown_publish_id' });
    }

    const outcome = await pollTikTokPublishForPost(match.workspaceId, match.postRef);
    return NextResponse.json({ received: true, outcome: outcome.status });
  } catch (err) {
    // Surface a 500 so TikTok retries — pollTikTokPublishForPost is
    // idempotent (terminal transitions only land when TikTok reports them).
    logger.error('tiktok webhook handler failed', {
      event: 'tiktok.webhook.handler_failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      publishId,
    });
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }
}
