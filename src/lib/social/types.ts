import type { SocialChannel } from '@/lib/schemas';

export type PublishRequest = {
  content: string;
  channel: SocialChannel;
  mediaUrls?: string[];
};

export type PublishResult = {
  success: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
};

export type XConfig = {
  accessToken: string;
  username: string;
};

export type FacebookConfig = {
  accessToken: string;
  pageId: string;
};

export type InstagramConfig = {
  accessToken: string;
  igAccountId: string;
};

export type TikTokConfig = {
  accessToken: string;
  openId: string;
};

export type IntegrationConfig = XConfig | FacebookConfig | InstagramConfig | TikTokConfig;
