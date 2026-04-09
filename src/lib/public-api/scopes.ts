export const publicApiScopes = [
  'products.read',
  'media.write',
  'posts.read',
  'posts.write',
  'posts.publish',
  'job_runs.read',
  'webhooks.manage',
] as const;

export type PublicApiScope = (typeof publicApiScopes)[number];

export const publicWebhookEvents = [
  'post.publish.queued',
  'post.published',
  'post.exported_for_review',
  'post.failed',
] as const;

export type PublicWebhookEvent = (typeof publicWebhookEvents)[number];

export const publicDeliveryModes = [
  'direct_publish',
  'user_review',
] as const;

export type PublicDeliveryMode = (typeof publicDeliveryModes)[number];

export const publicPostStatuses = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'exported_for_review',
  'failed',
] as const;

export type PublicPostStatus = (typeof publicPostStatuses)[number];

export const publicJobRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const;

export type PublicJobRunStatus = (typeof publicJobRunStatuses)[number];
