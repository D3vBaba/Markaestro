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

export const campaignChannels = ['email', 'x', 'tiktok', 'facebook', 'instagram', 'sms'] as const;
export const campaignStatuses = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'] as const;
export const socialChannels = ['x', 'facebook', 'instagram', 'tiktok'] as const;
export const postStatuses = ['draft', 'scheduled', 'publishing', 'published', 'failed'] as const;
export const contactStatuses = ['active', 'pending', 'bounced', 'unsubscribed'] as const;
export const contactLifecycleStages = ['lead', 'trial', 'customer', 'churned', 'advocate'] as const;
export const contactSources = ['organic', 'paid', 'referral', 'social', 'email', 'direct', 'other'] as const;
export const triggerTypes = ['manual', 'event', 'schedule', 'segment'] as const;
export const jobTypes = ['send_email_campaign', 'sync_contacts', 'generate_content', 'publish_post', 'create_ad_campaign', 'refresh_tokens', 'sync_ad_metrics'] as const;
export const jobSchedules = ['manual', 'daily'] as const;
export const integrationProviders = ['resend', 'facebook', 'instagram', 'x', 'meta', 'google', 'tiktok'] as const;
export const oauthProviders = ['meta', 'google', 'tiktok', 'x'] as const;
export const workspaceRoles = ['owner', 'admin', 'member'] as const;

// ── Pipeline Enums ────────────────────────────────────────────────

export const campaignTypes = ['standard', 'pipeline'] as const;
export const pipelineStages = ['awareness', 'interest', 'consideration', 'trial', 'activation', 'retention'] as const;
export const pipelineCadences = ['daily', '3x_week', '2x_week', 'weekly'] as const;
export const pipelineStatuses = ['pending_research', 'researching', 'research_complete', 'generating', 'generating_images', 'generated', 'scheduling', 'scheduled', 'failed'] as const;

// ── Pipeline Sub-Schemas ──────────────────────────────────────────

export const pipelineConfigSchema = z.object({
  channels: z.array(z.enum(socialChannels)).min(1, 'Select at least one channel'),
  cadence: z.enum(pipelineCadences).default('3x_week'),
  postCount: z.number().int().min(3).max(30).default(20),
  startDate: z.string().datetime(),
  stages: z.array(z.enum(pipelineStages)).default([...pipelineStages]),
  postTimeHourUTC: z.number().int().min(0).max(23).default(10),
});

export const researchBriefSchema = z.object({
  competitors: z.array(z.object({
    name: z.string(),
    positioning: z.string(),
    strengths: z.string(),
    weaknesses: z.string(),
  })),
  trends: z.array(z.object({
    trend: z.string(),
    relevance: z.string(),
    contentAngle: z.string(),
  })),
  productInsights: z.object({
    keyMessages: z.array(z.string()),
    uniqueValueProp: z.string(),
    audiencePainPoints: z.array(z.string()),
    toneRecommendations: z.string(),
  }),
  generatedAt: z.string().datetime(),
});

// ── Campaign Schemas ───────────────────────────────────────────────

export const createCampaignSchema = z.object({
  name: nameSchema,
  channel: z.enum(campaignChannels).default('email'),
  status: z.enum(campaignStatuses).default('draft'),
  targetAudience: optionalString,
  cta: optionalString,
  scheduledAt: z.string().datetime().nullable().optional(),
  subject: optionalString,
  body: optionalString,
  productId: optionalString,
  type: z.enum(campaignTypes).default('standard'),
  pipeline: pipelineConfigSchema.optional(),
});

export const updateCampaignSchema = z.object({
  name: nameSchema.optional(),
  channel: z.enum(campaignChannels).optional(),
  status: z.enum(campaignStatuses).optional(),
  targetAudience: optionalString.optional(),
  cta: optionalString.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  subject: optionalString.optional(),
  body: optionalString.optional(),
  productId: optionalString.optional(),
  type: z.enum(campaignTypes).optional(),
  pipeline: pipelineConfigSchema.optional(),
  pipelineStatus: z.enum(pipelineStatuses).optional(),
  researchBrief: researchBriefSchema.optional(),
});

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
  'send_email', 'wait', 'update_tag', 'update_lifecycle',
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
  type: z.enum(jobTypes).default('send_email_campaign'),
  enabled: z.boolean().default(true),
  schedule: z.enum(jobSchedules).default('manual'),
  hourUTC: z.number().int().min(0).max(23).default(15),
  minuteUTC: z.number().int().min(0).max(59).default(0),
  payload: z.record(z.string(), z.unknown()).default({}),
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
});

