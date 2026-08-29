/**
 * Workspace-level manual publishing defaults: channels listed in the
 * workspace doc's `manualPublishChannels` default in-app created posts to the
 * `manual_reminder` delivery mode (no platform API is called; the user posts
 * natively from the To Post queue). Public API posts have their own defaults
 * (see public-api/posts.ts).
 */

import { adminDb } from '@/lib/firebase-admin';
import { socialChannels, type SocialChannel } from '@/lib/schemas';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';
import { MANUAL_REMINDER_DELIVERY_MODE } from '@/lib/manual-publish-flow';

const socialChannelSet = new Set<string>(socialChannels);

export type ChannelDeliveryModes = Partial<Record<SocialChannel, string>>;

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
 * Delivery mode for one channel of an in-app created post.
 *
 * An explicit request-level mode always wins. Otherwise the channel is manual
 * when the workspace lists it as manual, or when the catalog says the channel
 * has no direct-publish path at all — a channel Markaestro cannot publish to
 * has to be manual regardless of what the workspace prefers.
 */
export function resolveChannelDeliveryMode(
  channel: string,
  explicitMode: string | undefined,
  manualChannels: SocialChannel[],
): string {
  if (explicitMode) return explicitMode;
  if (manualChannels.includes(channel as SocialChannel)) return MANUAL_REMINDER_DELIVERY_MODE;
  if (getSocialChannelConfig(channel)?.supportsDirectPublish === false) {
    return MANUAL_REMINDER_DELIVERY_MODE;
  }
  return 'direct_publish';
}

/**
 * Per-channel delivery modes for an in-app created post.
 *
 * Delivery mode belongs to the target, not the post: a user who sets Instagram
 * to manual and then composes to Instagram plus LinkedIn should still get the
 * LinkedIn half published automatically. The post-level `deliveryMode` remains
 * as the fallback for documents written before this map existed.
 */
export function resolveChannelDeliveryModes(
  targetChannels: string[],
  explicitMode: string | undefined,
  manualChannels: SocialChannel[],
): ChannelDeliveryModes {
  const modes: ChannelDeliveryModes = {};
  for (const channel of targetChannels) {
    if (!socialChannelSet.has(channel)) continue;
    modes[channel as SocialChannel] = resolveChannelDeliveryMode(channel, explicitMode, manualChannels);
  }
  return modes;
}

/**
 * Post-level delivery mode for an in-app created post: an explicit mode always
 * wins; otherwise the post is manual only when *every* target channel is
 * manual. A mixed post keeps an automatic post-level mode and carries the
 * per-channel detail in `channelDeliveryModes`, so one manual channel no
 * longer drags its automatic siblings into the To Post queue.
 */
export function resolveInAppDeliveryMode(
  targetChannels: string[],
  explicitMode: string | undefined,
  manualChannels: SocialChannel[],
): string | undefined {
  if (explicitMode) return explicitMode;
  const modes = Object.values(resolveChannelDeliveryModes(targetChannels, explicitMode, manualChannels));
  if (modes.length === 0) return undefined;
  return modes.every((mode) => mode === MANUAL_REMINDER_DELIVERY_MODE)
    ? MANUAL_REMINDER_DELIVERY_MODE
    : undefined;
}
