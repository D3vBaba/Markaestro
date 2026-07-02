import type { SocialChannel } from '@/lib/schemas';

export type SocialEditorMode = 'normal' | 'markdown' | 'html' | 'none';
export type SocialMediaKind = 'text' | 'image' | 'video' | 'carousel';

export type ManagedSocialChannel = {
  channel: SocialChannel;
  label: string;
  providerKeys: readonly string[];
  editor: SocialEditorMode;
  maxLength: number;
  mediaKinds: readonly SocialMediaKind[];
  mediaRequired: boolean;
  maxMediaItems: number;
  supportsDirectPublish: boolean;
  supportsScheduling: boolean;
  setupHint: string;
};

export const socialChannelCatalog = [
  {
    channel: 'facebook',
    label: 'Facebook',
    providerKeys: ['meta'],
    editor: 'normal',
    maxLength: 63206,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    maxMediaItems: 10,
    supportsDirectPublish: true,
    supportsScheduling: true,
    setupHint: 'Connect Meta and select a Facebook page in product settings.',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    // Same preference order as the publish path (channelToProviders in
    // platform/connections.ts): standalone Instagram Login first, then the
    // Meta Page's linked IG business account.
    providerKeys: ['instagram', 'meta'],
    editor: 'normal',
    maxLength: 2200,
    mediaKinds: ['image', 'video', 'carousel'],
    mediaRequired: true,
    maxMediaItems: 10,
    supportsDirectPublish: true,
    supportsScheduling: true,
    setupHint: 'Connect Meta with a linked Instagram business account or connect Instagram directly.',
  },
  {
    channel: 'tiktok',
    label: 'TikTok',
    providerKeys: ['tiktok'],
    editor: 'normal',
    maxLength: 2200,
    mediaKinds: ['image', 'video'],
    mediaRequired: true,
    maxMediaItems: 35,
    supportsDirectPublish: false,
    supportsScheduling: true,
    setupHint: 'Connect TikTok in product settings.',
  },
  {
    channel: 'threads',
    label: 'Threads',
    providerKeys: ['threads'],
    editor: 'normal',
    maxLength: 500,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    maxMediaItems: 10,
    supportsDirectPublish: true,
    supportsScheduling: true,
    setupHint: 'Connect Threads in product settings.',
  },
  {
    channel: 'pinterest',
    label: 'Pinterest',
    providerKeys: ['pinterest'],
    editor: 'normal',
    maxLength: 500,
    mediaKinds: ['image', 'video', 'carousel'],
    mediaRequired: true,
    maxMediaItems: 5,
    supportsDirectPublish: true,
    supportsScheduling: true,
    setupHint: 'Connect Pinterest and select a board in product settings.',
  },
  {
    channel: 'linkedin',
    label: 'LinkedIn',
    providerKeys: ['linkedin_profile', 'linkedin_community', 'linkedin'],
    editor: 'normal',
    maxLength: 3000,
    mediaKinds: ['text', 'image', 'video', 'carousel'],
    mediaRequired: false,
    maxMediaItems: 20,
    supportsDirectPublish: true,
    supportsScheduling: true,
    setupHint: 'Connect LinkedIn and select a Profile or Page in product settings.',
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
