import type { SocialChannel } from '@/lib/schemas';
import { getSocialChannelConfig, getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { TIKTOK_MAX_IMAGE_COUNT, isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';

export type SocialPostValidationInput = {
  content?: string | null;
  channel?: SocialChannel | string | null;
  targetChannels?: Array<SocialChannel | string> | null;
  mediaUrls?: string[] | null;
  /**
   * Resolved media kinds, index-aligned with `mediaUrls`. When present it is
   * authoritative; when absent the URL-extension heuristic decides.
   *
   * This is the third divergence 4.6 closed: the app inferred video from a
   * filename regex while the API read the stored asset's type, so the same
   * media could validate differently on the two surfaces and a URL with no
   * recognisable extension was silently treated as an image, routing it down
   * the wrong publish path. The app's URLs come from `uploadToStorage`, which
   * controls the path, so the regex is reliable there today; the API passes
   * real types and never guesses.
   */
  mediaTypes?: Array<'image' | 'video'> | null;
};

export type SocialPostValidationIssue = {
  code: string;
  message: string;
  channel?: SocialChannel;
};

export function normalizeTargetChannels(input: SocialPostValidationInput): SocialChannel[] {
  const raw = Array.isArray(input.targetChannels)
    ? input.targetChannels
    : input.channel
      ? [input.channel]
      : [];
  const channels: SocialChannel[] = [];

  for (const channel of raw) {
    const config = typeof channel === 'string' ? getSocialChannelConfig(channel) : undefined;
    if (!config) continue;
    if (!channels.includes(config.channel)) channels.push(config.channel);
  }

  return channels;
}

export function isVideoMediaUrl(url: string): boolean {
  return isTikTokVideoUrl(url) || /\.(mp4|mov|avi|webm|mkv)(?:[?&]|$)/i.test(url);
}

export function getSharedMediaLimit(channels: SocialChannel[]): number {
  if (channels.length === 0) return 0;
  return channels.reduce((limit, channel) => {
    const max = getSocialChannelConfig(channel)?.maxMediaItems ?? limit;
    return Math.min(limit, max);
  }, Number.POSITIVE_INFINITY);
}

export function validateSocialPost(input: SocialPostValidationInput): SocialPostValidationIssue[] {
  const issues: SocialPostValidationIssue[] = [];
  const channels = normalizeTargetChannels(input);
  const mediaUrls = input.mediaUrls ?? [];
  const content = input.content?.trim() ?? '';
  // Authoritative types when the caller has them, the URL heuristic otherwise.
  const mediaKinds = mediaUrls.map((url, index) =>
    input.mediaTypes?.[index] ?? (isVideoMediaUrl(url) ? 'video' : 'image'));
  const hasVideo = mediaKinds.includes('video');
  const hasImages = mediaKinds.includes('image');

  if (channels.length === 0) {
    issues.push({
      code: 'VALIDATION_CHANNEL_REQUIRED',
      message: 'Select at least one publishing channel.',
    });
    return issues;
  }

  for (const channel of channels) {
    const config = getSocialChannelConfig(channel);
    if (!config) continue;
    const label = getSocialChannelLabel(channel);

    if (content.length > config.maxLength) {
      issues.push({
        channel,
        code: `VALIDATION_${channel.toUpperCase()}_CONTENT_TOO_LONG`,
        message: `${label} captions must be ${config.maxLength.toLocaleString()} characters or fewer.`,
      });
    }

    if (config.mediaRequired && mediaUrls.length === 0) {
      issues.push({
        channel,
        code: `VALIDATION_${channel.toUpperCase()}_MEDIA_REQUIRED`,
        message: `${label} requires at least one image or video.`,
      });
    }

    if (mediaUrls.length > config.maxMediaItems) {
      issues.push({
        channel,
        code: `VALIDATION_${channel.toUpperCase()}_TOO_MANY_MEDIA_ITEMS`,
        message: `${label} supports up to ${config.maxMediaItems} media item${config.maxMediaItems === 1 ? '' : 's'}.`,
      });
    }

    if (hasVideo && !config.mediaKinds.includes('video')) {
      issues.push({
        channel,
        code: `VALIDATION_${channel.toUpperCase()}_VIDEO_NOT_SUPPORTED`,
        message: `${label} does not support video uploads from Markaestro.`,
      });
    }

    if (hasImages && !config.mediaKinds.some((kind) => kind === 'image' || kind === 'carousel')) {
      issues.push({
        channel,
        code: `VALIDATION_${channel.toUpperCase()}_IMAGE_NOT_SUPPORTED`,
        message: `${label} does not support image uploads from Markaestro.`,
      });
    }
  }

  if (channels.includes('tiktok') && mediaUrls.length > 0) {
    if (input.mediaTypes) {
      // Resolved types are available, so classify by them rather than by URL
      // shape. Distinct codes per rule, matching what the public API has
      // always returned, because clients branch on the exact code.
      const videoCount = mediaKinds.filter((kind) => kind === 'video').length;
      const imageCount = mediaKinds.length - videoCount;
      if (videoCount > 1) {
        issues.push({
          channel: 'tiktok',
          code: 'VALIDATION_TIKTOK_MAX_ONE_VIDEO',
          message: 'TikTok supports only one video per post.',
        });
      } else if (videoCount === 1 && imageCount > 0) {
        issues.push({
          channel: 'tiktok',
          code: 'VALIDATION_TIKTOK_VIDEO_CANNOT_BE_COMBINED',
          message: 'TikTok does not support mixing video and image assets in one post.',
        });
      } else if (imageCount > TIKTOK_MAX_IMAGE_COUNT) {
        issues.push({
          channel: 'tiktok',
          code: 'VALIDATION_TIKTOK_MEDIA_INVALID',
          message: `TikTok supports up to ${TIKTOK_MAX_IMAGE_COUNT} images per post.`,
        });
      }
    } else {
      const tiktokError = validateTikTokMediaUrls(mediaUrls);
      if (tiktokError) {
        issues.push({
          channel: 'tiktok',
          code: 'VALIDATION_TIKTOK_MEDIA_INVALID',
          message: tiktokError,
        });
      }
    }
  }

  // The API always enforced this and the app never did, so an empty Facebook
  // post could be scheduled from the composer and failed later with a raw
  // Graph API error. Facebook's catalog entry is right that media is optional
  // and there is no caption minimum; what it cannot express is that at least
  // one of the two must exist.
  if (channels.includes('facebook') && !content && mediaUrls.length === 0) {
    issues.push({
      channel: 'facebook',
      code: 'VALIDATION_FACEBOOK_POST_REQUIRES_CONTENT_OR_MEDIA',
      message: 'A Facebook post needs a caption, media, or both.',
    });
  }

  if (channels.includes('pinterest') && hasVideo && mediaUrls.length > 1) {
    issues.push({
      channel: 'pinterest',
      code: 'VALIDATION_PINTEREST_VIDEO_MUST_BE_SINGLE_MEDIA',
      message: 'Pinterest video pins must use a single video without additional images.',
    });
  }

  if (channels.includes('linkedin')) {
    if (!content) {
      issues.push({
        channel: 'linkedin',
        code: 'VALIDATION_LINKEDIN_CONTENT_REQUIRED',
        message: 'LinkedIn posts require text content.',
      });
    }
    if (hasVideo && mediaUrls.length > 1) {
      issues.push({
        channel: 'linkedin',
        code: 'VALIDATION_LINKEDIN_VIDEO_MUST_BE_SINGLE_MEDIA',
        message: 'LinkedIn video posts must use a single video without additional images.',
      });
    }
  }

  return issues;
}

export function firstSocialPostValidationError(input: SocialPostValidationInput): string | null {
  return validateSocialPost(input)[0]?.message ?? null;
}
