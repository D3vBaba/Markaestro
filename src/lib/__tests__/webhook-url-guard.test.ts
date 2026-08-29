/**
 * The webhook destination guard (`AU-02`).
 *
 * A webhook URL is attacker-chosen by design, so these tests pin the rules that
 * stop it being pointed at the instance metadata service or the private
 * network. `NODE_ENV` is forced to production for the network cases because the
 * development allowance deliberately skips them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assertSafeOutboundUrl = vi.hoisted(() => vi.fn());
vi.mock('../network-security', () => ({ assertSafeOutboundUrl }));

import { assertSafeWebhookUrl, webhookUrlProtocolIsAllowed } from '../public-api/webhook-url';
import { registerWebhookEndpointSchema } from '../public-api/schemas';

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV is readonly in the Next.js type surface, so assign through the record.
  (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
  assertSafeOutboundUrl.mockReset();
  assertSafeOutboundUrl.mockImplementation(async (raw: string) => new URL(raw));
});

afterEach(() => {
  setNodeEnv(originalNodeEnv || 'test');
});

describe('webhook URL protocol rule', () => {
  it('accepts https in every environment', () => {
    setNodeEnv('production');
    expect(webhookUrlProtocolIsAllowed('https://hooks.example.com/mk')).toBe(true);
  });

  it('rejects plain http in production', () => {
    setNodeEnv('production');
    expect(webhookUrlProtocolIsAllowed('http://hooks.example.com/mk')).toBe(false);
  });

  it('allows plain http outside production so local tunnels work', () => {
    setNodeEnv('development');
    expect(webhookUrlProtocolIsAllowed('http://localhost:4000/hook')).toBe(true);
  });

  it('rejects non-web schemes outright', () => {
    setNodeEnv('development');
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/', 'javascript:alert(1)']) {
      expect(webhookUrlProtocolIsAllowed(url), url).toBe(false);
    }
  });

  it('rejects unparseable input', () => {
    expect(webhookUrlProtocolIsAllowed('not a url')).toBe(false);
    expect(webhookUrlProtocolIsAllowed('')).toBe(false);
  });
});

describe('registerWebhookEndpointSchema', () => {
  it('rejects an http endpoint in production', () => {
    setNodeEnv('production');
    const result = registerWebhookEndpointSchema.safeParse({
      url: 'http://hooks.example.com/mk',
      events: ['post.published'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts an https endpoint', () => {
    setNodeEnv('production');
    const result = registerWebhookEndpointSchema.safeParse({
      url: 'https://hooks.example.com/mk',
      events: ['post.published'],
    });
    expect(result.success).toBe(true);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('runs the SSRF guard in production, https-only', async () => {
    setNodeEnv('production');
    await assertSafeWebhookUrl('https://hooks.example.com/mk');
    expect(assertSafeOutboundUrl).toHaveBeenCalledWith('https://hooks.example.com/mk', { httpsOnly: true });
  });

  it('rejects a target the SSRF guard refuses', async () => {
    setNodeEnv('production');
    assertSafeOutboundUrl.mockRejectedValue(new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED'));
    await expect(assertSafeWebhookUrl('https://metadata.google.internal/x'))
      .rejects.toThrow('VALIDATION_WEBHOOK_URL_NOT_ALLOWED');
  });

  it('rejects http before it ever reaches the network guard', async () => {
    setNodeEnv('production');
    await expect(assertSafeWebhookUrl('http://169.254.169.254/computeMetadata/v1/'))
      .rejects.toThrow('VALIDATION_WEBHOOK_URL_MUST_BE_HTTPS');
    expect(assertSafeOutboundUrl).not.toHaveBeenCalled();
  });

  it('fails closed when the guard itself throws unexpectedly', async () => {
    // A DNS resolver fault must not read as "safe". The delivery worker turns
    // this throw into a retryable failure rather than a delivered webhook.
    setNodeEnv('production');
    assertSafeOutboundUrl.mockRejectedValue(new Error('EAI_AGAIN'));
    await expect(assertSafeWebhookUrl('https://hooks.example.com/mk'))
      .rejects.toThrow('VALIDATION_WEBHOOK_URL_NOT_ALLOWED');
  });

  it('skips the network guard in development so local endpoints work', async () => {
    setNodeEnv('development');
    await expect(assertSafeWebhookUrl('http://localhost:4000/hook')).resolves.toBeInstanceOf(URL);
    expect(assertSafeOutboundUrl).not.toHaveBeenCalled();
  });
});
