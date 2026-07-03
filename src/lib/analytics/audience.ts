import { adminDb } from '@/lib/firebase-admin';
import { getAllDocs } from '@/lib/firestore-pagination';
import { getAdapterForChannel } from '@/lib/platform/registry';
import { listConnections, updateConnectionStatus } from '@/lib/platform/connections';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { logger } from '@/lib/logger';
import type { AudienceSnapshotDoc } from './types';

export type AudienceCaptureSummary = {
  captured: number;
  skipped: number;
  errors: Array<{ channel: string; error: string }>;
};

/**
 * Stable per-account key so the same account connected in several scopes
 * (workspace + product) produces one snapshot per day, not duplicates.
 */
function accountKeyFor(connection: PlatformConnection, channel: SocialChannel): string {
  const meta = connection.metadata;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta[key];
      if (typeof value === 'string' && value) return value;
    }
    return '';
  };
  switch (channel) {
    case 'instagram': return pick('igAccountId', 'username');
    case 'facebook': return pick('pageId');
    case 'threads': return pick('threadsUserId', 'username');
    case 'tiktok': return pick('openId', 'displayName');
    case 'pinterest': return pick('username', 'boardId');
    case 'linkedin': return pick('linkedinDestinationUrn', 'linkedinDestinationAccountId');
    default: return '';
  }
}

function sanitizeDocId(value: string): string {
  return value.replace(/[/#?]/g, '_');
}

/**
 * Capture one follower-count snapshot per connected account per channel per
 * day. Platforms without native follower history (Threads, TikTok, Pinterest,
 * Facebook, LinkedIn) only get a trend because we store these ourselves.
 */
export async function captureAudienceSnapshots(
  workspaceId: string,
  date: string,
  nowIso: string,
): Promise<AudienceCaptureSummary> {
  const summary: AudienceCaptureSummary = { captured: 0, skipped: 0, errors: [] };

  const connections: PlatformConnection[] = [...await listConnections(workspaceId)];
  const products = await getAllDocs(`workspaces/${workspaceId}/products`);
  for (const product of products) {
    connections.push(...await listConnections(workspaceId, product.id));
  }

  const seen = new Set<string>();
  for (const connection of connections) {
    if (connection.status !== 'connected') continue;
    for (const channel of connection.channels) {
      const adapter = getAdapterForChannel(channel);
      if (!adapter?.fetchAudience) continue;

      const accountKey = accountKeyFor(connection, channel) || connection.provider;
      const docId = sanitizeDocId(`${date}_${channel}_${accountKey}`);
      if (seen.has(docId)) continue;
      seen.add(docId);

      const result = await adapter.fetchAudience(connection, channel);
      if (!result.ok) {
        if (result.reason === 'auth') {
          try {
            await updateConnectionStatus(workspaceId, connection.provider, 'error', connection.productId);
          } catch { /* connection doc may be gone */ }
          summary.errors.push({ channel, error: result.error });
        } else if (result.reason === 'transient') {
          summary.errors.push({ channel, error: result.error });
        } else {
          summary.skipped++;
        }
        continue;
      }

      const doc: AudienceSnapshotDoc = {
        date,
        channel,
        provider: connection.provider,
        productId: connection.productId ?? null,
        accountKey,
        followers: result.followers,
        capturedAt: nowIso,
      };
      await adminDb.doc(`workspaces/${workspaceId}/audienceSnapshots/${docId}`).set(doc);
      summary.captured++;
    }
  }

  if (summary.captured > 0 || summary.errors.length > 0) {
    logger.info('audience snapshots captured', {
      event: 'analytics.audience_capture',
      workspaceId,
      date,
      captured: summary.captured,
      skipped: summary.skipped,
      errors: summary.errors.length,
    });
  }
  return summary;
}
