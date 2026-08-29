import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Test-mode keys (mk_test_) create real posts that publish through the
 * sandbox adapter: same shapes as the real adapters, deterministic ids, no
 * sockets, no connected account required. These tests pin the wiring, which
 * is the part 5.7 could silently lose: an unwired sandbox adapter is just a
 * file, and the first symptom would be an integrator's test key publishing to
 * a real account.
 */

const getAdapterForChannelMock = vi.fn();
const getConnectionForChannelMock = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/platform/registry', () => ({
  getAdapterForChannel: getAdapterForChannelMock,
}));
vi.mock('@/lib/platform/connections', () => ({
  getConnectionForChannel: getConnectionForChannelMock,
  getLinkedInConnectionForDestination: vi.fn(),
  markConnectionAuthError: vi.fn(),
}));
vi.mock('@/lib/public-api/webhooks', () => ({ enqueueWebhookEvent: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('test-mode publishing', () => {
  it('routes a test-mode request to the sandbox: no registry, no connection, no socket', async () => {
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_1', 'brand_1', {
      channel: 'linkedin',
      content: 'Sandbox hello',
      mediaUrls: [],
      testMode: true,
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toMatch(/^mk_test_/);
    expect(result.externalUrl).toContain('sandbox.markaestro.invalid');
    // The whole point: nothing real was touched.
    expect(getAdapterForChannelMock).not.toHaveBeenCalled();
    expect(getConnectionForChannelMock).not.toHaveBeenCalled();
  });

  it('mints the same external id for the same post, so integrator tests are stable', async () => {
    const { publishPost } = await import('../social/publisher');
    const request = { channel: 'threads' as const, content: 'Stable', mediaUrls: [], testMode: true };
    const first = await publishPost('ws_1', 'b', request);
    const second = await publishPost('ws_1', 'b', request);
    expect(first.externalId).toBe(second.externalId);
  });

  it('still enforces the channel contract, so test mode validates like production', async () => {
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_1', 'b', {
      channel: 'instagram',
      content: 'No media',
      mediaUrls: [],
      testMode: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires at least one image or video/);
  });

  it('produces the marker-selected failure, deterministically', async () => {
    // Integrators need to see a rate-limit response before they are rate
    // limited, which is not a thing anyone can arrange against production.
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_1', 'b', {
      channel: 'linkedin',
      content: 'This should TEST_FAIL_RATE_LIMIT now',
      mediaUrls: [],
      testMode: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limited/i);
  });

  it('never routes a live request to the sandbox', async () => {
    getAdapterForChannelMock.mockReturnValue(undefined);
    const { publishPost } = await import('../social/publisher');

    const result = await publishPost('ws_1', 'b', {
      channel: 'linkedin',
      content: 'Live post',
      mediaUrls: [],
    });

    // Reaches the registry (and fails on our undefined mock), proving the
    // sandbox branch did not swallow it.
    expect(getAdapterForChannelMock).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
