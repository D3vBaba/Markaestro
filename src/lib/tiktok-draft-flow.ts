import type { SocialChannel } from '@/lib/schemas';

// The shared "waiting on the user" status now lives in the channel-agnostic
// manual publish flow; re-exported here so existing import sites keep working.
export {
  PLATFORM_ACTION_REQUIRED_STATUS,
  LEGACY_EXPORTED_FOR_REVIEW_STATUS,
  isPlatformActionRequiredStatus,
} from '@/lib/manual-publish-flow';

export const TIKTOK_MANUAL_PUBLISH_ACTION = 'open_tiktok_inbox_and_complete_posting';
export const TIKTOK_MAX_IMAGE_COUNT = 35;

export function isTikTokDraftOnlyChannel(channel: SocialChannel | string): channel is 'tiktok' {
  return channel === 'tiktok';
}

export function isTikTokVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm)(\?|$)/.test(lower) || lower.includes('/videos/');
}

export function validateTikTokMediaUrls(mediaUrls?: string[]): string | null {
  const urls = mediaUrls || [];

  if (!urls[0]) {
    return 'TikTok requires media content (photo or video). Text-only posts are not supported.';
  }

  const videoUrls = urls.filter((url) => isTikTokVideoUrl(url));
  const imageUrls = urls.filter((url) => !isTikTokVideoUrl(url));

  if (videoUrls.length > 1) {
    return 'TikTok supports only one video per post.';
  }

  if (videoUrls.length === 1 && imageUrls.length > 0) {
    return 'TikTok does not support mixing video and image assets in one post.';
  }

  if (imageUrls.length > TIKTOK_MAX_IMAGE_COUNT) {
    return `TikTok supports up to ${TIKTOK_MAX_IMAGE_COUNT} images per post.`;
  }

  return null;
}

export function buildTikTokDraftDestinationAccountId(scopeId: string): string {
  const normalized = scopeId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `markaestro_drafts_${normalized || 'workspace'}`;
}
