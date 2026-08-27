import { describe, expect, it } from 'vitest';
import { audienceIntelligenceProfileSchema } from '@/lib/intelligence/schemas';

describe('audienceIntelligenceProfileSchema', () => {
  it('accepts a weighted, product-level audience profile', () => {
    const profile = audienceIntelligenceProfileSchema.parse({
      objective: 'website_traffic',
      targetMarkets: [
        { code: 'us', label: 'United States', weight: 80, priority: 'primary' },
        { code: 'ca', label: 'Canada', weight: 20, priority: 'secondary' },
      ],
      conversionAction: 'website_visit',
      conversionDestination: 'https://example.com',
      primaryTimezone: 'America/New_York',
    });
    expect(profile.targetMarkets[0].code).toBe('US');
  });

  it('rejects misleading market distributions that do not total 100', () => {
    expect(() => audienceIntelligenceProfileSchema.parse({
      targetMarkets: [{ code: 'US', label: 'United States', weight: 80 }],
    })).toThrow();
  });

  it('coerces legacy brandVoice strings into tag arrays', () => {
    const profile = audienceIntelligenceProfileSchema.parse({
      brandVoice: 'professional, friendly',
    });
    expect(profile.brandVoice).toEqual(['professional', 'friendly']);
  });

  it('prepends https:// on a conversion destination typed without a scheme', () => {
    const profile = audienceIntelligenceProfileSchema.parse({
      conversionDestination: 'acme.com/signup',
    });
    expect(profile.conversionDestination).toBe('https://acme.com/signup');
  });

  it('renumbers oversized platform priorities into the valid 1..n range', () => {
    const profile = audienceIntelligenceProfileSchema.parse({
      platformPriorities: [
        { platform: 'facebook', priority: 1 },
        { platform: 'instagram', priority: 3 },
        { platform: 'tiktok', priority: 4 },
        { platform: 'threads', priority: 5 },
        { platform: 'pinterest', priority: 6 },
        { platform: 'linkedin', priority: 7 },
      ],
    });
    expect(profile.platformPriorities.map((item) => item.priority)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(profile.platformPriorities[0]?.platform).toBe('facebook');
    expect(profile.platformPriorities.at(-1)?.platform).toBe('linkedin');
  });
});

