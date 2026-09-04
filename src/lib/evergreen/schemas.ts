import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';

export const evergreenQueueStatuses = ['draft', 'active', 'paused', 'archived'] as const;
export const evergreenReviewPolicies = ['approve_future_runs', 'review_each_run'] as const;
export const evergreenScheduleModes = ['fixed', 'learned'] as const;
/** fixed: the interval never moves. adaptive: it stretches after a weak run and tightens after a strong one. */
export const evergreenCadenceModes = ['fixed', 'adaptive'] as const;

export const evergreenVariantInputSchema = z.object({
  caption: z.string().trim().min(1).max(65000),
  enabled: z.boolean().default(true),
});

export const createEvergreenQueueSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  sourcePostId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  channels: z.array(z.enum(socialChannels)).min(1).max(socialChannels.length).optional(),
  intervalDays: z.number().int().min(7).max(365).default(30),
  timeZone: z.string().trim().min(1).max(100).default('UTC'),
  localHour: z.number().int().min(0).max(23).default(10),
  localMinute: z.number().int().min(0).max(59).default(0),
  scheduleMode: z.enum(evergreenScheduleModes).default('learned'),
  cadenceMode: z.enum(evergreenCadenceModes).default('adaptive'),
  reviewPolicy: z.enum(evergreenReviewPolicies).default('approve_future_runs'),
  expiresAt: z.string().datetime().nullable().optional(),
  /** Destinations for channels the source post was not published to (cross-channel expansion). */
  channelDestinations: z.record(z.string(), z.string().min(1).max(200)).optional(),
  variants: z.array(evergreenVariantInputSchema).min(1).max(20),
});

export const updateEvergreenQueueSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  intervalDays: z.number().int().min(7).max(365).optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  localHour: z.number().int().min(0).max(23).optional(),
  localMinute: z.number().int().min(0).max(59).optional(),
  scheduleMode: z.enum(evergreenScheduleModes).optional(),
  cadenceMode: z.enum(evergreenCadenceModes).optional(),
  reviewPolicy: z.enum(evergreenReviewPolicies).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  variants: z.array(evergreenVariantInputSchema).min(1).max(20).optional(),
  version: z.number().int().positive(),
});

export const evergreenQueueIdSchema = z.string().trim().min(1).max(200);

export type CreateEvergreenQueueInput = z.infer<typeof createEvergreenQueueSchema>;
export type UpdateEvergreenQueueInput = z.infer<typeof updateEvergreenQueueSchema>;
export type EvergreenQueueStatus = (typeof evergreenQueueStatuses)[number];
export type EvergreenReviewPolicy = (typeof evergreenReviewPolicies)[number];
export type EvergreenScheduleMode = (typeof evergreenScheduleModes)[number];
