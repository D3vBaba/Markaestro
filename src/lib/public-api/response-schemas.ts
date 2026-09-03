/**
 * Response shapes, as Zod rather than as TypeScript types.
 *
 * The request side has always been Zod, so it was documentable and testable.
 * The response side was hand-maintained TypeScript, which is why
 * `PublicPostResponse` could claim a `publishedAt` the serializer never
 * returned and nothing noticed: a type cannot be checked against a value at
 * runtime, and a doc generated from one is a guess.
 *
 * Writing responses as schemas costs a little duplication and buys three
 * things: the OpenAPI spec generates from the same source the code uses, tests
 * can assert a real response parses, and a serializer that drifts fails
 * something instead of silently publishing a wrong contract.
 */

import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';
import { publicDeliveryModes, publicJobRunStatuses, publicPostStatuses } from './scopes';

const isoString = z.string().describe('ISO 8601 timestamp');

export const publicPostTargetResponseSchema = z.object({
  channel: z.string(),
  destinationId: z.string(),
  deliveryMode: z.string(),
  settings: z.unknown().optional(),
}).describe('One destination the post publishes to.');

export const publicPostResponseSchema = z.object({
  id: z.string(),
  channel: z.enum(socialChannels).or(z.string()),
  targets: z.array(publicPostTargetResponseSchema),
  status: z.enum(publicPostStatuses).or(z.string()),
  caption: z.string(),
  productId: z.string().describe('The brand this post belongs to.'),
  destinationId: z.string(),
  destinationProvider: z.string(),
  deliveryMode: z.enum(publicDeliveryModes).or(z.string()),
  settings: z.unknown().nullable(),
  settingsByChannel: z.record(z.string(), z.unknown()),
  mediaAssetIds: z.array(z.string()),
  mediaUrls: z.array(z.string()),
  scheduledAt: isoString.nullable(),
  publishedAt: isoString.nullable().describe('When the post actually went live, not when it was due.'),
  externalId: z.string(),
  externalUrl: z.string(),
  publishResults: z.array(z.unknown()),
  nextAction: z.string(),
  sourceType: z.string(),
  slideshowId: z.string(),
  slideshowTitle: z.string(),
  slideshowSlideCount: z.number().nullable(),
  slideshowCoverIndex: z.number().nullable(),
  createdAt: isoString,
  updatedAt: isoString,
});

export const publicPostListResponseSchema = z.object({
  posts: z.array(publicPostResponseSchema),
  count: z.number().int(),
  nextCursor: z.string().nullable().describe('Pass as `cursor` to fetch the next page. Null on the last page.'),
});

export const publicMediaAssetResponseSchema = z.object({
  id: z.string(),
  type: z.enum(['image', 'video']),
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  originalFileName: z.string(),
  createdByType: z.enum(['api_client', 'user']),
  createdAt: isoString,
  refCount: z.number().int().describe('How many posts currently reference this asset.'),
  processingState: z.enum(['pending', 'ready'])
    .describe('Derivation pipeline state. `pending` until the worker has produced the thumbnail; the original is usable throughout.'),
  thumbnailUrl: z.string().nullable()
    .describe('Token-gated URL of the derived 320px thumbnail. Null while pending, and for videos.'),
});

export const publicMediaListResponseSchema = z.object({
  assets: z.array(publicMediaAssetResponseSchema),
  count: z.number().int(),
  nextCursor: z.string().nullable(),
});

export const publicJobRunResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(publicJobRunStatuses).or(z.string()),
  message: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  startedAt: isoString.nullable(),
  finishedAt: isoString.nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: isoString,
});

export const publicJobRunListResponseSchema = z.object({
  runs: z.array(publicJobRunResponseSchema),
  count: z.number().int(),
  nextCursor: z.string().nullable(),
});

export const publicBulkPostResponseSchema = z.object({
  succeeded: z.array(z.string()).describe('Post ids the operation applied to.'),
  failed: z.array(z.object({ id: z.string(), error: z.string() }))
    .describe('Post ids it could not apply to, each with the error code that explains why.'),
});

/**
 * The error envelope every failure on this surface uses.
 *
 * `error` is the machine code and is the only field to branch on.
 * `userMessage` is present only where the application authored the sentence,
 * and is the only field safe to render to a person.
 */
export const publicErrorResponseSchema = z.object({
  error: z.string().describe('A code from the error catalogue.'),
  userMessage: z.string().optional()
    .describe('Copy written by the application, safe to show a user verbatim. Absent when nobody wrote a sentence for this code.'),
  issues: z.array(z.object({
    channel: z.string().optional(),
    code: z.string().optional(),
    message: z.string(),
    field: z.string().optional(),
  })).optional().describe('Per-field or per-channel detail, when the failure has more than one cause.'),
  requestId: z.string().optional().describe('Quote this when reporting a problem; it finds every log line for the request.'),
});
