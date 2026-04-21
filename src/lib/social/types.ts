// ── Platform Insights Types ──────────────────────────────────────

export type FacebookPost = {
  id: string;
  message?: string;
  imageUrl?: string;
  createdTime: string;
  permalink?: string;
  likes: number;
  comments: number;
  shares: number;
  views?: number;
  reach?: number;
};

export type InstagramMedia = {
  id: string;
  caption?: string;
  mediaType: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  timestamp: string;
  likes: number;
  comments: number;
  permalink?: string;
  views?: number;
  reach?: number;
  saved?: number;
  shares?: number;
};

export type TikTokVideo = {
  id: string;
  title?: string;
  coverUrl?: string;
  createTime: number;
  shareUrl?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

export type FacebookInsights = {
  platform: 'facebook';
  connected: boolean;
  error?: string;
  pageName?: string;
  username?: string;
  avatarUrl?: string;
  bio?: string;
  profileUrl?: string;
  isVerified?: boolean;
  followers?: number;
  impressions7d?: number;
  engagements7d?: number;
  reach7d?: number;
  recentPosts?: FacebookPost[];
};

export type InstagramInsights = {
  platform: 'instagram';
  connected: boolean;
  error?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  bio?: string;
  profileUrl?: string;
  website?: string;
  followersCount?: number;
  follows?: number;
  mediaCount?: number;
  recentMedia?: InstagramMedia[];
};

export type TikTokInsights = {
  platform: 'tiktok';
  connected: boolean;
  error?: string;
  displayName?: string;
  avatarUrl?: string;
  username?: string;
  bioDescription?: string;
  isVerified?: boolean;
  profileDeepLink?: string;
  followers?: number;
  following?: number;
  totalLikes?: number;
  videoCount?: number;
  recentVideos?: TikTokVideo[];
};

export type UnifiedInsights = {
  productId: string;
  productName: string;
  facebook: FacebookInsights;
  instagram: InstagramInsights;
  tiktok: TikTokInsights;
  fetchedAt: string;
};
