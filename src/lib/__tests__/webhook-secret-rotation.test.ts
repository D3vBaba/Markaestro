import { beforeEach, describe, expect, it, vi } from 'vitest';

const docMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { doc: (...args: unknown[]) => docMock(...args) },
}));
vi.mock('@/lib/crypto', () => ({
  // The stored value is ciphertext; the test only needs the round trip to be
  // distinguishable, not real.
  decrypt: (value: string) => `decrypted:${value}`,
  encrypt: (value: string) => `enc:${value}`,
}));

function endpointDoc(data: Record<string, unknown> | null) {
  return {
    get: async () => ({ exists: data !== null, data: () => data }),
    set: vi.fn(),
  };
}

/**
 * Webhook secret rotation grace window (plan item 3.5 / FP-04b).
 *
 * A rotate that kills the old secret the instant it is issued breaks every
 * delivery until the customer has redeployed their receiver, which makes
 * rotation something people avoid doing rather than something they do
 * routinely. Both secrets sign during the window.
 */
describe('getWebhookEndpointDeliveryConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the previous secret while the grace window is open', async () => {
    docMock.mockReturnValue(endpointDoc({
      status: 'active',
      url: 'https://hooks.test/x',
      secretEncrypted: 'new',
      previousSecretEncrypted: 'old',
      previousSecretExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    const { getWebhookEndpointDeliveryConfig } = await import('../public-api/webhooks');
    const config = await getWebhookEndpointDeliveryConfig('ws_1', 'ep_1');

    expect(config.secret).toBe('decrypted:new');
    expect(config.previousSecret).toBe('decrypted:old');
  });

  it('drops the previous secret once the window has closed', async () => {
    docMock.mockReturnValue(endpointDoc({
      status: 'active',
      url: 'https://hooks.test/x',
      secretEncrypted: 'new',
      previousSecretEncrypted: 'old',
      previousSecretExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    const { getWebhookEndpointDeliveryConfig } = await import('../public-api/webhooks');
    const config = await getWebhookEndpointDeliveryConfig('ws_1', 'ep_1');

    expect(config.secret).toBe('decrypted:new');
    // An expired grace window must not keep a retired secret valid forever.
    expect(config.previousSecret).toBeUndefined();
  });

  it('has no previous secret for an endpoint that was never rotated', async () => {
    docMock.mockReturnValue(endpointDoc({
      status: 'active',
      url: 'https://hooks.test/x',
      secretEncrypted: 'only',
    }));

    const { getWebhookEndpointDeliveryConfig } = await import('../public-api/webhooks');
    const config = await getWebhookEndpointDeliveryConfig('ws_1', 'ep_1');

    expect(config.previousSecret).toBeUndefined();
  });

  it('still refuses to deliver to a disabled endpoint', async () => {
    docMock.mockReturnValue(endpointDoc({
      status: 'disabled',
      url: 'https://hooks.test/x',
      secretEncrypted: 'new',
    }));

    const { getWebhookEndpointDeliveryConfig } = await import('../public-api/webhooks');
    await expect(getWebhookEndpointDeliveryConfig('ws_1', 'ep_1'))
      .rejects.toThrow('WEBHOOK_ENDPOINT_DISABLED');
  });
});
