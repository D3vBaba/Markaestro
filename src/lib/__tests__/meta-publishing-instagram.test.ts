import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection } from '@/lib/platform/types';
import { IG_LOGIN_UNSUPPORTED_MESSAGE } from '@/lib/oauth/instagram-errors';

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
    metadata: { igAccountId: 'app-scoped-id', loginType: 'instagram_login' },
    workspaceId: 'default',
  } as unknown as PlatformConnection;
}

const REFUSAL = { error: { code: 100, message: 'Unsupported request - method type: get', type: 'IGApiException' } };

describe('metaPublishingAdapter — Instagram Login publishing', () => {
  beforeEach(() => {
    graphApiFetchMock.mockReset();
  });

  it('publishes against the professional user_id from /me, not the stored app-scoped id', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'real-professional-id' });
      if (url.includes('/real-professional-id/media_publish')) return jsonResponse(200, { id: 'media-1' });
      if (url.includes('/real-professional-id/media')) return jsonResponse(200, { id: 'container-1' });
      if (url.includes('/container-1?')) return jsonResponse(200, { status_code: 'FINISHED' });
      if (url.includes('/media-1?')) return jsonResponse(200, { permalink: 'https://instagram.com/p/x' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('media-1');
    const mediaCalls = graphApiFetchMock.mock.calls.map((c) => c[0] as string);
    expect(mediaCalls.some((u) => u.includes('/app-scoped-id/media'))).toBe(false);
    expect(mediaCalls.some((u) => u.includes('/real-professional-id/media'))).toBe(true);
  });

  it('returns the actionable message when graph.instagram.com blanket-refuses the token', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    graphApiFetchMock.mockImplementation(async () => jsonResponse(400, REFUSAL));

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(IG_LOGIN_UNSUPPORTED_MESSAGE);
  });

  it('falls back to the stored id when /me fails for non-refusal reasons', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(500, { error: { code: 2, message: 'Service temporarily unavailable' } });
      if (url.includes('/app-scoped-id/media_publish')) return jsonResponse(200, { id: 'media-2' });
      if (url.includes('/app-scoped-id/media')) return jsonResponse(200, { id: 'container-2' });
      if (url.includes('/container-2?')) return jsonResponse(200, { status_code: 'FINISHED' });
      if (url.includes('/media-2?')) return jsonResponse(200, { permalink: undefined });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('media-2');
  });

  it('maps container-creation refusals to the actionable message', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'real-professional-id' });
      if (url.includes('/media')) return jsonResponse(400, { error: { code: 100, message: 'Unsupported request - method type: post', type: 'IGApiException' } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'hello',
      mediaUrls: ['https://cdn.example.com/img.jpg'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain(IG_LOGIN_UNSUPPORTED_MESSAGE);
  });
});
