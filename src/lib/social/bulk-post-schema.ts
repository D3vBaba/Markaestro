import { z } from 'zod';

/**
 * A bounded batch. 25 matches `createPublicPostsBatchSchema`, so the two batch
 * shapes in the product agree on how much work one request may ask for.
 *
 * Lives with the schema rather than with the engine so that describing the
 * request shape does not drag Firestore, storage, and the worker into the
 * import graph. The OpenAPI generator imports this file.
 */
export const MAX_BULK_POST_ITEMS = 25;
export const bulkPostOperationSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_BULK_POST_ITEMS),
}).and(z.discriminatedUnion('action', [
  z.object({ action: z.literal('reschedule'), scheduledAt: z.string().datetime() }),
  z.object({ action: z.literal('delete') }),
  z.object({ action: z.literal('status'), status: z.enum(['draft', 'scheduled']) }),
]));

export type BulkPostRequest = z.infer<typeof bulkPostOperationSchema>;
