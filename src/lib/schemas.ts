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

export const campaignChannels = ['tiktok', 'facebook', 'instagram', 'sms'] as const;
export const campaignStatuses = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'] as const;
export const socialChannels = ['facebook', 'instagram', 'tiktok'] as const;
export const postStatuses = ['draft', 'scheduled', 'publishing', 'published', 'exported_for_review', 'failed'] as const;
export const contactStatuses = ['active', 'pending', 'bounced', 'unsubscribed'] as const;
export const contactLifecycleStages = ['lead', 'trial', 'customer', 'churned', 'advocate'] as const;
export const contactSources = ['organic', 'paid', 'referral', 'social', 'email', 'direct', 'other'] as const;
export const triggerTypes = ['manual', 'event', 'schedule', 'segment'] as const;
export const jobTypes = ['sync_contacts', 'generate_content', 'publish_post', 'create_ad_campaign', 'refresh_tokens', 'sync_ad_metrics'] as const;
export const jobSchedules = ['manual', 'daily'] as const;
export const integrationProviders = ['facebook', 'instagram', 'meta', 'tiktok', 'tiktok_ads'] as const;
export const oauthProviders = ['meta', 'instagram', 'tiktok', 'tiktok_ads'] as const;
export const workspaceRoles = ['owner', 'admin', 'member', 'analyst'] as const;

// ── Pipeline Enums ────────────────────────────────────────────────

export const campaignTypes = ['standard', 'pipeline'] as const;
export const pipelineStages = ['awareness', 'interest', 'consideration', 'trial', 'activation', 'retention'] as const;
export const pipelineCadences = ['daily', '3x_week', '2x_week', 'weekly'] as const;
export const pipelineStatuses = ['pending_research', 'researching', 'research_complete', 'generating', 'generating_images', 'generated', 'scheduling', 'scheduled', 'failed'] as const;
export const slideshowChannels = ['tiktok'] as const;
export const slideshowStatuses = ['draft', 'researching', 'generating_slides', 'generating_images', 'ready', 'failed', 'exported'] as const;
export const slideshowRenderModes = ['carousel_images'] as const;
export const slideKinds = ['hook', 'body', 'cta'] as const;
export const slideImageStatuses = ['pending', 'generated', 'failed'] as const;
export const safeTextRegions = ['top', 'middle', 'bottom'] as const;
export const storyFormats = [
  'hook_value_cta',
  'problem_solution',
  'transformation',
  'feature_listicle',
  'ugc_testimonial',
  'product_lookbook',
] as const;

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
  newsHookHeadlines: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  generatedAt: z.string().datetime(),
});

export const slideVisualIntentSchema = z.object({
  composition: z.string().trim().min(1).max(200),
  subjectFocus: z.string().trim().min(1).max(200),
  safeTextRegion: z.enum(safeTextRegions),
  lighting: z.string().trim().min(1).max(200),
  colorMood: z.string().trim().min(1).max(200),
  motionStyle: z.string().trim().min(1).max(200),
});

export const slideQualitySchema = z.object({
  hookStrength: z.number().min(0).max(1),
  readability: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  visualClarity: z.number().min(0).max(1),
  notes: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});

export const slideshowSlideSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  index: z.number().int().min(0),
  kind: z.enum(slideKinds),
  headline: z.string().trim().min(1).max(200),
  body: z.string().trim().max(500).default(''),
  cta: z.string().trim().max(200).default(''),
  imagePrompt: z.string().trim().min(1).max(4000),
  imageUrl: z.string().trim().url().or(z.literal('')).default(''),
  imageStatus: z.enum(slideImageStatuses).default('pending'),
  visualIntent: slideVisualIntentSchema,
  quality: slideQualitySchema.optional(),
});

export const createSlideshowSchema = z.object({
  productId: z.string().trim().min(1).max(2000),
  prompt: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(200).optional(),
  channel: z.enum(slideshowChannels).default('tiktok'),
  slideCount: z.number().int().min(3).max(10).default(6),
  caption: z.string().trim().max(4000).optional(),
  aspectRatio: z.literal('9:16').default('9:16'),
  renderMode: z.enum(slideshowRenderModes).default('carousel_images'),
  visualStyle: z.string().trim().max(200).default('reelfarm'),
  imageStyle: z.lazy(() => z.enum(imageStyles)).default('branded'),
  imageProvider: z.lazy(() => z.enum(imageProviders)).default('gemini'),
  storyFormat: z.enum(storyFormats).default('hook_value_cta'),
  characterModelId: z.string().trim().max(200).optional(),
});

