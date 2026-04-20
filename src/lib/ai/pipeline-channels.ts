import type { SocialChannel } from '@/lib/schemas';

/**
 * Channel that drives the strictest copy + aspect-ratio constraints for a
 * multi-channel pipeline run. Order: short-form vertical first, then feed
 * vertical, then square feeds.
 */
export function getMostRestrictiveChannel(channels: SocialChannel[]): SocialChannel {
  const priority: SocialChannel[] = ['tiktok', 'instagram', 'facebook', 'linkedin'];
  for (const ch of priority) {
    if (channels.includes(ch)) return ch;
  }
  return channels[0];
}
