import { describe, expect, it } from 'vitest';
import {
  normalizeManualPublishChannels,
  resolveInAppDeliveryMode,
} from '../manual-publish-settings';

describe('manual publish workspace defaults', () => {
  it('normalizes the stored channel list to known channels without duplicates', () => {
    expect(normalizeManualPublishChannels(['instagram', 'tiktok', 'instagram', 'myspace', 42, null]))
      .toEqual(['instagram', 'tiktok']);
    expect(normalizeManualPublishChannels(undefined)).toEqual([]);
    expect(normalizeManualPublishChannels('instagram')).toEqual([]);
  });

  it('defaults posts to manual when any target channel is set to manual', () => {
    expect(resolveInAppDeliveryMode(['instagram'], undefined, ['instagram'])).toBe('manual_reminder');
    expect(resolveInAppDeliveryMode(['linkedin', 'instagram'], undefined, ['instagram'])).toBe('manual_reminder');
    expect(resolveInAppDeliveryMode(['linkedin'], undefined, ['instagram'])).toBeUndefined();
    expect(resolveInAppDeliveryMode(['facebook'], undefined, [])).toBeUndefined();
  });

  it('never overrides an explicitly chosen delivery mode', () => {
    expect(resolveInAppDeliveryMode(['instagram'], 'direct_publish', ['instagram'])).toBe('direct_publish');
    expect(resolveInAppDeliveryMode(['linkedin'], 'manual_reminder', [])).toBe('manual_reminder');
  });
});