export const updateSlideshowSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  caption: z.string().trim().max(4000).optional(),
  coverSlideIndex: z.number().int().min(0).max(9).optional(),
  status: z.enum(slideshowStatuses).optional(),
  errorMessage: z.string().trim().max(2000).nullable().optional(),
  slides: z.array(slideshowSlideSchema).min(1).max(10).optional(),
});

// ── Campaign Schemas ───────────────────────────────────────────────

export const createCampaignSchema = z.object({
  name: nameSchema,
  channel: z.enum(campaignChannels).default('facebook'),
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
  enrichmentSource: z.enum(['manual', 'url_import', 'ai_assisted']).optional(),
});

// ── Character Model Schema ────────────────────────────────────────

export const characterModelGenders = ['female', 'male', 'nonbinary'] as const;
export const characterModelAgeRanges = ['18-25', '26-35', '36-50', '51+'] as const;
export const characterModelStyles = ['casual', 'professional', 'fitness', 'lifestyle', 'streetwear'] as const;
export const characterModelBodySizes = ['slim', 'average', 'plus'] as const;

export const characterModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  gender: z.enum(characterModelGenders),
  ageRange: z.enum(characterModelAgeRanges),
  ethnicity: z.string().trim().max(100),
  bodySize: z.enum(characterModelBodySizes),
  style: z.enum(characterModelStyles),
  referenceImageUrls: z.array(z.string().url()).min(1).max(5),
  primaryReferenceImageUrl: z.string().url(),
  thumbnailUrl: z.string().url(),
  generationPrompt: z.string().trim().max(2000).default(''),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
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
  adAccountId: optionalString,
  pageId: optionalString,
  igAccountId: optionalString,
  enabled: z.boolean().default(true),
});

// ── Prompt Mode (shared by image generation) ──────────────────────

export const promptModes = ['guided', 'custom_override'] as const;

// ── TikTok Trend Schema ───────────────────────────────────────────

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

// ── Image Generation Schema ───────────────────────────────────────

export const imageStyles = ['photorealistic', 'illustration', 'minimal', 'abstract', 'branded'] as const;

/**
 * Per-platform style recommendations, ordered best → worst by what the
 * research consensus says actually performs in 2025/2026. The first entry is
 * the recommended default and is auto-selected when the user picks a channel.
 *
 * Sources (see also the matching variants in image-generator.ts):
 *
 * - TikTok: UGC outperforms non-UGC by +55% ROI; UNBRANDED UGC beats branded
 *   by +19%; creative without logos / heavy overlays earns +81% ROI. The
 *   algorithm rewards content that feels native to the FYP, not polished
 *   commercials. → Photorealistic (UGC variants) is the only true fit.
 *   Branded only works in its lo-fi "indie / Gen-Z" form. Minimal and
 *   abstract are deliberately omitted — they read as ads and get skipped.
 *   Refs: precis.com TikTok 2025 playbook, awisee.com TikTok UGC 2025,
 *   tlinky.com TikTok ad creative best practices 2025, ads.tiktok.com.
 *
 * - Instagram: Posts with people / faces outperform everything else
 *   (Georgia Tech: faces +38% likes; Agorapulse: photos beat graphics by
 *   +156% likes / +302% comments). Authentic-but-quality lifestyle imagery
 *   wins; pure illustration and abstract underperform. Static engagement is
 *   declining 17% YoY but photorealistic-with-people is the surviving format.
 *   Refs: socialinsider.io 2026 IG benchmarks, blog.hootsuite.com faces
 *   experiment, agorapulse.com photos-vs-graphics.
 *
 * - Facebook: UGC-style and lifestyle product-in-use imagery dominate;
 *   bold-typography + product hero is a staple of high-performing creative;
 *   4:5 vertical photos beat 1:1 by ~15% in feed. Creative drives 70–80% of
 *   Meta ad performance — stylistic fit matters more than budget.
 *   Refs: superside.com FB ad examples 2025, billo.app Meta ads best
 *   practices 2025, wordstream.com FB ad trends 2025.
 */
export const recommendedStylesByPlatform: Record<
  'facebook' | 'instagram' | 'tiktok',
  readonly (typeof imageStyles)[number][]
> = {
  // Facebook: UGC + lifestyle photo first, branded (with typography) second,
  // minimal as a clean third. Illustration and abstract are de-emphasized.
  facebook: ['photorealistic', 'branded', 'minimal', 'illustration'],
  // Instagram: photo-with-people leads decisively. Branded lifestyle editorial
  // and minimalism are valid secondary picks. Illustration trails. Abstract
  // is omitted — research shows graphics underperform photos by 156%+.
  instagram: ['photorealistic', 'branded', 'minimal', 'illustration'],
  // TikTok: only raw, native-feeling photoreal (UGC) is a true fit. Branded
  // is allowed only because we bias it to its indie/Gen-Z lo-fi variants in
  // the generator. Minimal, abstract, and illustration are intentionally
  // excluded — they read as commercials and the FYP algorithm punishes that.
  tiktok: ['photorealistic', 'branded'],
} as const;
export const imageAspectRatios = ['1:1', '16:9', '9:16', '4:5', '3:4'] as const;
export const imageProviders = ['gemini', 'openai'] as const;

