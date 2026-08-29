import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';
import { publicApiScopes, publicDeliveryModes, publicWebhookEvents } from './scopes';
import { postSettingsSchema } from './post-settings';
import { webhookUrlProtocolIsAllowed } from './webhook-url';
import { apiKeyModes } from './keys';
import { MAX_CAPTION_LENGTH, MAX_MEDIA_ITEMS } from '@/lib/social/channel-catalog';

export type { PublicPostResponse } from './posts';

export const createApiClientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(publicApiScopes)).min(1).max(publicApiScopes.length),
  // Optional key lifetime; omitted = the key never expires.
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
  // Required product binding: every key is scoped to exactly one product. All
  // calls auto-target it and requests for any other product are rejected.
  productId: z.string().trim().min(1).max(200),
  // `test` mints an `mk_test_` key: real posts and real media in a real
  // workspace, but publishing routes to the sandbox adapter and nothing
  // reaches a platform. Omitted = `live`, so no existing caller changes mode
  // by accident.
  mode: z.enum(apiKeyModes).default('live'),
});

export const updateApiClientScopesSchema = z.object({
  scopes: z.array(z.enum(publicApiScopes)).min(1).max(publicApiScopes.length),
});

export const setApiClientArchivedSchema = z.object({
  archived: z.boolean(),
});

/**
 * One destination for a post.
 *
 * The app's post model has always carried `targetChannels`, per-channel
 * destinations, and per-channel publish results, and the publisher fans out
 * across them. The public API accepted one `channel`, so the Connect layer
 * worked around it by fanning out into separate posts and returning only the
 * first id: two data shapes for one user intent.
 */
export const publicPostTargetSchema = z.object({
  channel: z.enum(socialChannels),
  destinationId: z.string().trim().max(2000).optional(),
  deliveryMode: z.enum(publicDeliveryModes).optional(),
  settings: postSettingsSchema.optional(),
});

export const createPublicPostSchema = z
  .object({
    /**
     * Single-target shorthand, and still the only required field for the
     * overwhelming majority of callers. Kept so no existing client breaks.
     */
    channel: z.enum(socialChannels).optional(),
    /** Multi-target form. Mutually exclusive with `channel`. */
    targets: z.array(publicPostTargetSchema).min(1).max(socialChannels.length).optional(),
    // A payload-size guard, not a channel rule: per-channel caption limits
    // are enforced by `validatePublicPostInput`. Bounding it below the widest
    // channel would make the API stricter than the composer.
    caption: z.string().trim().max(MAX_CAPTION_LENGTH).default(''),
    mediaAssetIds: z.array(z.string().trim().min(1)).max(MAX_MEDIA_ITEMS).default([]),
    scheduledAt: z.string().datetime().nullable().optional(),
    productId: z.string().trim().max(2000).optional(),
    // Accepted alias for `productId`. The dashboard calls the entity a
    // Brand; the wire format keeps `productId` for backwards compatibility.
    // When both are sent, `productId` wins.
    brandId: z.string().trim().max(2000).optional(),
    destinationId: z.string().trim().max(2000).optional(),
    // Omitted = channel default: manual_reminder for facebook/instagram/tiktok,
    // direct_publish everywhere else. Clients opt into API publishing per post.
    deliveryMode: z.enum(publicDeliveryModes).optional(),
    settings: postSettingsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.channel && !value.targets) {
      ctx.addIssue({
        code: 'custom',
        message: 'Send either `channel` for a single destination or `targets` for several.',
        path: ['channel'],
      });
    }
    if (value.channel && value.targets) {
      // Accepting both and picking one silently is how a caller ends up
      // publishing somewhere they did not ask for.
      ctx.addIssue({
        code: 'custom',
        message: 'Send `channel` or `targets`, not both.',
        path: ['targets'],
      });
    }
    const channels = value.targets?.map((target) => target.channel) ?? [];
    if (new Set(channels).size !== channels.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Each channel may appear at most once in `targets`.',
        path: ['targets'],
      });
    }
  })
  .transform(({ brandId, ...rest }) => ({
    ...rest,
    productId: rest.productId ?? brandId,
  }));

/** Body for batch create: `{ posts: [...] }`. */
export const createPublicPostsBatchSchema = z.object({
  posts: z.array(createPublicPostSchema).min(1).max(25),
});

export const createPublicMediaUploadSessionSchema = z.object({
  fileName: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export const listPublicPostsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(2000).optional(),
  status: z.string().trim().max(200).optional(),
  /** Brand to scope the listing to; brands are stored as `products`. */
  productId: z.string().trim().max(2000).optional(),
});

/**
 * Partial update. At least one field must be present, or the request is a
 * no-op the caller almost certainly did not intend. `status` is how a soft
 * deleted (disabled) endpoint is brought back, which is what makes the
 * tombstones in the list actionable.
 */
export const updateWebhookEndpointSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine(webhookUrlProtocolIsAllowed, 'Webhook URL must use https')
      .optional(),
    events: z.array(z.enum(publicWebhookEvents)).min(1).max(publicWebhookEvents.length).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine(
    (value) => value.url !== undefined || value.events !== undefined || value.status !== undefined,
    'Provide at least one of url, events, or status.',
  );

export const registerWebhookEndpointSchema = z.object({
  // The scheme check is the cheap half of the SSRF guard; the host and DNS
  // half runs in `createWebhookEndpoint` (and again at delivery time) because
  // it needs a network round trip. See `webhook-url.ts`.
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine(webhookUrlProtocolIsAllowed, 'Webhook URL must use https'),
  events: z.array(z.enum(publicWebhookEvents)).min(1).max(publicWebhookEvents.length),
});
