import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { listConnections } from '@/lib/platform/connections';
import { getAdapterForChannel } from '@/lib/platform/registry';
import type { PlatformConnection } from '@/lib/platform/types';
import { resolvePlatformCapabilities } from '@/lib/platform/capabilities';
import { upsertNativeSocialPost } from './canonical-social-posts';
import { connectionScopes } from '@/lib/analytics/metric-availability';

/** Fallback when a channel's capability contract names no lookback. */
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_PAGES_PER_TICK = 4;
const PAGE_SIZE = 50;
/** Products walked per tick — the loop stops at MAX_PAGES_PER_TICK anyway. */
const MAX_PRODUCTS_PER_TICK = 50;
/**
 * Hard stop for one walk of an account, across ticks. The first pass ends on
 * the platform's own end-of-results, but a provider that pages inside a time
 * window can keep handing out a cursor past the last result. At PAGE_SIZE
 * this covers far more history than any lookback window asks for.
 */
const MAX_PAGES_PER_WALK = 20;
/**
 * How often a completed import looks for new posts. Native posting is not
 * bursty at the scale of hours, and the metrics poller carries the stage
 * schedule from discovery, so a few hours of delay costs nothing an agent
 * would notice.
 */
export const NATIVE_REFRESH_INTERVAL_MS = 6 * 3600_000;
/**
 * How far behind the last completion an incremental run reads. Platforms
 * list by creation time and backdate scheduled posts, so a strict "newer
 * than last time" cut would miss a post that appeared late.
 */
export const NATIVE_REFRESH_OVERLAP_MS = 48 * 3600_000;

export type NativeImportCursorState = {
  cursor?: string | null;
  completedAt?: string | null;
  nextRunAt?: string | null;
  leaseUntil?: string | null;
  /** Pages this walk has taken; reset when the walk completes. */
  pagesWalked?: number | null;
};

export type NativeImportPlan =
  | { run: false; reason: 'leased' | 'not_due' }
  | { run: true; mode: 'initial' | 'incremental'; cursor: string | undefined; cutoffMs: number };

/**
 * What one (product, connection, channel) cursor should do this tick. The
 * first pass walks the channel's whole lookback; after that the cursor
 * re-runs every NATIVE_REFRESH_INTERVAL_MS from the top of the account and
 * stops at the overlap before the last completion. Pure, so the cadence is
 * unit tested without Firestore.
 */
export function planNativeImportRun(
  state: NativeImportCursorState,
  nowMs: number,
  lookbackMs: number,
): NativeImportPlan {
  if (state.leaseUntil && Date.parse(state.leaseUntil) > nowMs) return { run: false, reason: 'leased' };
  if (state.nextRunAt && Date.parse(state.nextRunAt) > nowMs) return { run: false, reason: 'not_due' };
  const lookbackCutoff = nowMs - lookbackMs;
  const cursor = state.cursor || undefined;
  const completedMs = state.completedAt ? Date.parse(state.completedAt) : Number.NaN;
  if (Number.isFinite(completedMs)) {
    return {
      run: true,
      mode: 'incremental',
      cursor,
      cutoffMs: Math.max(lookbackCutoff, completedMs - NATIVE_REFRESH_OVERLAP_MS),
    };
  }
  return { run: true, mode: 'initial', cursor, cutoffMs: lookbackCutoff };
}

/**
 * Whether this page ends the walk of one account.
 *
 * A page carrying a post older than the cutoff is the classic signal, but an
 * adapter that pushes `sinceIso` down to the platform never returns one: the
 * walk ends on an empty page instead. Only the incremental run may stop
 * there, since its window is the 48h overlap and an empty page is the steady
 * state for an account that has not posted since the last run. The first pass
 * keeps following the cursor, because a page can come back empty mid-history,
 * and is bounded by MAX_PAGES_PER_WALK rather than by trusting the provider
 * to stop handing out cursors.
 */
export function walkComplete(input: {
  mode: 'initial' | 'incremental';
  posts: ReadonlyArray<{ publishedAt?: string | null }>;
  nextCursor?: string;
  cutoffMs: number;
  pagesWalked: number;
}): boolean {
  const reachedCutoff = input.posts.some((post) =>
    Boolean(post.publishedAt && Date.parse(post.publishedAt) < input.cutoffMs),
  );
  return reachedCutoff
    || !input.nextCursor
    || (input.mode === 'incremental' && input.posts.length === 0)
    || input.pagesWalked >= MAX_PAGES_PER_WALK;
}

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
 * Discovers platform-native posts. Cursor progress is stored per
 * product/connection/channel, making the import resumable and safe to run from
 * every workspace tick; a completed cursor re-runs on a fixed cadence to pick
 * up what the account published since (see planNativeImportRun).
 * Deterministic canonical ids make retries idempotent, and a newly discovered
 * post is scheduled for metrics at once (upsertNativeSocialPost).
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
  const nowMs = Date.parse(nowIso);
  let remainingPages = MAX_PAGES_PER_TICK;

  for (const productId of await productIds(workspaceId)) {
    if (remainingPages <= 0) break;
    const connections = await listConnections(workspaceId, productId);
    for (const connection of connections) {
      if (connection.fixture) continue;
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
        const state = snapshot.exists ? snapshot.data() as NativeImportCursorState : {};
        const lookbackMs = (capabilities.history.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 3600_000;
        const plan = planNativeImportRun(state, nowMs, lookbackMs);
        if (!plan.run) continue;
        const { cutoffMs } = plan;

        result.connections += 1;
        const leaseUntil = new Date(nowMs + 4 * 60_000).toISOString();
        await ref.set({
          workspaceId,
          productId,
          connectionId: connection.connectionId || connection.provider,
          channel,
          mode: plan.mode,
          leaseUntil,
          updatedAt: nowIso,
        }, { merge: true });

        try {
          const page = await adapter.listPosts(connection, {
            channel,
            cursor: plan.cursor,
            limit: PAGE_SIZE,
            destinationId: connection.accountKey,
            sinceIso: new Date(cutoffMs).toISOString(),
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

          const pagesWalked = (state.pagesWalked ?? 0) + 1;
          const complete = walkComplete({
            mode: plan.mode,
            posts: page.posts,
            nextCursor: page.nextCursor,
            cutoffMs,
            pagesWalked,
          });
          await ref.set({
            pagesWalked: complete ? 0 : pagesWalked,
            cursor: complete ? null : page.nextCursor,
            // An unfinished run keeps the previous completion, which is what
            // the incremental cutoff is measured from.
            ...(complete ? { completedAt: nowIso } : {}),
            leaseUntil: null,
            nextRunAt: complete ? new Date(nowMs + NATIVE_REFRESH_INTERVAL_MS).toISOString() : nowIso,
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
