import { describe, expect, it } from 'vitest';
import {
  canAccessIntelligencePreview,
  INTELLIGENCE_PREVIEW_EMAIL,
  INTELLIGENCE_PREVIEW_UID,
} from '@/lib/intelligence/preview-access';
import { navigationGroupsForUser } from '@/lib/nav';

describe('intelligence preview access', () => {
  it('allows the preview account by email or uid', () => {
    expect(canAccessIntelligencePreview({ email: INTELLIGENCE_PREVIEW_EMAIL })).toBe(true);
    expect(canAccessIntelligencePreview({ uid: INTELLIGENCE_PREVIEW_UID })).toBe(true);
    expect(canAccessIntelligencePreview({ email: 'other@example.com', uid: 'other_uid' })).toBe(false);
  });

  it('hides intelligence nav for other users', () => {
    const previewNav = navigationGroupsForUser(INTELLIGENCE_PREVIEW_EMAIL, INTELLIGENCE_PREVIEW_UID);
    const otherNav = navigationGroupsForUser('other@example.com', 'other_uid');
    expect(previewNav.flatMap((group) => group.items).some((item) => item.href === '/intelligence')).toBe(true);
    expect(otherNav.flatMap((group) => group.items).some((item) => item.href === '/intelligence')).toBe(false);
  });
});
