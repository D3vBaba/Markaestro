import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';

export const campaignSchema = z.object({
  productId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  objective: z.string().min(1).max(100),
  status: z.enum(['draft', 'active', 'completed', 'archived']).default('draft'),
  startAt: z.iso.datetime().optional(),
  endAt: z.iso.datetime().optional(),
  platforms: z.array(z.enum(socialChannels)).min(1).max(6),
  postIds: z.array(z.string().max(128)).max(1000).default([]),
}).refine((value) => !value.startAt || !value.endAt || Date.parse(value.endAt) >= Date.parse(value.startAt), {
  path: ['endAt'], message: 'End date must follow start date.',
});

const experimentArmDraftSchema = z.object({
  content: z.string().trim().min(1).max(65000),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  scheduledAt: z.string().datetime(),
  label: z.string().trim().min(1).max(100).optional(),
});

/** New paired, per-platform experiment create payload. */
export const createPairedExperimentSchema = z.object({
  productId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  hypothesis: z.string().min(1).max(1000),
  platform: z.enum(socialChannels),
  metric: z.enum(['views', 'engagements', 'clicks']).default('views'),
  durationDays: z.number().int().min(1).max(30).default(7),
  targetSamplePerArm: z.number().int().min(1).max(10_000).default(1),
  armA: experimentArmDraftSchema,
  armB: experimentArmDraftSchema,
}).superRefine((value, ctx) => {
  if (Date.parse(value.armB.scheduledAt) === Date.parse(value.armA.scheduledAt)
    && value.armA.content.trim() === value.armB.content.trim()
    && JSON.stringify(value.armA.mediaUrls) === JSON.stringify(value.armB.mediaUrls)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Arms A and B must differ in caption, media, or schedule time.',
      path: ['armB'],
    });
  }
});

/** Legacy / assignment-compatible schema (kept for older clients). */
export const experimentSchema = z.object({
  productId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  hypothesis: z.string().min(1).max(1000),
  metric: z.string().min(1).max(80),
  targetSamplePerArm: z.number().int().min(1).max(10_000),
  status: z.enum(['draft', 'scheduled', 'running', 'complete', 'archived']).default('draft'),
  platform: z.enum(socialChannels).optional(),
  durationDays: z.number().int().min(1).max(30).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  arms: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(100) })).length(2).optional(),
  armAPostIds: z.array(z.string().max(128)).max(1000).default([]),
  armBPostIds: z.array(z.string().max(128)).max(1000).default([]),
  armAPostId: z.string().max(128).optional(),
  armBPostId: z.string().max(128).optional(),
});

export const experimentEvaluationSchema = z.object({
  armA: z.array(z.number().finite()).max(10_000).optional(),
  armB: z.array(z.number().finite()).max(10_000).optional(),
  armAPostIds: z.array(z.string().max(128)).max(1000).optional(),
  armBPostIds: z.array(z.string().max(128)).max(1000).optional(),
  objective: z.string().max(80).optional(),
});

export const recommendationDecisionSchema = z.object({
  /** `proposed` reverts an earlier decision (undo). */
  decision: z.enum(['proposed', 'accepted', 'dismissed', 'pinned']),
});

export type CreatePairedExperiment = z.infer<typeof createPairedExperimentSchema>;
