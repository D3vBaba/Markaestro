/**
 * Which platforms let an app delete a post.
 *
 * Instagram and TikTok offer no delete endpoint: a post there can only be
 * removed in the platform's own app. Everything that offers a takedown
 * (the Platform Posts tab, the public delete with `platform=true`, the MCP
 * `delete_post` tool) reads this table first, so those channels are never
 * offered a delete that would only fail: rows say `canTakeDown: false`, a
 * multi-channel takedown skips them and says so, and a direct attempt is
 * refused before any platform call. Pure, so the analytics row builder and
 * the Zod schemas can read it.
 */
import type { SocialChannel } from '@/lib/schemas';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';

export const PLATFORM_POST_DELETE_SUPPORTED: Record<SocialChannel, boolean> = {
  facebook: true,
  instagram: false,
  threads: true,
  tiktok: false,
  linkedin: true,
  pinterest: true,
  x: true,
};

export function canDeleteOnPlatform(channel: string): boolean {
  return PLATFORM_POST_DELETE_SUPPORTED[channel as SocialChannel] === true;
}

/** The refusal a caller sees for a channel without a delete; the same words the app shows. */
export function platformDeleteUnsupportedMessage(channel: SocialChannel): string {
  const label = getSocialChannelLabel(channel);
  return `${label} does not allow apps to delete posts. Remove it from the ${label} app instead.`;
}