// ── Integration Schemas ────────────────────────────────────────────

export const resendIntegrationSchema = z.object({
  apiKey: z.string().trim().min(1, 'API key is required'),
  fromEmail: emailSchema,
  enabled: z.boolean().default(true),
});

export const metaIntegrationSchema = z.object({
  accessToken: z.string().trim().min(1, 'Access token is required'),
  adAccountId: optionalString,
  pageId: optionalString,
  igAccountId: optionalString,
  enabled: z.boolean().default(true),
});

// X integration is now handled via OAuth 2.0 (same token shape as other OAuth providers)

// ── Video Generation Schema ───────────────────────────────────────

export const videoProviders = ['kling', 'veo', 'sora', 'kling-avatar'] as const;
export const videoStatuses = ['pending', 'generating', 'completed', 'failed'] as const;

export const tiktokTrendStatuses = ['suggested', 'approved', 'used', 'dismissed'] as const;

export const tiktokTrendSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  format: z.string().trim().max(200),
  hooks: z.array(z.string().trim().max(500)).max(10).default([]),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
  viralityScore: z.number().min(0).max(100).default(0),
  relevanceScore: z.number().min(0).max(100).default(0),
  status: z.enum(tiktokTrendStatuses).default('suggested'),
});

export const generateVideoSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
  productId: z.string().trim().optional(),
  trendId: z.string().trim().optional(),
  provider: z.enum(videoProviders).default('kling'),
  durationSeconds: z.number().int().min(5).max(10).default(10),
  /** Caption text for the TikTok post */
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
});

export const videoGenerationSchema = z.object({
  trendId: z.string().trim().optional(),
  postId: z.string().trim().optional(),
  prompt: z.string().trim().max(4000),
  provider: z.enum(videoProviders),
  status: z.enum(videoStatuses).default('pending'),
  videoUrl: z.string().trim().max(2000).default(''),
  thumbnailUrl: z.string().trim().max(2000).default(''),
  durationSeconds: z.number().int().min(0).default(0),
  /** Provider-specific job/request ID for polling */
  externalJobId: z.string().trim().max(500).default(''),
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(100)).max(20).default([]),
  errorMessage: z.string().trim().max(2000).default(''),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
});

// ── Image Generation Schema ───────────────────────────────────────

export const imageStyles = ['photorealistic', 'illustration', 'minimal', 'abstract', 'branded'] as const;
export const imageAspectRatios = ['1:1', '16:9', '9:16', '4:5', '3:4'] as const;
export const imageProviders = ['gemini', 'openai'] as const;

export const generateImageSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
  productId: z.string().trim().optional(),
  /** Target social channel — drives platform-specific visual strategy */
  channel: z.enum(socialChannels).optional(),
  style: z.enum(imageStyles).default('branded'),
  aspectRatio: z.enum(imageAspectRatios).default('1:1'),
  provider: z.enum(imageProviders).default('gemini'),
  /** URLs of app screenshots to place inside phone mockups */
  screenUrls: z.array(z.string().url()).max(4).default([]),
  /** Whether to include the product logo in the image */
  includeLogo: z.boolean().default(false),
});

// ── Ad Campaign Schemas ───────────────────────────────────────────

export const adPlatforms = ['meta', 'google'] as const;
export const adCampaignStatuses = ['draft', 'pending', 'active', 'paused', 'completed', 'failed'] as const;
export const adCampaignObjectives = ['awareness', 'traffic', 'engagement', 'leads', 'conversions', 'app_installs'] as const;

export const adTargetingSchema = z.object({
  ageMin: z.number().int().min(13).max(65).default(18),
  ageMax: z.number().int().min(13).max(65).default(65),
  gender: z.enum(['all', 'male', 'female']).default('all'),
  locations: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  interests: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  languages: z.array(z.string().trim().max(10)).max(20).default([]),
  devices: z.enum(['all', 'mobile', 'desktop']).default('all'),
  placements: z.enum(['automatic', 'manual']).default('automatic'),
  keywords: z.array(z.string().trim().max(200)).max(100).default([]),
});

