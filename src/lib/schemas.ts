import { z } from 'zod';
import { postSettingsSchema } from '@/lib/public-api/post-settings';
import {
  LEGACY_EXPORTED_FOR_REVIEW_STATUS,
  PLATFORM_ACTION_REQUIRED_STATUS,
} from '@/lib/manual-publish-flow';

// ── Shared primitives ──────────────────────────────────────────────

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Invalid email format')
  .max(320, 'Email too long');

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name too long');

export const optionalString = z.string().trim().max(2000).default('');

/** Empty, or an http(s) URL. Bare hostnames like `acme.com` get https://. */
function withHttpScheme(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+-]*:/i.test(value)) return null;
  if (value.startsWith('//')) return `https:${value}`;
  return `https://${value}`;
}

export function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = withHttpScheme(trimmed);
  if (withScheme === null) return null;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return withScheme;
  } catch {
    return null;
  }
}

function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const digits = match?.[1];
  if (!digits) return null;
  const expanded = digits.length === 3
    ? digits.split('').map((ch) => ch + ch).join('')
    : digits;
  return `#${expanded.toUpperCase()}`;
}

function normalizedStringSchema(
  normalize: (raw: string) => string | null,
  message: string,
) {
  return z.string().transform((raw, ctx) => {
    const normalized = normalize(raw);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return normalized;
  });
}

export const websiteUrlSchema = normalizedStringSchema(normalizeWebsiteUrl, 'Invalid URL');
const hexColorSchema = normalizedStringSchema(normalizeHexColor, 'Invalid hex color');

export const tagsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50, 'Too many tags')
  .default([]);

// ── Enums ──────────────────────────────────────────────────────────

export const socialChannels = ['facebook', 'instagram', 'tiktok', 'threads', 'pinterest', 'linkedin'] as const;
export const postStatuses = ['draft', 'scheduled', 'publishing', 'published', 'platform_action_required', 'failed', 'partial_failed'] as const;

/**
 * Statuses whose publish state (externalId, publishResults, retry markers) may
 * be cleared when a post's content changes.
 *
 * A `published` post is deliberately absent: its externalId is the only handle
 * the metrics poller has on the live platform post, so blanking it silently
 * drops the post out of analytics forever. `publishing` is absent because the
 * publisher is mid-flight and owns those fields.
 *
 * `POST /api/public/v1/posts/[id]/publish` gates on this same list, so the two
 * surfaces cannot drift.
 */
export const RESETTABLE_PUBLISH_STATES = [
  'draft',
  'scheduled',
  'failed',
  'partial_failed',
  PLATFORM_ACTION_REQUIRED_STATUS,
  LEGACY_EXPORTED_FOR_REVIEW_STATUS,
] as const;

export function isResettablePublishState(status: unknown): boolean {
  return RESETTABLE_PUBLISH_STATES.includes(status as (typeof RESETTABLE_PUBLISH_STATES)[number]);
}
export const contactStatuses = ['active', 'pending', 'bounced', 'unsubscribed'] as const;
export const contactLifecycleStages = ['lead', 'trial', 'customer', 'churned', 'advocate'] as const;
export const contactSources = ['organic', 'paid', 'referral', 'social', 'email', 'direct', 'other'] as const;
export const triggerTypes = ['manual', 'event', 'schedule', 'segment'] as const;
export const jobTypes = ['sync_contacts', 'publish_post', 'refresh_tokens'] as const;
export const jobSchedules = ['manual', 'daily'] as const;
export const integrationProviders = ['facebook', 'instagram', 'meta', 'tiktok', 'threads', 'pinterest', 'linkedin'] as const;
export const oauthProviders = ['meta', 'instagram', 'tiktok', 'threads', 'pinterest', 'linkedin'] as const;
export const workspaceRoles = ['owner', 'admin', 'member', 'analyst'] as const;

// ── Contact Schemas ────────────────────────────────────────────────

export const createContactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  status: z.enum(contactStatuses).default('active'),
  lifecycleStage: z.enum(contactLifecycleStages).default('lead'),
  source: z.enum(contactSources).default('direct'),
  tags: tagsSchema,
  productId: optionalString,
  notes: optionalString,
});

export const updateContactSchema = z.object({
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  status: z.enum(contactStatuses).optional(),
  lifecycleStage: z.enum(contactLifecycleStages).optional(),
  source: z.enum(contactSources).optional(),
  tags: tagsSchema.optional(),
  productId: optionalString.optional(),
  notes: optionalString.optional(),
});

// ── Automation Schemas ─────────────────────────────────────────────

export const automationActionTypes = [
  'wait', 'update_tag', 'update_lifecycle',
  'send_notification', 'webhook',
] as const;

const automationStepSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(automationActionTypes),
  config: z.record(z.string(), z.unknown()).default({}),
  delayMinutes: z.number().int().min(0).default(0),
});

