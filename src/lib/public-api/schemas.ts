import { z } from 'zod';
import { socialChannels } from '@/lib/schemas';
import { publicApiScopes, publicWebhookEvents } from './scopes';

export const createApiClientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(publicApiScopes)).min(1).max(publicApiScopes.length),
});

export const updateApiClientScopesSchema = z.object({
  scopes: z.array(z.enum(publicApiScopes)).min(1).max(publicApiScopes.length),
});

export const createPublicPostSchema = z.object({
  channel: z.enum(socialChannels),
  caption: z.string().trim().max(4000).default(''),
  mediaAssetIds: z.array(z.string().trim().min(1)).max(10).default([]),
  scheduledAt: z.string().datetime().nullable().optional(),
  productId: z.string().trim().max(2000).optional(),
  destinationId: z.string().trim().max(2000).optional(),
});

export const listPublicPostsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().trim().max(200).optional(),
});

export const registerWebhookEndpointSchema = z.object({
  url: z.string().trim().url().max(2000),
  events: z.array(z.enum(publicWebhookEvents)).min(1).max(publicWebhookEvents.length),
});
