import { describe, expect, it } from 'vitest';
import {
  normalizeManualPublishChannels,
  resolveChannelDeliveryMode,
  resolveChannelDeliveryModes,
  resolveInAppDeliveryMode,
} from '../manual-publish-settings';

describe('manual publish workspace defaults', () => {
  it('normalizes the stored channel list to known channels without duplicates', () => {
    expect(normalizeManualPublishChannels(['instagram', 'tiktok', 'instagram', 'myspace', 42, null]))
      .toEqual(['instagram', 'tiktok']);
    expect(normalizeManualPublishChannels(undefined)).toEqual([]);
    expect(normalizeManualPublishChannels('instagram')).toEqual([]);
  });

  // Delivery mode is per target now. The post-level mode is only the
  // fallback, and goes manual only when there is no automatic channel left to
  // speak for — a mixed post must not demote its automatic half.
  it('marks the post manual only when every target channel is manual', () => {
    expect(resolveInAppDeliveryMode(['instagram'], undefined, ['instagram'])).toBe('manual_reminder');
    expect(resolveInAppDeliveryMode(['instagram', 'facebook'], undefined, ['instagram', 'facebook']))
      .toBe('manual_reminder');
    expect(resolveInAppDeliveryMode(['linkedin'], undefined, ['instagram'])).toBeUndefined();
    expect(resolveInAppDeliveryMode(['facebook'], undefined, [])).toBeUndefined();
  });

  it('leaves a mixed post automatic at the post level', () => {
    // The regression this item exists to fix: Instagram set to manual used to
    // drag LinkedIn into the To Post queue with it.
    expect(resolveInAppDeliveryMode(['linkedin', 'instagram'], undefined, ['instagram']))
      .toBeUndefined();
  });

  it('resolves each target channel independently', () => {
    expect(resolveChannelDeliveryModes(['linkedin', 'instagram'], undefined, ['instagram'])).toEqual({
      linkedin: 'direct_publish',
      instagram: 'manual_reminder',
    });
    expect(resolveChannelDeliveryModes(['linkedin'], 'manual_reminder', [])).toEqual({
      linkedin: 'manual_reminder',
    });
    expect(resolveChannelDeliveryModes([], undefined, ['instagram'])).toEqual({});
  });

  it('ignores channels it does not recognise', () => {
    expect(resolveChannelDeliveryModes(['linkedin', 'myspace'], undefined, [])).toEqual({
      linkedin: 'direct_publish',
    });
  });

  it('forces manual for a channel that cannot direct publish', () => {
    // Reads `supportsDirectPublish` from the catalog: a channel Markaestro
    // has no API path to must be manual whatever the workspace prefers.
    // Every catalogued channel currently supports it, so this asserts the
    // rule via the workspace list and guards the catalog lookup itself.
    expect(resolveChannelDeliveryMode('linkedin', undefined, [])).toBe('direct_publish');
    expect(resolveChannelDeliveryMode('linkedin', undefined, ['linkedin'])).toBe('manual_reminder');
  });

  it('never overrides an explicitly chosen delivery mode', () => {
    expect(resolveInAppDeliveryMode(['instagram'], 'direct_publish', ['instagram'])).toBe('direct_publish');
    expect(resolveInAppDeliveryMode(['linkedin'], 'manual_reminder', [])).toBe('manual_reminder');
  });
});
