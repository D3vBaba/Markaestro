import type { SocialChannel } from '@/lib/schemas';
import type { PlatformAdapter } from './types';
import { metaPublishingAdapter } from './adapters/meta-publishing';
import { tiktokPublishingAdapter } from './adapters/tiktok-publishing';
import { linkedinPublishingAdapter } from './adapters/linkedin-publishing';
import { threadsPublishingAdapter } from './adapters/threads-publishing';
import { pinterestPublishingAdapter } from './adapters/pinterest-publishing';
import { youtubePublishingAdapter } from './adapters/youtube-publishing';

const adapters: PlatformAdapter[] = [
  metaPublishingAdapter,
  tiktokPublishingAdapter,
  linkedinPublishingAdapter,
  threadsPublishingAdapter,
  pinterestPublishingAdapter,
  youtubePublishingAdapter,
];

/**
 * Get an adapter by its ID.
 */
export function getAdapter(id: string): PlatformAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

/**
 * Get the publishing adapter for a given social channel.
 */
export function getAdapterForChannel(channel: SocialChannel): PlatformAdapter | undefined {
  return adapters.find((a) => a.channels.includes(channel));
}

/**
 * List all registered adapters.
 */
export function listAdapters(): readonly PlatformAdapter[] {
  return adapters;
}
