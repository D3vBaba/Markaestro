import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus, PlatformCapability, type PlatformConnection } from '@/lib/platform/types';

vi.mock('@/lib/crypto', () => ({ decrypt: () => 'access-token' }));
vi.mock('@/lib/platform/cost-guardrails', () => ({
  reserveProviderUsage: vi.fn(async () => undefined),
  xReadCostUsd: () => 0.005,
  xUserReadCostUsd: () => 0.01,
  xDeleteCostUsd: () => 0.01,
  xWorkspaceHardBudgetUsd: () => 25,
  xWriteCostUsd: () => 0.01,
}));

import { xPublishingAdapter } from './x-publishing';
import { reserveProviderUsage } from '@/lib/platform/cost-guardrails';

const connection: PlatformConnection = {
  provider: 'x',
  accountKey: '42',
  channels: ['x'],
  capabilities: [PlatformCapability.PUBLISH_TEXT, PlatformCapability.PUBLISH_IMAGE, PlatformCapability.PUBLISH_VIDEO],
  status: ConnectionStatus.CONNECTED,
  accessTokenEncrypted: 'encrypted',
  metadata: { xUserId: '42', username: 'markaestro' },
  workspaceId: 'workspace-1',
  productId: 'product-1',
  updatedBy: 'user-1',
  updatedAt: '2026-09-03T00:00:00.000Z',
  createdAt: '2026-09-03T00:00:00.000Z',
};

describe('X publishing adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('publishes typed X settings and returns the canonical post URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id: '123' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await xPublishingAdapter.publish(connection, {
      channel: 'x',
      content: 'A concise launch update',
      settings: { __type: 'x', replySettings: 'mentionedUsers' },
    });

    expect(result).toEqual({
      success: true,
      externalId: '123',
      externalUrl: 'https://x.com/markaestro/status/123',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token' });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: 'A concise launch update',
      reply_settings: 'mentionedUsers',
    });
    expect(vi.mocked(reserveProviderUsage).mock.invocationCallOrder[0])
      .toBeLessThan(fetchMock.mock.invocationCallOrder[0]!);
  });

  it('uses INIT, APPEND, FINALIZE, and STATUS for video before creating the post', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const value = String(url);
      if (value === 'https://media.example/video.mp4') {
        calls.push('download');
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      }
      if (value.endsWith('/media/upload') && init?.body instanceof FormData) {
        const command = String(init.body.get('command') || '');
        calls.push(command);
        if (command === 'INIT') return new Response(JSON.stringify({ data: { id: 'media-1' } }), { status: 200 });
        if (command === 'FINALIZE') return new Response(JSON.stringify({ data: { processing_info: { state: 'pending', check_after_secs: 1 } } }), { status: 200 });
        return new Response('{}', { status: 200 });
      }
      if (value.includes('command=STATUS')) {
        calls.push('STATUS');
        return new Response(JSON.stringify({ data: { processing_info: { state: 'succeeded' } } }), { status: 200 });
      }
      calls.push('CREATE');
      return new Response(JSON.stringify({ data: { id: 'post-1' } }), { status: 201 });
    });

    const pending = xPublishingAdapter.publish(connection, {
      channel: 'x',
      content: 'Video update',
      mediaUrls: ['https://media.example/video.mp4'],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ success: true, externalId: 'post-1' });
    expect(calls).toEqual(['download', 'INIT', 'APPEND', 'FINALIZE', 'STATUS', 'CREATE']);
    fetchMock.mockRestore();
    vi.useRealTimers();
  });

  it('normalizes engagement and impression metrics without inventing unavailable values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: {
        public_metrics: { impression_count: 100, like_count: 8, reply_count: 2, retweet_count: 3, quote_count: 1 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await xPublishingAdapter.fetchMetrics!(connection, { externalId: '123', channel: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics).toMatchObject({ impressions: 100, views: 100, likes: 8, comments: 2, shares: 4 });
      expect(result.metrics.reach).toBeNull();
    }
  });
});
