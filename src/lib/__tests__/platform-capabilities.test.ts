import { describe, expect, it } from 'vitest';
import { socialChannels } from '@/lib/schemas';
import {
  PLATFORM_CAPABILITY_REGISTRY,
  publishingCapabilitiesFor,
  publishingContractViolation,
  resolvePlatformCapabilities,
  assertMetricsSupported,
} from '@/lib/platform/capabilities';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
import { emptyMetrics } from '@/lib/platform/base-adapter';
import { normalizedMetricKeys } from '@/lib/platform/types';

describe('PlatformCapabilityRegistry', () => {
  it('has a complete metric contract for every supported social channel', () => {
    expect(Object.keys(PLATFORM_CAPABILITY_REGISTRY).sort()).toEqual([...socialChannels].sort());
    for (const channel of socialChannels) {
      expect(Object.keys(PLATFORM_CAPABILITY_REGISTRY[channel].metrics).sort())
        .toEqual([...normalizedMetricKeys].sort());
    }
  });

  it('marks supported metrics missing_scope when a connection predates required grants', () => {
    const resolved = resolvePlatformCapabilities('tiktok', ['user.info.basic']);
    expect(resolved.metrics.views.state).toBe('missing_scope');
    expect(resolved.metrics.views.missingScopes).toEqual(['video.list']);
    expect(resolved.metrics.reach.state).toBe('unsupported');
  });

  it('does not advertise unavailable TikTok analytics', () => {
    const tiktok = PLATFORM_CAPABILITY_REGISTRY.tiktok.metrics;
    expect(tiktok.watchTimeSeconds.state).toBe('unsupported');
    expect(tiktok.averageWatchTimeSeconds.state).toBe('unsupported');
    expect(tiktok.saves.state).toBe('unsupported');
    expect(tiktok.reach.state).toBe('unsupported');
  });

  it('distinguishes account eligibility from platform support', () => {
    expect(PLATFORM_CAPABILITY_REGISTRY.instagram.metrics.watchTimeSeconds.state)
      .toBe('account_ineligible');
    expect(PLATFORM_CAPABILITY_REGISTRY.pinterest.audienceDimensions.interests.state)
      .toBe('account_ineligible');
  });

  it('rejects adapter output for a metric absent from the platform contract', () => {
    const supported = emptyMetrics();
    supported.views = 12;
    expect(() => assertMetricsSupported('tiktok', supported)).not.toThrow();
    const unsupported = emptyMetrics();
    unsupported.reach = 12;
    expect(() => assertMetricsSupported('tiktok', unsupported))
      .toThrow('PLATFORM_CAPABILITY_CONTRACT:tiktok:reach');
  });

  it('keeps the declared publishing contract equal to the catalog it describes', () => {
    // The registry's `publishing` block and the catalog's `mediaKinds` are two
    // statements of one fact. This is the test that fails when they drift, and
    // it failed on Pinterest (declared carousel: false, catalog allowed 5
    // media items, adapter built a real multi-image pin) before that was
    // fixed.
    for (const channel of socialChannels) {
      expect({ channel, ...PLATFORM_CAPABILITY_REGISTRY[channel].publishing })
        .toEqual({ channel, ...publishingCapabilitiesFor(channel) });
    }
  });

  it('derives carousel support from the catalog, not a hand-maintained boolean', () => {
    expect(publishingCapabilitiesFor('pinterest').carousel).toBe(true);
    expect(publishingCapabilitiesFor('tiktok').carousel).toBe(false);
    expect(publishingCapabilitiesFor('instagram').text).toBe(false);
    expect(publishingCapabilitiesFor('facebook').text).toBe(true);
  });
});

describe('publishingContractViolation', () => {
  it('accepts a payload every channel in the catalog allows', () => {
    expect(publishingContractViolation('instagram', { hasText: true, imageCount: 1, videoCount: 0 }))
      .toBeNull();
    expect(publishingContractViolation('facebook', { hasText: true, imageCount: 0, videoCount: 0 }))
      .toBeNull();
    expect(publishingContractViolation('pinterest', { hasText: true, imageCount: 3, videoCount: 0 }))
      .toBeNull();
  });

  it('refuses a text-only post on a channel that requires media', () => {
    expect(publishingContractViolation('instagram', { hasText: true, imageCount: 0, videoCount: 0 }))
      .toContain('requires at least one image or video');
  });

  it('allows a TikTok photo post, which is multi-image without being a carousel', () => {
    // Gating multi-image on the `carousel` flag would refuse a post the
    // product has always supported: TikTok photo posts carry up to 35 images
    // and TikTok does not call them carousels. The numeric limit is the real
    // constraint.
    expect(publishingContractViolation('tiktok', { hasText: true, imageCount: 5, videoCount: 0 }))
      .toBeNull();
  });

  it('refuses more media than the channel accepts, naming both numbers', () => {
    const violation = publishingContractViolation('tiktok', {
      hasText: true,
      imageCount: 40,
      videoCount: 0,
    });
    expect(violation).toContain('35');
    expect(violation).toContain('40');
  });

  it('states the actual ceiling when a post exceeds it', () => {
    const limit = getSocialChannelConfig('pinterest')!.maxMediaItems;
    const violation = publishingContractViolation('pinterest', {
      hasText: true,
      imageCount: limit + 1,
      videoCount: 0,
    });
    expect(violation).toContain(String(limit));
    expect(violation).toContain(String(limit + 1));
  });

  it('refuses a post with neither a caption nor media', () => {
    expect(publishingContractViolation('facebook', { hasText: false, imageCount: 0, videoCount: 0 }))
      .toContain('caption');
  });
});
