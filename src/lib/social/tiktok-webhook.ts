import crypto from 'node:crypto';

const TIKTOK_WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

export type TikTokWebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'stale_timestamp' | 'bad_signature' | 'missing_secret' };

export type TikTokWebhookEvent = {
  client_key?: string;
  event?: string;
  create_time?: number;
  user_openid?: string;
  /** TikTok delivers `content` as a stringified JSON blob. */
  content?: string;
};

export type TikTokWebhookContent = {
  publish_id?: string;
  publish_type?: string;
  post_id?: string;
  publicly_available_post_id?: string | string[];
  reason?: string;
};

function parseSignatureHeader(header: string | null): { t: number; s: string } | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  let s: string | null = null;
  for (const part of parts) {
    if (part.startsWith('t=')) {
      const value = Number(part.slice(2));
      if (Number.isFinite(value)) t = value;
    } else if (part.startsWith('s=')) {
      s = part.slice(2);
    }
  }
  if (t === null || !s) return null;
  return { t, s };
}

export function verifyTikTokWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  clientSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TikTokWebhookVerification {
  if (!clientSecret) return { ok: false, reason: 'missing_secret' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed_signature' };

  if (Math.abs(nowSeconds - parsed.t) > TIKTOK_WEBHOOK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(`${parsed.t}.${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(parsed.s, 'hex');
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true, timestamp: parsed.t };
}

export function parseTikTokWebhookEvent(rawBody: string): {
  event: TikTokWebhookEvent;
  content: TikTokWebhookContent;
} | null {
  try {
    const event = JSON.parse(rawBody) as TikTokWebhookEvent;
    let content: TikTokWebhookContent = {};
    if (typeof event.content === 'string' && event.content.length > 0) {
      try {
        content = JSON.parse(event.content) as TikTokWebhookContent;
      } catch {
        // Some TikTok events may carry an object — accept that defensively.
      }
    } else if (event.content && typeof event.content === 'object') {
      content = event.content as unknown as TikTokWebhookContent;
    }
    return { event, content };
  } catch {
    return null;
  }
}
