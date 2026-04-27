import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithRetryMock = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('instagram insights host selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses graph.facebook.com by default for meta-linked instagram', async () => {
    const { fetchInstagramInsights } = await import('../social/meta-insights');

    fetchWithRetryMock
      .mockResolvedValueOnce(jsonResponse({ followers_count: 10, media_count: 4 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await fetchInstagramInsights('token_123', 'ig_123');

    const profileUrl = fetchWithRetryMock.mock.calls[0][0] as string;
    expect(profileUrl).toContain('https://graph.facebook.com/v22.0/ig_123?fields=');
    expect(profileUrl).toContain('followers_count');
    expect(profileUrl).toContain('media_count');
    expect(profileUrl).toContain('access_token=token_123');
    expect(fetchWithRetryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://graph.facebook.com/v22.0/ig_123/media?fields='),
      {},
      { maxRetries: 1 },
    );
  });

  it('uses graph.instagram.com for standalone instagram login', async () => {
    const { fetchInstagramInsights } = await import('../social/meta-insights');

    fetchWithRetryMock
      .mockResolvedValueOnce(jsonResponse({ followers_count: 42, media_count: 7 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await fetchInstagramInsights('token_456', 'ig_direct_123', { graphApi: 'instagram' });

    const profileUrl = fetchWithRetryMock.mock.calls[0][0] as string;
    expect(profileUrl).toContain('https://graph.instagram.com/v25.0/ig_direct_123?fields=');
    expect(profileUrl).toContain('followers_count');
    expect(profileUrl).toContain('media_count');
    expect(profileUrl).toContain('access_token=token_456');
    expect(fetchWithRetryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://graph.instagram.com/v25.0/ig_direct_123/media?fields='),
      {},
      { maxRetries: 1 },
    );
  });
});
