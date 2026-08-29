import type { SocialChannel } from '@/lib/schemas';

export type SocialMediaKind = 'text' | 'image' | 'video' | 'carousel';

/**
 * The catalog is the source of truth for what a channel accepts.
 * `PLATFORM_CAPABILITY_REGISTRY[channel].publishing` restates the same facts
 * as booleans and is checked against this file by
 * `platform-capabilities.test.ts`. Change `mediaKinds` or `maxMediaItems`
 * here, not there.
 */
export type ManagedSocialChannel = {
  channel: SocialChannel;
  label: string;
  providerKeys: readonly string[];
  maxLength: number;
  mediaKinds: readonly SocialMediaKind[];
  mediaRequired: boolean;
  maxMediaItems: number;
  supportsDirectPublish: boolean;
  setupHint: string;
};

export const socialChannelCatalog = [
  {
    channel: 'facebook',
    label: 'Facebook',
    providerKeys: ['meta'],
    maxLength: 63206,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    maxMediaItems: 10,
    supportsDirectPublish: true,
    setupHint: 'Connect Meta and select a Facebook page in brand settings.',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    // Instagram is linked through standalone Instagram Login. Facebook Page
    // connections are intentionally Facebook-only.
    providerKeys: ['instagram'],
    maxLength: 2200,
    mediaKinds: ['image', 'video', 'carousel'],
    mediaRequired: true,
    maxMediaItems: 10,
    supportsDirectPublish: true,
    setupHint: 'Connect Instagram in brand settings.',
  },
  {
    channel: 'tiktok',
    label: 'TikTok',
    providerKeys: ['tiktok'],
    maxLength: 2200,
    mediaKinds: ['image', 'video'],
    mediaRequired: true,
    maxMediaItems: 35,
    // Direct Post is live for every connected account, so `false` here was
    // stale. Nothing reads this field yet; the capability parity test is what
    // now keeps it and the registry from drifting again.
    supportsDirectPublish: true,
    setupHint: 'Connect TikTok in brand settings.',
  },
  {
    channel: 'threads',
    label: 'Threads',
    providerKeys: ['threads'],
    maxLength: 500,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    // Threads carousels accept 20 items. `threads-publishing.ts` rejects
    // anything above this rather than truncating, so the two must agree.
    maxMediaItems: 20,
    supportsDirectPublish: true,
    setupHint: 'Connect Threads in brand settings.',
  },
  {
    channel: 'pinterest',
    label: 'Pinterest',
    providerKeys: ['pinterest'],
    maxLength: 500,
    mediaKinds: ['image', 'video', 'carousel'],
    mediaRequired: true,
    maxMediaItems: 5,
    supportsDirectPublish: true,
    setupHint: 'Connect Pinterest and select a board in brand settings.',
  },
  {
    channel: 'linkedin',
    label: 'LinkedIn',
    providerKeys: ['linkedin_profile', 'linkedin_community', 'linkedin'],
    maxLength: 3000,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    maxMediaItems: 20,
    supportsDirectPublish: true,
    setupHint: 'Connect LinkedIn and select a Profile or Page in brand settings.',
  },
] as const satisfies readonly ManagedSocialChannel[];

export function getSocialChannelConfig(channel: string): ManagedSocialChannel | undefined {
  return socialChannelCatalog.find((item) => item.channel === channel);
}

export function getSocialChannelLabel(channel: string): string {
  return getSocialChannelConfig(channel)?.label ?? channel;
}

export function getSocialChannelMaxLength(channel: string): number {
  return getSocialChannelConfig(channel)?.maxLength ?? 63206;
}

export function getSocialChannelProviderKeys(channel: SocialChannel): string[] {
  return [...(getSocialChannelConfig(channel)?.providerKeys ?? [channel])];
}

/**
 * The widest caption any channel accepts (Facebook, at 63,206). Payload-size
 * guards on API schemas bound against this rather than a literal, so adding a
 * longer-caption channel cannot make the API stricter than the composer.
 */
export const MAX_CAPTION_LENGTH: number = socialChannelCatalog.reduce(
  (max, item) => Math.max(max, item.maxLength),
  0,
);

/** The widest media count any channel accepts. Same reasoning as above. */
export const MAX_MEDIA_ITEMS: number = socialChannelCatalog.reduce(
  (max, item) => Math.max(max, item.maxMediaItems),
  0,
);
