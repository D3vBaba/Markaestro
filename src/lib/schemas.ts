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
export const contactStatuses = ['active', 'pending', 'bounced', 'unsubscribed'] as const;
export const contactLifecycleStages = ['lead', 'trial', 'customer', 'churned', 'advocate'] as const;
export const contactSources = ['organic', 'paid', 'referral', 'social', 'email', 'direct', 'other'] as const;
export const triggerTypes = ['manual', 'event', 'schedule', 'segment'] as const;
export const jobTypes = ['send_email_campaign', 'sync_contacts', 'generate_content'] as const;
export const jobSchedules = ['manual', 'daily'] as const;
export const integrationProviders = ['resend', 'facebook', 'instagram', 'x'] as const;
export const workspaceRoles = ['owner', 'admin', 'member'] as const;

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

// ── Product Schemas ────────────────────────────────────────────────

export const productStatuses = ['active', 'beta', 'development', 'sunset', 'archived'] as const;
export const productCategories = ['saas', 'mobile', 'web', 'api', 'marketplace', 'other'] as const;

export const createProductSchema = z.object({
  name: nameSchema,
  description: optionalString,
  url: z.string().trim().url('Invalid URL').or(z.literal('')).default(''),
  category: z.enum(productCategories).default('saas'),
  status: z.enum(productStatuses).default('active'),
  pricingTier: optionalString,
  tags: tagsSchema,
});

export const updateProductSchema = z.object({
  name: nameSchema.optional(),
  description: optionalString.optional(),
  url: z.string().trim().url('Invalid URL').or(z.literal('')).optional(),
  category: z.enum(productCategories).optional(),
  status: z.enum(productStatuses).optional(),
  pricingTier: optionalString.optional(),
  tags: tagsSchema.optional(),
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
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type ProductStatus = (typeof productStatuses)[number];
export type ProductCategory = (typeof productCategories)[number];
