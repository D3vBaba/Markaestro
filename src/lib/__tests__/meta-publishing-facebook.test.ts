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

  it('reads a video post through its wrapping page post when the video id has no insights', async () => {
    const calls: string[] = [];
    graphApiFetchMock.mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.includes('/vid-1?fields=reactions')) {
        return jsonResponse(400, { error: { code: 100, message: '(#100) Tried accessing nonexisting field (reactions) on node type (Video)' } });
      }
      if (url.includes('/vid-1/insights?')) {
        return jsonResponse(400, { error: { code: 100, message: '(#100) Tried accessing nonexisting field (insights) on node type (Video)' } });
      }
      if (url.includes('/page-1_vid-1/insights?')) {
        return jsonResponse(200, {
          data: [
            { name: 'post_media_view', values: [{ value: 340 }] },
            { name: 'post_total_media_view_unique', values: [{ value: 210 }] },
            { name: 'post_video_views', values: [{ value: 300 }] },
          ],
        });
      }
      if (url.includes('/page-1_vid-1?fields=reactions')) {
        return jsonResponse(200, { reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } });
      }
      return jsonResponse(404, { error: { code: 100, message: 'unexpected call' } });
    });
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const result = await metaPublishingAdapter.fetchMetrics!(facebookConnection(), {
      channel: 'facebook',
      externalId: 'vid-1',
      publishedAt: '2026-09-01T04:00:00.000Z',
      destinationId: 'meta:facebook:page-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.views).toBe(340);
    expect(result.metrics.reach).toBe(210);
    expect(result.metrics.videoViews).toBe(300);
    expect(result.metrics.likes).toBe(9);
    expect(result.metrics.comments).toBe(2);
    expect(result.metrics.shares).toBe(1);
    expect(calls.some((url) => url.includes('/page-1_vid-1/insights?'))).toBe(true);
  });

  it('does not rewrite a page post id or an unrelated error', async () => {
    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/insights?')) {
        return jsonResponse(400, { error: { code: 100, message: '(#100) Tried accessing nonexisting field (insights) on node type (Video)' } });
      }
      return jsonResponse(400, { error: { code: 100, message: 'Unsupported get request.' } });
    });
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const result = await metaPublishingAdapter.fetchMetrics!(facebookConnection(), {
      channel: 'facebook',
      externalId: 'page-1_already-a-post',
      publishedAt: '2026-09-01T04:00:00.000Z',
      destinationId: 'meta:facebook:page-1',
    });
    expect(result.ok).toBe(false);
    expect(graphApiFetchMock.mock.calls.filter(([url]) => String(url).includes('page-1_page-1_')).length).toBe(0);
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
