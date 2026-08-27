import { describe, expect, it } from 'vitest';
import { socialChannels } from '@/lib/schemas';
import {
  PLATFORM_CAPABILITY_REGISTRY,
  resolvePlatformCapabilities,
  assertMetricsSupported,
} from '@/lib/platform/capabilities';
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
});
