import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import type { MetaProvider } from './meta-signed-request';

/**
 * The metadata field on a PlatformConnection that holds the app-scoped user id
 * for each Meta product. These are populated at connect time in the OAuth
 * callback (metaUserId from /me, igAccountId from the IG profile, threadsUserId
 * from the Threads profile) and equal the `user_id` Meta sends in the
 * deauthorize / data-deletion signed_request.
 */
const PROVIDER_ID_FIELD: Record<MetaProvider, string> = {
  meta: 'metaUserId',
  instagram: 'igAccountId',
  threads: 'threadsUserId',
};

// Firestore caps a batch at 500 writes; stay well under it.
const DELETE_BATCH_SIZE = 400;

export type ConnectionDeletionResult = { deleted: number; paths: string[] };

/**
 * Delete every platformConnection that belongs to a given Meta-platform user.
 *
 * Runs a collection-group query over `platformConnections` so it spans every
 * workspace and product, matching only the identifier field for the provider
 * whose secret verified the signed_request (so an Instagram deauthorize never
 * touches a Facebook connection and vice versa). Idempotent: a Meta redelivery
 * simply finds nothing left to delete.
 */
export async function deleteConnectionsForMetaUser(
  provider: MetaProvider,
  userId: string,
): Promise<ConnectionDeletionResult> {
  if (!userId) return { deleted: 0, paths: [] };

  const field = PROVIDER_ID_FIELD[provider];
  const snap = await adminDb
    .collectionGroup('platformConnections')
    .where(`metadata.${field}`, '==', userId)
    .get();

  const paths: string[] = [];
  for (let i = 0; i < snap.docs.length; i += DELETE_BATCH_SIZE) {
    const batch = adminDb.batch();
    for (const doc of snap.docs.slice(i, i + DELETE_BATCH_SIZE)) {
      batch.delete(doc.ref);
      paths.push(doc.ref.path);
    }
    await batch.commit();
  }

  logger.info('meta user connections deleted', {
    event: 'meta.webhook.connections_deleted',
    provider,
    deleted: paths.length,
  });

  return { deleted: paths.length, paths };
}