/**
 * Image subtypes — visual categories that control WHAT the image depicts.
 * Users pick a subtype to get a specific kind of image. For campaigns,
 * multiple subtypes can be selected to guarantee visual variety.
 */
export const imageSubtypes = [
  'product-hero',
  'lifestyle',
  'flat-lay',
  'texture-detail',
  'before-after',
  'hands-in-action',
  'environment',
  'still-life',
  'silhouette',
  'behind-the-scenes',
  'ingredients-raw',
  'mood-abstract',
] as const;

export const generateImageSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
  promptMode: z.enum(promptModes).default('guided'),
  customPrompt: z.string().trim().max(1200).optional(),
  productId: z.string().trim().optional(),
  /** Target social channel — drives platform-specific visual strategy */
  channel: z.enum(socialChannels).optional(),
  style: z.enum(imageStyles).default('branded'),
  aspectRatio: z.enum(imageAspectRatios).default('1:1'),
  provider: z.enum(imageProviders).default('gemini'),
  /** Visual category — controls what kind of scene is generated */
  subtype: z.enum(imageSubtypes).optional(),
  /** URLs of app screenshots to place inside phone mockups */
  screenUrls: z.array(z.string().url()).max(4).default([]),
  /** Whether to include the product logo in the image */
  includeLogo: z.boolean().default(false),
  /** Number of images to generate in a single request (1-6) */
  count: z.number().int().min(1).max(6).default(1),
});

// ── Ad Campaign Schemas ───────────────────────────────────────────

export const adPlatforms = ['meta', 'tiktok'] as const;
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
  /** Additional images for carousel/multi-image ad creatives (max 10). When present with 2+ entries, builds a carousel ad. */
  imageUrls: z.array(z.string().url()).max(10).default([]),
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
  sourceType: z.enum(['manual', 'pipeline', 'slideshow']).optional(),
  slideshowId: z.string().trim().max(200).optional(),
  slideshowTitle: z.string().trim().max(200).optional(),
  slideshowSlideCount: z.number().int().min(1).max(10).optional(),
  slideshowCoverIndex: z.number().int().min(0).max(9).optional(),
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
  sourceType: z.enum(['manual', 'pipeline', 'slideshow']).optional(),
  slideshowId: z.string().trim().max(200).optional(),
  slideshowTitle: z.string().trim().max(200).optional(),
  slideshowSlideCount: z.number().int().min(1).max(10).optional(),
  slideshowCoverIndex: z.number().int().min(0).max(9).optional(),
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
export type ImageSubtype = (typeof imageSubtypes)[number];
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
export type SlideshowChannel = (typeof slideshowChannels)[number];
export type SlideshowStatus = (typeof slideshowStatuses)[number];
export type SlideshowRenderMode = (typeof slideshowRenderModes)[number];
export type SlideKind = (typeof slideKinds)[number];
export type SlideImageStatus = (typeof slideImageStatuses)[number];
export type SafeTextRegion = (typeof safeTextRegions)[number];
export type SlideVisualIntent = z.infer<typeof slideVisualIntentSchema>;
export type SlideQuality = z.infer<typeof slideQualitySchema>;
export type SlideshowSlide = z.infer<typeof slideshowSlideSchema>;
export type CreateSlideshow = z.infer<typeof createSlideshowSchema>;
export type UpdateSlideshow = z.infer<typeof updateSlideshowSchema>;
export type PromptMode = (typeof promptModes)[number];
export type TikTokTrendStatus = (typeof tiktokTrendStatuses)[number];
export type TikTokTrend = z.infer<typeof tiktokTrendSchema>;
export type StoryFormat = (typeof storyFormats)[number];
export type ProductFeature = z.infer<typeof productFeatureSchema>;
export type ProofPoint = z.infer<typeof proofPointSchema>;
export type ProductKnowledge = z.infer<typeof productKnowledgeSchema>;
export type CharacterModelGender = (typeof characterModelGenders)[number];
export type CharacterModelAgeRange = (typeof characterModelAgeRanges)[number];
export type CharacterModelStyle = (typeof characterModelStyles)[number];
export type CharacterModelBodySize = (typeof characterModelBodySizes)[number];
export type CharacterModel = z.infer<typeof characterModelSchema>;
