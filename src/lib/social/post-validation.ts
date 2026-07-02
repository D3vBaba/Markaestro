import type { SocialChannel } from '@/lib/schemas';
import { getSocialChannelConfig, getSocialChannelLabel } from '@/lib/social/channel-catalog';
import { isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';

export type SocialPostValidationInput = {
  content?: string | null;
  channel?: SocialChannel | string | null;
  targetChannels?: Array<SocialChannel | string> | null;
  mediaUrls?: string[] | null;
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
  const hasVideo = mediaUrls.some(isVideoMediaUrl);
  const hasImages = mediaUrls.some((url) => !isVideoMediaUrl(url));

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

  if (channels.includes('tiktok')) {
    const tiktokError = validateTikTokMediaUrls(mediaUrls);
    if (tiktokError) {
      issues.push({
        channel: 'tiktok',
        code: 'VALIDATION_TIKTOK_MEDIA_INVALID',
        message: tiktokError,
      });
    }
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
