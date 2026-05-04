import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseTikTokWebhookEvent,
  verifyTikTokWebhookSignature,
} from '../social/tiktok-webhook';

const SECRET = 'test_client_secret';

function sign(rawBody: string, timestamp: number, secret: string = SECRET): string {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},s=${sig}`;
}

describe('verifyTikTokWebhookSignature', () => {
  const body = JSON.stringify({
    client_key: 'ck',
    event: 'post.publish.complete',
    create_time: 1700000000,
    user_openid: 'u',
    content: JSON.stringify({ publish_id: 'pub_abc' }),
  });

  it('accepts a valid signature inside the replay window', () => {
    const t = 1_700_000_000;
    const header = sign(body, t);
    const result = verifyTikTokWebhookSignature(body, header, SECRET, t + 30);
    expect(result).toEqual({ ok: true, timestamp: t });
  });

  it('rejects when the signature header is missing', () => {
    const result = verifyTikTokWebhookSignature(body, null, SECRET);
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects when the secret is unset', () => {
    const t = 1_700_000_000;
    const result = verifyTikTokWebhookSignature(body, sign(body, t), '', t);
    expect(result).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('rejects a malformed header', () => {
    const result = verifyTikTokWebhookSignature(body, 'not-a-real-header', SECRET);
    expect(result).toEqual({ ok: false, reason: 'malformed_signature' });
  });

  it('rejects timestamps outside the 5-minute replay window', () => {
    const t = 1_700_000_000;
    const result = verifyTikTokWebhookSignature(body, sign(body, t), SECRET, t + 301);
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects when the signature does not match the body', () => {
    const t = 1_700_000_000;
    const tampered = body + ' '; // body changed after signing
    const result = verifyTikTokWebhookSignature(tampered, sign(body, t), SECRET, t);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects when signed with the wrong secret', () => {
    const t = 1_700_000_000;
    const result = verifyTikTokWebhookSignature(body, sign(body, t, 'other_secret'), SECRET, t);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('parseTikTokWebhookEvent', () => {
  it('parses the stringified content envelope', () => {
    const raw = JSON.stringify({
      client_key: 'ck',
      event: 'post.publish.complete',
      create_time: 1700000000,
      user_openid: 'u',
      content: JSON.stringify({ publish_id: 'pub_abc', post_id: 'post_xyz' }),
    });
    const parsed = parseTikTokWebhookEvent(raw);
    expect(parsed?.event.event).toBe('post.publish.complete');
    expect(parsed?.content.publish_id).toBe('pub_abc');
    expect(parsed?.content.post_id).toBe('post_xyz');
  });

  it('returns null for non-JSON bodies', () => {
    expect(parseTikTokWebhookEvent('not json')).toBeNull();
  });

  it('tolerates missing or empty content', () => {
    const parsed = parseTikTokWebhookEvent(JSON.stringify({ event: 'post.publish.failed' }));
    expect(parsed?.content).toEqual({});
  });
});
