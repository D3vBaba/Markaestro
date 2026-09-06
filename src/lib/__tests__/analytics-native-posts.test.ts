import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/platform/connections', () => ({ listConnections: vi.fn() }));
vi.mock('@/lib/platform/registry', () => ({ getAdapterForChannel: vi.fn() }));
vi.mock('@/lib/intelligence/canonical-social-posts', () => ({ upsertNativeSocialPost: vi.fn() }));

import {
  initialNativePollState,
  isNativePostDoc,
  markaestroPlatformPostKeys,
  nativePostToAnalyticsPost,
  platformPostKey,
} from '@/lib/analytics/native-posts';
import {
  NATIVE_REFRESH_INTERVAL_MS,
  NATIVE_REFRESH_OVERLAP_MS,
  planNativeImportRun,
} from '@/lib/intelligence/native-import';
import { postToRow } from '@/lib/analytics/query';

const DAY = 24 * 3600_000;

describe('native posts in analytics', () => {
  it('recognises a Markaestro post seen from the account side by its platform id', () => {
    const claimed = markaestroPlatformPostKeys([
      { publishResults: [{ channel: 'instagram', success: true, externalId: 'ig_1' }, { channel: 'facebook', success: false, externalId: 'fb_x' }] },
      { channel: 'threads', externalId: 'th_2' },
      { channel: 'tiktok' },
    ]);
    expect(claimed).toEqual(new Set(['instagram:ig_1', 'threads:th_2']));
    expect(claimed.has(platformPostKey('facebook', 'fb_x'))).toBe(false);
  });

  it('maps a native post into the row shape with its platform as the only channel', () => {
    const row = postToRow('native_1', nativePostToAnalyticsPost({
      provenance: 'platform_native',
      platform: 'instagram',
      externalId: 'ig_9',
      productId: 'brand_1',
      content: 'posted from the phone',
      contentType: 'video',
      mediaUrl: 'https://cdn/clip.mp4',
      permalink: 'https://instagram.com/p/9',
      publishedAt: '2026-08-01T12:00:00.000Z',
      metricsUpdatedAt: '2026-08-02T12:00:00.000Z',
      metricsByChannel: {
        instagram: {
          impressions: null, views: 120, reach: 100, likes: 10, comments: 2, shares: 1, saves: 3, clicks: null,
          profileVisits: null, followersGained: null, watchTimeSeconds: null, averageWatchTimeSeconds: null,
          completionRate: null, conversions: null, videoViews: null, raw: {},
        },
      },
    }));
    expect(row).toEqual(expect.objectContaining({
      id: 'native_1',
      source: 'native',
      channels: ['instagram'],
      contentType: 'video',
      externalUrl: 'https://instagram.com/p/9',
      productId: 'brand_1',
      views: 120,
      engagements: 16,
      erByReach: 0.16,
      // Instagram offers no delete to apps; a caller must not offer a takedown.
      canTakeDown: false,
    }));
    expect(postToRow('fb', { channel: 'facebook', publishedChannels: ['facebook', 'instagram'] }).canTakeDown).toBe(true);
    // A platform that reports no media type falls back to what the URL says.
    expect(nativePostToAnalyticsPost({ platform: 'threads', contentType: 'unknown', mediaUrl: 'https://cdn/a.jpg' }).contentTypeHint).toBe('image');
    expect(nativePostToAnalyticsPost({ platform: 'threads', contentType: 'unknown', mediaUrl: null }).contentTypeHint).toBe('text');
  });

  it('only treats a native document with a platform and a platform id as a native post', () => {
    expect(isNativePostDoc({ provenance: 'platform_native', platform: 'instagram', externalId: 'x' })).toBe(true);
    expect(isNativePostDoc({ provenance: 'markaestro', platform: 'instagram', externalId: 'x' })).toBe(false);
    expect(isNativePostDoc({ provenance: 'platform_native', platform: 'instagram' })).toBe(false);
  });

  it('schedules a discovered post for metrics at once', () => {
    expect(initialNativePollState('2026-09-06T10:00:00.000Z')).toEqual({
      metricsStatus: 'active',
      metricsPollStage: -1,
      metricsNextPollAt: '2026-09-06T10:00:00.000Z',
      metricsAttempts: 0,
    });
  });
});

describe('native import cadence', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  const lookback = 90 * DAY;

  it('walks the whole lookback on the first run and resumes a paused walk from its cursor', () => {
    expect(planNativeImportRun({}, now, lookback)).toEqual({ run: true, mode: 'initial', cursor: undefined, cutoffMs: now - lookback });
    expect(planNativeImportRun({ cursor: 'page_3', nextRunAt: new Date(now - 1000).toISOString() }, now, lookback))
      .toEqual({ run: true, mode: 'initial', cursor: 'page_3', cutoffMs: now - lookback });
  });

  it('re-runs a completed import on the refresh cadence, reading back to the overlap before the last completion', () => {
    const completedAt = new Date(now - 7 * DAY).toISOString();
    const state = { completedAt, cursor: null, nextRunAt: new Date(now - 7 * DAY + NATIVE_REFRESH_INTERVAL_MS).toISOString() };
    expect(planNativeImportRun(state, now, lookback)).toEqual({
      run: true,
      mode: 'incremental',
      cursor: undefined,
      cutoffMs: now - 7 * DAY - NATIVE_REFRESH_OVERLAP_MS,
    });
    // Not due yet: completed an hour ago.
    const fresh = { completedAt: new Date(now - 3600_000).toISOString(), nextRunAt: new Date(now - 3600_000 + NATIVE_REFRESH_INTERVAL_MS).toISOString() };
    expect(planNativeImportRun(fresh, now, lookback)).toEqual({ run: false, reason: 'not_due' });
  });

  it('never reads past the channel lookback, and honours leases and backoff', () => {
    const completedAt = new Date(now - 120 * DAY).toISOString();
    expect(planNativeImportRun({ completedAt }, now, 30 * DAY)).toEqual(expect.objectContaining({ mode: 'incremental', cutoffMs: now - 30 * DAY }));
    expect(planNativeImportRun({ leaseUntil: new Date(now + 60_000).toISOString() }, now, lookback)).toEqual({ run: false, reason: 'leased' });
    expect(planNativeImportRun({ nextRunAt: new Date(now + 60_000).toISOString() }, now, lookback)).toEqual({ run: false, reason: 'not_due' });
  });

  it('treats a cursor completed before the cadence existed as due for an incremental run', () => {
    expect(planNativeImportRun({ completedAt: new Date(now - 30 * DAY).toISOString(), nextRunAt: null }, now, lookback))
      .toEqual(expect.objectContaining({ run: true, mode: 'incremental' }));
  });
});