export const createAutomationSchema = z.object({
  name: nameSchema,
  enabled: z.boolean().default(false),
  triggerType: z.enum(triggerTypes).default('manual'),
  triggerConfig: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(automationStepSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateAutomationSchema = z.object({
  name: nameSchema.optional(),
  enabled: z.boolean().optional(),
  triggerType: z.enum(triggerTypes).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(automationStepSchema).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type AutomationStep = z.infer<typeof automationStepSchema>;
export type AutomationActionType = (typeof automationActionTypes)[number];

// ── Job Schemas ────────────────────────────────────────────────────

export const createJobSchema = z.object({
  name: nameSchema,
  type: z.enum(jobTypes).default('sync_contacts'),
  enabled: z.boolean().default(true),
  schedule: z.enum(jobSchedules).default('manual'),
  hourUTC: z.number().int().min(0).max(23).default(15),
  minuteUTC: z.number().int().min(0).max(59).default(0),
  payload: z.record(z.string(), z.unknown()).default({}),
});

// ── Product Knowledge Schema ──────────────────────────────────────

export const productFeatureSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(''),
  benefit: z.string().trim().max(500).default(''),
});

export const proofPointSchema = z.object({
  type: z.enum(['stat', 'testimonial', 'award', 'press']),
  content: z.string().trim().min(1).max(1000),
  source: z.string().trim().max(200).default(''),
});

export const productKnowledgeSchema = z.object({
  features: z.array(productFeatureSchema).max(20).default([]),
  usps: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  painPoints: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  proofPoints: z.array(proofPointSchema).max(20).default([]),
  targetAudienceDemographics: z.string().trim().max(500).default(''),
  targetAudiencePsychographics: z.string().trim().max(500).default(''),
  targetAudiencePainStatement: z.string().trim().max(500).default(''),
  targetAudienceDesiredOutcome: z.string().trim().max(500).default(''),
  competitors: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  differentiators: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  positioning: z.string().trim().max(1000).default(''),
  productImages: z.array(z.string().url()).max(10).default([]),
  contentAngles: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  lastEnrichedAt: z.string().datetime().optional(),
  enrichmentSource: z.enum(['manual', 'url_import']).optional(),
});

// ── Brand Voice Schema ────────────────────────────────────────────

export const brandVoiceSchema = z.object({
  tone: z.string().trim().max(200).default(''),
  style: z.string().trim().max(200).default(''),
  keywords: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  avoidWords: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  cta: z.string().trim().max(500).default(''),
  sampleVoice: z.string().trim().max(2000).default(''),
  targetAudience: z.string().trim().max(500).default(''),
});

// ── Brand Identity Schema ─────────────────────────────────────────

export const brandIdentitySchema = z.object({
  logoUrl: z.string().trim().max(4096).default(''),
  primaryColor: hexColorSchema.default(''),
  secondaryColor: hexColorSchema.default(''),
  accentColor: hexColorSchema.default(''),
});

// ── Product Schemas ────────────────────────────────────────────────

export const productStatuses = ['active', 'beta', 'development', 'sunset', 'archived'] as const;
export const productCategories = [
  'saas', 'mobile', 'web', 'api', 'marketplace', 'ecommerce', 'fintech',
  'healthtech', 'edtech', 'gaming', 'social', 'productivity', 'developer-tools',
  'ai', 'media', 'agency', 'creator', 'hardware', 'nonprofit',
  // Non-software brands — Markaestro serves businesses, creators, and
  // personal brands, not just product companies. Additive only so existing
  // documents keep validating.
  'local-business', 'personal-brand', 'fashion-beauty', 'food-restaurant',
  'music-entertainment', 'real-estate', 'coaching-services', 'fitness',
  'travel-hospitality',
  'other',
] as const;

const categoryEnum = z.enum(productCategories);
const PRODUCT_CATEGORY_SET: ReadonlySet<string> = new Set(productCategories);
const categoryListSchema = z.array(categoryEnum).min(1, 'Select at least one category');

function asCategoryItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function coerceCategories(value: unknown): string[] {
  const raw = asCategoryItems(value);
  const cleaned = raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => PRODUCT_CATEGORY_SET.has(item));
  if (cleaned.length > 0) return cleaned;
  if (raw.length > 0) return ['other'];
  return ['saas'];
}

const categoriesSchema = z.preprocess(coerceCategories, categoryListSchema);

export const createProductSchema = z.object({
  name: nameSchema,
  description: optionalString,
  url: websiteUrlSchema.default(''),
  categories: categoriesSchema,
  status: z.enum(productStatuses).default('active'),
  brandVoice: brandVoiceSchema.optional(),
  brandIdentity: brandIdentitySchema.optional(),
  knowledge: productKnowledgeSchema.optional(),
});

export const updateProductSchema = z.object({
  name: nameSchema.optional(),
  description: optionalString.optional(),
  url: websiteUrlSchema.optional(),
  categories: z.preprocess(
    (value) => (value === undefined ? undefined : coerceCategories(value)),
    categoryListSchema.optional(),
  ),
  status: z.enum(productStatuses).optional(),
  brandVoice: brandVoiceSchema.optional(),
  brandIdentity: brandIdentitySchema.optional(),
  knowledge: productKnowledgeSchema.optional(),
});

// ── Integration Schemas ────────────────────────────────────────────

export const metaIntegrationSchema = z.object({
  accessToken: z.string().trim().min(1, 'Access token is required'),
  pageId: optionalString,
  igAccountId: optionalString,
  enabled: z.boolean().default(true),
});

// ── Post Schemas ──────────────────────────────────────────────────

/**
 * Calendar window for GET /api/posts. Bounds the result set by the date a post
 * actually lands on rather than by recency, so a month view can load every
 * post it needs to draw.
 */
export const postWindowSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Which linked account each channel publishes to, keyed by channel. A brand can
 * link several Facebook Pages (or Instagram accounts, LinkedIn Pages, …), so a
 * post names the one it means rather than relying on a single per-channel slot.
 *
 * partialRecord, not record: with an enum key, Zod v4's z.record() is
 * exhaustive and demands an entry for every channel, so a post naming just the
 * one channel it targets failed with invalid_type on all the others. A post
 * only ever names the channels it publishes to.
 */
export const channelDestinationsSchema = z.partialRecord(
  z.enum(socialChannels),
  z.string().trim().max(2000),
);

/**
 * Per-target delivery mode. Partial for the same reason as
 * `channelDestinationsSchema`: a post only names the channels it targets.
 */
export const channelDeliveryModesSchema = z.partialRecord(
  z.enum(socialChannels),
  z.enum(['direct_publish', 'platform_inbox', 'manual_reminder']),
);

export const createPostSchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(65000),
  channel: z.enum(socialChannels),
  status: z.enum(postStatuses).default('draft'),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).max(35).default([]),
  productId: optionalString,
  targetChannels: z.array(z.enum(socialChannels)).optional(),
  destinationId: z.string().trim().max(2000).optional(),
  destinationProvider: z.string().trim().max(100).optional(),
  channelDestinations: channelDestinationsSchema.optional(),
  deliveryMode: z.enum(['direct_publish', 'platform_inbox', 'manual_reminder']).optional(),
  /**
   * Per-target delivery mode. Server-resolved on create from the workspace's
   * manual-publish settings; the post-level `deliveryMode` above stays as the
   * fallback for documents written before this map existed.
   */
  channelDeliveryModes: channelDeliveryModesSchema.optional(),
  settings: postSettingsSchema.optional(),
});

