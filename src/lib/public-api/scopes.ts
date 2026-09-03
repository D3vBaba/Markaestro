export const publicApiScopes = [
  'products.read',
  'media.write',
  'posts.read',
  'posts.write',
  'posts.publish',
  'evergreen.read',
  'evergreen.write',
  'job_runs.read',
  'webhooks.manage',
] as const;

export type PublicApiScope = (typeof publicApiScopes)[number];

export const publicWebhookEvents = [
  'post.publish.queued',
  'post.published',
  'post.action_required',
  'post.failed',
  'evergreen.queue.activated',
  'evergreen.queue.paused',
  'evergreen.queue.needs_review',
  'evergreen.run.scheduled',
  'evergreen.run.skipped',
  'evergreen.run.underperformed',
] as const;

export type PublicWebhookEvent = (typeof publicWebhookEvents)[number];

export const publicDeliveryModes = [
  'direct_publish',
  'platform_inbox',
  'manual_reminder',
] as const;

export type PublicDeliveryMode = (typeof publicDeliveryModes)[number];

export const publicPostStatuses = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'platform_action_required',
  'failed',
  'partial_failed',
] as const;

export type PublicPostStatus = (typeof publicPostStatuses)[number];

export const publicJobRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const;

export type PublicJobRunStatus = (typeof publicJobRunStatuses)[number];
