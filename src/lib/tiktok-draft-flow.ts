import type { SocialChannel } from '@/lib/schemas';

export const TIKTOK_MANUAL_REVIEW_ACTION = 'open_tiktok_inbox_and_complete_editing';

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

  if (imageUrls.length > 10) {
    return 'TikTok supports up to 10 images per post.';
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
