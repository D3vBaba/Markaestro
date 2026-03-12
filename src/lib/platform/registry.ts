import type { SocialChannel } from '@/lib/schemas';
import type { PlatformAdapter } from './types';
import { xPublishingAdapter } from './adapters/x-publishing';
import { metaPublishingAdapter } from './adapters/meta-publishing';
import { tiktokPublishingAdapter } from './adapters/tiktok-publishing';

const adapters: PlatformAdapter[] = [
  xPublishingAdapter,
  metaPublishingAdapter,
  tiktokPublishingAdapter,
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
