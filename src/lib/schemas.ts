import { z } from 'zod';

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

export const tagsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50, 'Too many tags')
  .default([]);

// ── Enums ──────────────────────────────────────────────────────────

export const socialChannels = ['facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'pinterest', 'youtube'] as const;
export const postStatuses = ['draft', 'scheduled', 'publishing', 'published', 'exported_for_review', 'failed'] as const;
export const contactStatuses = ['active', 'pending', 'bounced', 'unsubscribed'] as const;
export const contactLifecycleStages = ['lead', 'trial', 'customer', 'churned', 'advocate'] as const;
export const contactSources = ['organic', 'paid', 'referral', 'social', 'email', 'direct', 'other'] as const;
export const triggerTypes = ['manual', 'event', 'schedule', 'segment'] as const;
export const jobTypes = ['sync_contacts', 'publish_post', 'refresh_tokens'] as const;
export const jobSchedules = ['manual', 'daily'] as const;
export const integrationProviders = ['facebook', 'instagram', 'meta', 'tiktok', 'linkedin', 'threads', 'pinterest', 'youtube'] as const;
export const oauthProviders = ['meta', 'instagram', 'tiktok', 'linkedin', 'threads', 'pinterest', 'youtube'] as const;
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
  logoUrl: z.string().trim().max(2000).default(''),
  primaryColor: z.string().trim().regex(/^$|^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').default(''),
  secondaryColor: z.string().trim().regex(/^$|^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').default(''),
  accentColor: z.string().trim().regex(/^$|^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').default(''),
});

// ── Product Schemas ────────────────────────────────────────────────

export const productStatuses = ['active', 'beta', 'development', 'sunset', 'archived'] as const;
export const productCategories = ['saas', 'mobile', 'web', 'api', 'marketplace', 'other'] as const;

const categoryEnum = z.enum(productCategories);
const categoriesSchema = z
  .array(categoryEnum)
  .min(1, 'Select at least one category')
  .default(['saas']);

export const createProductSchema = z.object({
  name: nameSchema,
  description: optionalString,
  url: z.string().trim().url('Invalid URL').or(z.literal('')).default(''),
  categories: categoriesSchema,
  status: z.enum(productStatuses).default('active'),
  pricingTier: optionalString,
  tags: tagsSchema,
  brandVoice: brandVoiceSchema.optional(),
  brandIdentity: brandIdentitySchema.optional(),
  knowledge: productKnowledgeSchema.optional(),
});

export const updateProductSchema = z.object({
  name: nameSchema.optional(),
  description: optionalString.optional(),
  url: z.string().trim().url('Invalid URL').or(z.literal('')).optional(),
  categories: categoriesSchema.optional(),
  status: z.enum(productStatuses).optional(),
  pricingTier: optionalString.optional(),
  tags: tagsSchema.optional(),
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

export const createPostSchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(65000),
  channel: z.enum(socialChannels),
  status: z.enum(postStatuses).default('draft'),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  productId: optionalString,
  targetChannels: z.array(z.enum(socialChannels)).optional(),
  destinationProvider: z.string().trim().max(100).optional(),
  deliveryMode: z.enum(['direct_publish', 'user_review']).optional(),
});

export const updatePostSchema = z.object({
  content: z.string().trim().min(1).max(65000).optional(),
  channel: z.enum(socialChannels).optional(),
  status: z.enum(postStatuses).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  productId: z.string().trim().max(2000).optional(),
  externalId: z.string().trim().max(500).optional(),
  externalUrl: z.string().trim().max(2000).optional(),
  errorMessage: z.string().trim().max(2000).optional(),
  targetChannels: z.array(z.enum(socialChannels)).optional(),
  destinationProvider: z.string().trim().max(100).optional(),
  deliveryMode: z.enum(['direct_publish', 'user_review']).optional(),
});

// ── Pagination ─────────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
