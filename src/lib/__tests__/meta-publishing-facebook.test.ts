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

function facebookConnection(): PlatformConnection {
  return {
    provider: 'meta',
    status: 'connected',
    accessTokenEncrypted: 'user-token',
    metadata: {
      pageId: 'page-1',
      pageAccessTokenEncrypted: 'page-token',
    },
    workspaceId: 'default',
  } as unknown as PlatformConnection;
}

describe('metaPublishingAdapter — Facebook metrics', () => {
  beforeEach(() => {
    graphApiFetchMock.mockReset();
  });

  it('keeps successful read_insights data when optional post fields need another permission', async () => {
    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('?fields=reactions')) {
        return jsonResponse(400, {
          error: {
            code: 10,
            message: "This endpoint requires the 'pages_read_user_content' permission",
          },
        });
      }
      if (url.includes('/insights?')) {
        return jsonResponse(200, {
          data: [
            { name: 'post_media_view', values: [{ value: 12 }] },
            { name: 'post_total_media_view_unique', values: [{ value: 7 }] },
            { name: 'post_clicks', values: [{ value: 3 }] },
            { name: 'post_video_views', values: [{ value: 0 }] },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const result = await metaPublishingAdapter.fetchMetrics!(facebookConnection(), {
      channel: 'facebook',
      externalId: 'page-1_post-1',
      publishedAt: '2026-07-30T05:42:04.443Z',
    });

    expect(result).toEqual({
      ok: true,
      metrics: expect.objectContaining({
        views: 12,
        reach: 7,
        clicks: 3,
        videoViews: 0,
        likes: null,
        comments: null,
        shares: null,
      }),
    });
  });
});
