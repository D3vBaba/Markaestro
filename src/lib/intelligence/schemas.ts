import { z } from 'zod';
import { socialChannels, websiteUrlSchema } from '@/lib/schemas';

export const businessObjectives = [
  'awareness',
  'engagement',
  'followers',
  'website_traffic',
  'leads',
  'app_installs',
  'purchases',
  'other',
] as const;

export const conversionActions = [
  'none',
  'website_visit',
  'lead',
  'signup',
  'app_install',
  'purchase',
  'custom',
] as const;

const shortText = z.string().trim().max(300);
const stringList = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max).default([]);

export const targetMarketSchema = z.object({
  /** ISO-3166 alpha-2 when the target is a country; region codes are also accepted. */
  code: z.string().trim().min(2).max(20).transform((value) => value.toUpperCase()),
  label: z.string().trim().min(1).max(100),
  weight: z.number().min(0).max(100),
  priority: z.enum(['primary', 'secondary']).default('secondary'),
});

export const ageBandSchema = z.object({
  min: z.number().int().min(13).max(100),
  max: z.number().int().min(13).max(100),
  weight: z.number().min(0).max(100).optional(),
}).refine((band) => band.max >= band.min, { message: 'Age-band maximum must be at least its minimum.' });

export const audienceIntelligenceProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  objective: z.enum(businessObjectives).default('awareness'),
  customObjective: z.string().trim().max(300).default(''),
  targetMarkets: z.array(targetMarketSchema).max(30).default([]),
  ageBands: z.array(ageBandSchema).max(10).default([]),
  genderFocus: z.array(z.enum(['women', 'men', 'nonbinary', 'all'])).max(4).default(['all']),
  industries: stringList(30),
  interests: stringList(50),
  personas: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
  })).max(20).default([]),
  brandVoice: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return value;
  }, stringList(15)),
  contentPillars: stringList(30),
  businessDescription: z.string().trim().max(5000).default(''),
  conversionAction: z.enum(conversionActions).default('none'),
  customConversionAction: shortText.default(''),
  conversionDestination: websiteUrlSchema.default(''),
  primaryTimezone: z.string().trim().min(1).max(100).default('UTC'),
  platformPriorities: z.preprocess((value) => {
    if (!Array.isArray(value)) return value;
    const cleaned = value
      .filter((item): item is { platform: string; priority: number } => (
        !!item
        && typeof item === 'object'
        && typeof (item as { platform?: unknown }).platform === 'string'
        && typeof (item as { priority?: unknown }).priority === 'number'
      ))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, socialChannels.length)
      .map((item, index) => ({
        platform: item.platform,
        priority: index + 1,
      }));
    return cleaned;
  }, z.array(z.object({
    platform: z.enum(socialChannels),
    priority: z.number().int().min(1).max(socialChannels.length),
  })).max(socialChannels.length).default([])),
  excludedAudiences: stringList(30),
  excludedMarkets: stringList(30),
}).superRefine((profile, ctx) => {
  const total = profile.targetMarkets.reduce((sum, market) => sum + market.weight, 0);
  if (profile.targetMarkets.length > 0 && Math.abs(total - 100) > 0.01) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetMarkets'],
      message: 'Target-market weights must total 100.',
    });
  }
  if (profile.objective === 'other' && !profile.customObjective) {
    ctx.addIssue({ code: 'custom', path: ['customObjective'], message: 'A custom objective is required.' });
  }
  if (profile.conversionAction === 'custom' && !profile.customConversionAction) {
    ctx.addIssue({ code: 'custom', path: ['customConversionAction'], message: 'A custom conversion action is required.' });
  }
});

export type AudienceIntelligenceProfile = z.infer<typeof audienceIntelligenceProfileSchema>;
export type BusinessObjective = (typeof businessObjectives)[number];
export type ConversionAction = (typeof conversionActions)[number];

export function defaultAudienceProfile(
  partial: Partial<AudienceIntelligenceProfile> = {},
): AudienceIntelligenceProfile {
  return audienceIntelligenceProfileSchema.parse(partial);
}

export const intelligenceTrustKinds = ['measured', 'calculated', 'predicted', 'recommended'] as const;
export type IntelligenceTrustKind = (typeof intelligenceTrustKinds)[number];

