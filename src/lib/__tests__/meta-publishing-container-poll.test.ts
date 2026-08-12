import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';

const graphApiFetchMock = vi.fn();

vi.mock('@/lib/crypto', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
  encrypt: (value: string) => value,
}));

vi.mock('@/lib/platform/meta-graph-api', () => ({
  graphApiFetch: (...args: unknown[]) => graphApiFetchMock(...args),
  checkIgPublishingQuota: vi.fn().mockResolvedValue({ quotaUsage: 0, quotaTotal: 50, remaining: 50 }),
  checkPagePublishingAccess: vi.fn().mockResolvedValue({ canPublish: true }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function igConnection(): PlatformConnection {
  return {
    provider: 'instagram',
    status: 'connected',
    accessTokenEncrypted: 'enc',
    metadata: { igAccountId: 'ig-1', loginType: 'instagram_login' },
    workspaceId: 'default',
  } as unknown as PlatformConnection;
}

/**
 * The container poll used to sleep a flat 2s between checks, so an image that
 * was ready on the second check still cost the user ~2s of dead wait. The ramp
 * has to stay fast for that case without giving up the long budget a slow video
 * container needs.
 */
describe('Instagram container polling', () => {
  beforeEach(() => {
    graphApiFetchMock.mockReset();
  });

  async function publishWithStatuses(statuses: string[]) {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const remaining = [...statuses];

    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'ig-1' });
      if (url.includes('/media_publish')) return jsonResponse(200, { id: 'media-1' });
      if (url.includes('/ig-1/media')) return jsonResponse(200, { id: 'container-1' });
      if (url.includes('/container-1?')) {
        return jsonResponse(200, { status_code: remaining.shift() ?? 'FINISHED' });
      }
      if (url.includes('/media-1?')) return jsonResponse(200, { permalink: 'https://instagram.com/p/x' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const startedAt = Date.now();
    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });
    return { result, elapsedMs: Date.now() - startedAt };
  }

  it('returns immediately when the container is ready on the first check', async () => {
    const { result, elapsedMs } = await publishWithStatuses(['FINISHED']);

    expect(result.success).toBe(true);
    expect(elapsedMs).toBeLessThan(100);
  });

  it('waits well under the old flat interval when the container needs a few checks', async () => {
    const { result, elapsedMs } = await publishWithStatuses(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);

    expect(result.success).toBe(true);
    // Old behaviour: two flat 2s sleeps = 4s. Ramped: 300ms + 600ms.
    expect(elapsedMs).toBeLessThan(1500);
  });

  it('surfaces a container error without waiting', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'ig-1' });
      if (url.includes('/ig-1/media')) return jsonResponse(200, { id: 'container-1' });
      if (url.includes('/container-1?')) {
        return jsonResponse(200, { status_code: 'ERROR', status: 'Media download failed' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Media download failed');
  });
});
