import { adminDb } from '@/lib/firebase-admin';
import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit';
import type { PlatformConnection } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';

const LOCK_LEASE_MS = 5 * 60 * 1000;

export const PUBLISH_RATE_LIMITS: Record<SocialChannel, RateLimitConfig> = {
  facebook: { limit: 10, windowMs: 60_000 },
  instagram: { limit: 10, windowMs: 60_000 },
  tiktok: { limit: 4, windowMs: 60_000 },
  linkedin: { limit: 5, windowMs: 60_000 },
};

function encodeKey(raw: string) {
  return Buffer.from(raw).toString('base64url');
}

export function getPublishDestinationKey(channel: SocialChannel, connection: PlatformConnection): string {
  if (channel === 'facebook') {
    return `facebook:${String(connection.metadata.pageId || connection.productId || connection.workspaceId)}`;
  }
  if (channel === 'instagram') {
    return `instagram:${String(connection.metadata.igAccountId || connection.metadata.pageId || connection.workspaceId)}`;
  }
  if (channel === 'linkedin') {
    return `linkedin:${String(connection.metadata.authorUrn || connection.metadata.personId || connection.productId || connection.workspaceId)}`;
  }
  return `tiktok:${String(connection.metadata.openId || connection.metadata.username || connection.productId || connection.workspaceId)}`;
}

export async function assertPublishRateLimit(destinationKey: string, channel: SocialChannel) {
  const result = await checkRateLimit(`publish:${destinationKey}`, PUBLISH_RATE_LIMITS[channel]);
  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}

export async function acquirePublishLock(destinationKey: string, runId: string): Promise<boolean> {
  const ref = adminDb.doc(`_publishLocks/${encodeKey(destinationKey)}`);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LOCK_LEASE_MS).toISOString();

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const currentRunId = snap.data()?.runId as string | undefined;
    const currentExpiresAt = snap.data()?.expiresAt as string | undefined;

    if (snap.exists && currentRunId !== runId && currentExpiresAt && currentExpiresAt > nowIso) {
      return false;
    }

    tx.set(ref, {
      runId,
      destinationKey,
      acquiredAt: nowIso,
      expiresAt,
    });
    return true;
  });
}

export async function releasePublishLock(destinationKey: string, runId: string) {
  const ref = adminDb.doc(`_publishLocks/${encodeKey(destinationKey)}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if (snap.data()?.runId !== runId) return;
    tx.delete(ref);
  });
}