export const updatePostSchema = z.object({
  content: z.string().trim().min(1).max(65000).optional(),
  channel: z.enum(socialChannels).optional(),
  status: z.enum(postStatuses).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).max(35).optional(),
  productId: z.string().trim().max(2000).optional(),
  externalId: z.string().trim().max(500).optional(),
  externalUrl: z.string().trim().max(2000).optional(),
  errorMessage: z.string().trim().max(2000).optional(),
  targetChannels: z.array(z.enum(socialChannels)).optional(),
  destinationId: z.string().trim().max(2000).optional(),
  destinationProvider: z.string().trim().max(100).optional(),
  channelDestinations: channelDestinationsSchema.optional(),
  deliveryMode: z.enum(['direct_publish', 'platform_inbox', 'manual_reminder']).optional(),
  /**
   * Per-target delivery mode. Server-resolved on create from the workspace's
   * manual-publish settings; the post-level `deliveryMode` above stays as the
   * fallback for documents written before this map existed.
   */
  channelDeliveryModes: channelDeliveryModesSchema.optional(),
  settings: postSettingsSchema.optional(),
});

// ── Pagination ─────────────────────────────────────────────────────

export const paginationSchema = z.object({
  // Ceiling raised from 200 so list views that paginate client-side can load a
  // complete set — a workspace can hold hundreds of posts of one status, and a
  // lower cap silently hid the remainder.
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  cursor: z.string().optional(),
  status: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});

// ── Type Exports ───────────────────────────────────────────────────

export type CreateContact = z.infer<typeof createContactSchema>;
export type UpdateContact = z.infer<typeof updateContactSchema>;
export type CreateAutomation = z.infer<typeof createAutomationSchema>;
export type UpdateAutomation = z.infer<typeof updateAutomationSchema>;
export type CreateJob = z.infer<typeof createJobSchema>;
export type ContactStatus = (typeof contactStatuses)[number];
export type IntegrationProvider = (typeof integrationProviders)[number];
export type OAuthProvider = (typeof oauthProviders)[number];
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type ProductStatus = (typeof productStatuses)[number];
export type ProductCategory = (typeof productCategories)[number];
export type BrandVoice = z.infer<typeof brandVoiceSchema>;
export type BrandIdentity = z.infer<typeof brandIdentitySchema>;
export type CreatePost = z.infer<typeof createPostSchema>;
export type UpdatePost = z.infer<typeof updatePostSchema>;
export type SocialChannel = (typeof socialChannels)[number];
export type PostStatus = (typeof postStatuses)[number];
export type JobType = (typeof jobTypes)[number];
export type ProductFeature = z.infer<typeof productFeatureSchema>;
export type ProofPoint = z.infer<typeof proofPointSchema>;
export type ProductKnowledge = z.infer<typeof productKnowledgeSchema>;
