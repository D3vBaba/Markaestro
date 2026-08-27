import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { listConnections } from '@/lib/platform/connections';
import { getAdapterForChannel } from '@/lib/platform/registry';
import type { PlatformConnection } from '@/lib/platform/types';
import { resolvePlatformCapabilities } from '@/lib/platform/capabilities';
import { upsertNativeSocialPost } from './canonical-social-posts';
import { connectionScopes } from '@/lib/analytics/metric-availability';

const LOOKBACK_MS = 90 * 24 * 60 * 60_000;
const MAX_PAGES_PER_TICK = 4;
const PAGE_SIZE = 50;
/** Products walked per tick — the loop stops at MAX_PAGES_PER_TICK anyway. */
const MAX_PRODUCTS_PER_TICK = 50;

type CursorState = {
  cursor?: string | null;
  completedAt?: string | null;
  nextRunAt?: string | null;
  leaseUntil?: string | null;
};

export type NativeImportResult = {
  connections: number;
  pages: number;
  imported: number;
  completed: number;
  errors: Array<{ connectionId: string; error: string }>;
};

function cursorId(productId: string, connection: PlatformConnection, channel: string): string {
  return createHash('sha256')
    .update(`${productId}\0${connection.connectionId || connection.provider}\0${channel}`)
    .digest('base64url')
    .slice(0, 40);
}

async function productIds(workspaceId: string): Promise<string[]> {
  const snapshot = await adminDb
    .collection(`workspaces/${workspaceId}/products`)
    .select()
    .limit(MAX_PRODUCTS_PER_TICK)
    .get();
  return snapshot.docs.map((doc) => doc.id);
}

/**
 * Incrementally discovers platform-native posts. Cursor progress is stored per
 * product/connection/channel, making the import resumable and safe to run from
 * every workspace tick. Deterministic canonical ids make retries idempotent.
 */
export async function importRecentNativePosts(
  workspaceId: string,
  nowIso = new Date().toISOString(),
): Promise<NativeImportResult> {
  const result: NativeImportResult = {
    connections: 0,
    pages: 0,
    imported: 0,
    completed: 0,
    errors: [],
  };
  const cutoffMs = Date.parse(nowIso) - LOOKBACK_MS;
  let remainingPages = MAX_PAGES_PER_TICK;

  for (const productId of await productIds(workspaceId)) {
    if (remainingPages <= 0) break;
    const connections = await listConnections(workspaceId, productId);
    for (const connection of connections) {
      if (remainingPages <= 0) break;
      if (connection.status !== 'connected' || !connection.accountKey) continue;

      for (const channel of connection.channels) {
        if (remainingPages <= 0) break;
        const capabilities = resolvePlatformCapabilities(channel, connectionScopes(connection));
        const adapter = getAdapterForChannel(channel);
        if (!capabilities.history.nativePostImport || !adapter?.listPosts) continue;

        const id = cursorId(productId, connection, channel);
        const ref = adminDb.doc(`workspaces/${workspaceId}/nativeImportCursors/${id}`);
        const snapshot = await ref.get();
        const state = snapshot.exists ? snapshot.data() as CursorState : {};
        if (state.completedAt) continue;
        if (state.nextRunAt && Date.parse(state.nextRunAt) > Date.parse(nowIso)) continue;
        if (state.leaseUntil && Date.parse(state.leaseUntil) > Date.parse(nowIso)) continue;

        result.connections += 1;
        const leaseUntil = new Date(Date.parse(nowIso) + 4 * 60_000).toISOString();
        await ref.set({
          workspaceId,
          productId,
          connectionId: connection.connectionId || connection.provider,
          channel,
          leaseUntil,
          updatedAt: nowIso,
        }, { merge: true });

        try {
          const page = await adapter.listPosts(connection, {
            channel,
            cursor: state.cursor || undefined,
            limit: PAGE_SIZE,
            destinationId: connection.accountKey,
          });
          remainingPages -= 1;
          result.pages += 1;
          if (!page.ok) {
            const retryMs = page.reason === 'auth' ? 24 * 60 * 60_000 : 60 * 60_000;
            await ref.set({
              leaseUntil: null,
              lastErrorReason: page.reason,
              nextRunAt: new Date(Date.parse(nowIso) + retryMs).toISOString(),
              updatedAt: nowIso,
            }, { merge: true });
            result.errors.push({ connectionId: id, error: page.error });
            continue;
          }

          const inWindow = page.posts.filter((post) =>
            !post.publishedAt || Date.parse(post.publishedAt) >= cutoffMs,
          );
          await Promise.all(inWindow.map((post) => upsertNativeSocialPost({
            workspaceId,
            productId,
            connection,
            post,
            discoveredAt: nowIso,
          })));
          result.imported += inWindow.length;

          const reachedCutoff = page.posts.some((post) =>
            Boolean(post.publishedAt && Date.parse(post.publishedAt) < cutoffMs),
          );
          const complete = reachedCutoff || !page.nextCursor;
          await ref.set({
            cursor: complete ? null : page.nextCursor,
            completedAt: complete ? nowIso : null,
            leaseUntil: null,
            nextRunAt: complete ? null : nowIso,
            lastPageCount: page.posts.length,
            updatedAt: nowIso,
          }, { merge: true });
          if (complete) result.completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown';
          result.errors.push({ connectionId: id, error: message });
          await ref.set({
            leaseUntil: null,
            nextRunAt: new Date(Date.parse(nowIso) + 60 * 60_000).toISOString(),
            lastErrorReason: 'unknown_api_error',
            updatedAt: nowIso,
          }, { merge: true });
        }
      }
    }
  }

  if (result.pages || result.errors.length) {
    logger.info('native social post import tick completed', {
      event: 'intelligence.native_import',
      workspaceId,
      connections: result.connections,
      pages: result.pages,
      imported: result.imported,
      completed: result.completed,
      errors: result.errors.length,
    });
  }
  return result;
}