export const adCreativeSchema = z.object({
  headline: z.string().trim().min(1, 'Headline is required').max(255),
  primaryText: z.string().trim().min(1, 'Primary text is required').max(2000),
  description: z.string().trim().max(500).default(''),
  imageUrl: z.string().trim().url('Invalid image URL').or(z.literal('')).default(''),
  videoUrl: z.string().trim().url('Invalid video URL').or(z.literal('')).default(''),
  linkUrl: z.string().trim().url('Invalid link URL').or(z.literal('')).default(''),
  ctaType: z.string().trim().max(50).default(''),
  additionalHeadlines: z.array(z.string().trim().max(30)).max(14).default([]),
  additionalDescriptions: z.array(z.string().trim().max(90)).max(3).default([]),
});

export const createAdCampaignSchema = z.object({
  name: nameSchema,
  platform: z.enum(adPlatforms),
  objective: z.enum(adCampaignObjectives).default('traffic'),
  dailyBudgetCents: z.number().int().min(100, 'Minimum budget is $1.00'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable().optional(),
  targeting: adTargetingSchema.optional(),
  creative: adCreativeSchema,
  productId: optionalString,
});

export const updateAdCampaignSchema = z.object({
  name: nameSchema.optional(),
  platform: z.enum(adPlatforms).optional(),
  objective: z.enum(adCampaignObjectives).optional(),
  dailyBudgetCents: z.number().int().min(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().nullable().optional(),
  targeting: adTargetingSchema.optional(),
  creative: adCreativeSchema.optional(),
  productId: optionalString.optional(),
  status: z.enum(adCampaignStatuses).optional(),
  adAccountId: z.string().trim().max(100).optional(), // Meta: act_XXXXXXXXX
  customerId: z.string().trim().max(50).optional(),   // Google Ads customer ID
});

// ── Post Schemas ──────────────────────────────────────────────────

export const createPostSchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(65000),
  channel: z.enum(socialChannels),
  status: z.enum(postStatuses).default('draft'),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  productId: optionalString,
  generatedBy: z.string().trim().max(50).default(''),
  campaignId: z.string().trim().max(500).optional(),
  pipelineStage: z.enum(pipelineStages).optional(),
  pipelineSequence: z.number().int().min(0).optional(),
  pipelineTheme: z.string().trim().max(200).optional(),
  targetChannels: z.array(z.enum(socialChannels)).optional(),
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
  campaignId: z.string().trim().max(500).optional(),
  pipelineStage: z.enum(pipelineStages).optional(),
  pipelineSequence: z.number().int().min(0).optional(),
  pipelineTheme: z.string().trim().max(200).optional(),
  targetChannels: z.array(z.enum(socialChannels)).optional(),
});

// ── Pagination ─────────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  status: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});

// ── Type Exports ───────────────────────────────────────────────────

export type CreateCampaign = z.infer<typeof createCampaignSchema>;
export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;
export type CreateContact = z.infer<typeof createContactSchema>;
export type UpdateContact = z.infer<typeof updateContactSchema>;
export type CreateAutomation = z.infer<typeof createAutomationSchema>;
export type UpdateAutomation = z.infer<typeof updateAutomationSchema>;
export type CreateJob = z.infer<typeof createJobSchema>;
export type CampaignChannel = (typeof campaignChannels)[number];
export type CampaignStatus = (typeof campaignStatuses)[number];
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
export type ImageStyle = (typeof imageStyles)[number];
export type ImageAspectRatio = (typeof imageAspectRatios)[number];
export type ImageProvider = (typeof imageProviders)[number];
export type GenerateImage = z.infer<typeof generateImageSchema>;
export type AdPlatform = (typeof adPlatforms)[number];
export type AdCampaignStatus = (typeof adCampaignStatuses)[number];
export type AdCampaignObjective = (typeof adCampaignObjectives)[number];
export type CreateAdCampaign = z.infer<typeof createAdCampaignSchema>;
export type UpdateAdCampaign = z.infer<typeof updateAdCampaignSchema>;
export type AdTargeting = z.infer<typeof adTargetingSchema>;
export type AdCreative = z.infer<typeof adCreativeSchema>;
export type JobType = (typeof jobTypes)[number];
export type CampaignType = (typeof campaignTypes)[number];
export type PipelineStage = (typeof pipelineStages)[number];
export type PipelineCadence = (typeof pipelineCadences)[number];
export type PipelineStatus = (typeof pipelineStatuses)[number];
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type VideoProvider = (typeof videoProviders)[number];
export type VideoStatus = (typeof videoStatuses)[number];
export type TikTokTrendStatus = (typeof tiktokTrendStatuses)[number];
export type TikTokTrend = z.infer<typeof tiktokTrendSchema>;
export type GenerateVideo = z.infer<typeof generateVideoSchema>;
export type VideoGeneration = z.infer<typeof videoGenerationSchema>;
