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

describe('metaPublishingAdapter — Instagram carousels', () => {
  beforeEach(() => {
    graphApiFetchMock.mockReset();
  });

  function images(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `https://cdn.example.com/img-${i}.jpg`);
  }

  /**
   * Serves a full carousel publish and records how the child containers were
   * created: the order they were requested in, and the highest number of
   * simultaneously in-flight `/media` POSTs.
   */
  function mockCarouselPublish() {
    const childBodies: Array<Record<string, unknown>> = [];
    let inFlight = 0;
    let peakInFlight = 0;
    let childSeq = 0;

    graphApiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'ig-user' });
      if (url.includes('/media_publish')) return jsonResponse(200, { id: 'media-final' });
      if (url.includes('/ig-user/media')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (body.media_type === 'CAROUSEL') return jsonResponse(200, { id: 'parent-1' });
        childBodies.push(body);
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        // Yield so concurrent calls overlap; a sequential loop never will.
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return jsonResponse(200, { id: `child-${childSeq++}` });
      }
      if (/\/(child-\d+|parent-1)\?/.test(url)) return jsonResponse(200, { status_code: 'FINISHED' });
      if (url.includes('/media-final?')) return jsonResponse(200, { permalink: 'https://instagram.com/p/c' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    return { childBodies, peak: () => peakInFlight };
  }

  it('publishes a 10-image carousel through child containers and a CAROUSEL parent', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const { childBodies } = mockCarouselPublish();

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'launch week',
      mediaUrls: images(10),
    });

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('media-final');
    expect(childBodies).toHaveLength(10);
    expect(childBodies.every((body) => body.is_carousel_item === true)).toBe(true);
    // The caption belongs on the parent only; children carry none.
    expect(childBodies.every((body) => body.caption === undefined)).toBe(true);

    const parentCall = graphApiFetchMock.mock.calls.find(([, init]) => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}'));
      return body.media_type === 'CAROUSEL';
    });
    const parentBody = JSON.parse(String((parentCall?.[1] as RequestInit).body));
    expect(parentBody.caption).toBe('launch week');
    expect(String(parentBody.children).split(',')).toHaveLength(10);
  });

  it('creates child containers in small batches instead of one 10-wide burst', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const { peak } = mockCarouselPublish();

    await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'launch week',
      mediaUrls: images(10),
    });

    expect(peak()).toBeLessThanOrEqual(3);
  });

  it('applies per-child alt text by index', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    const { childBodies } = mockCarouselPublish();

    await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'launch week',
      mediaUrls: images(4),
      settings: { __type: 'instagram', altText: ['first', 'second', 'third', 'fourth'] },
    } as never);

    expect(childBodies.map((body) => body.alt_text)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('stops creating children after a failing batch and reports the child error', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');

    let childCalls = 0;
    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'ig-user' });
      if (url.includes('/ig-user/media')) {
        childCalls += 1;
        if (childCalls === 2) {
          return jsonResponse(400, { error: { code: 4, message: 'Application request limit reached' } });
        }
        return jsonResponse(200, { id: `child-${childCalls}` });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'launch week',
      mediaUrls: images(9),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Application request limit reached');
    // Only the first batch ran; the remaining six were never attempted.
    expect(childCalls).toBe(3);
  });

  it('refuses more media than the carousel limit rather than dropping the extras', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockImplementation(async (url: string) => {
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'too many',
      mediaUrls: images(11),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('maximum of 10 media items');
    expect(result.error).toContain('11');
    expect(graphApiFetchMock).not.toHaveBeenCalled();
  });

  it('explains how to resolve a story that carries carousel media', async () => {
    const { metaPublishingAdapter } = await import('@/lib/platform/adapters/meta-publishing');
    graphApiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/me?')) return jsonResponse(200, { user_id: 'ig-user' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await metaPublishingAdapter.publish(igConnection(), {
      channel: 'instagram',
      content: 'story',
      mediaUrls: images(3),
      settings: { __type: 'instagram', postType: 'story' },
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toContain('single image or video');
    expect(result.error).toContain('feed');
  });
});
