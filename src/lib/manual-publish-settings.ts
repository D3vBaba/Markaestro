/**
 * Workspace-level manual publishing defaults: channels listed in the
 * workspace doc's `manualPublishChannels` default in-app created posts to the
 * `manual_reminder` delivery mode (no platform API is called; the user posts
 * natively from the To Post queue). Public API posts have their own defaults
 * (see public-api/posts.ts).
 */

import { adminDb } from '@/lib/firebase-admin';
import { socialChannels, type SocialChannel } from '@/lib/schemas';

const socialChannelSet = new Set<string>(socialChannels);

export function normalizeManualPublishChannels(value: unknown): SocialChannel[] {
  if (!Array.isArray(value)) return [];
  const channels = value.filter(
    (channel): channel is SocialChannel => typeof channel === 'string' && socialChannelSet.has(channel),
  );
  return [...new Set(channels)];
}

export async function getManualPublishChannels(workspaceId: string): Promise<SocialChannel[]> {
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get();
  return normalizeManualPublishChannels(snap.data()?.manualPublishChannels);
}

/**
 * Delivery mode for an in-app created post: an explicit mode always wins;
 * otherwise the post is manual when any target channel defaults to manual.
 * (One auto-publishing channel must never drag a manual-default channel into
 * a platform API call — the post-level mode goes manual for the whole post.)
 */
export function resolveInAppDeliveryMode(
  targetChannels: string[],
  explicitMode: string | undefined,
  manualChannels: SocialChannel[],
): string | undefined {
  if (explicitMode) return explicitMode;
  const manualSet = new Set<string>(manualChannels);
  return targetChannels.some((channel) => manualSet.has(channel)) ? 'manual_reminder' : undefined;
}
