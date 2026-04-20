import { fetchWithRetry } from '@/lib/fetch-retry';
import type { TikTokInsights, TikTokVideo } from './types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

function parseTikTokError(data: Record<string, unknown>): string | undefined {
  const err = data.error as Record<string, unknown> | undefined;
  if (!err) return undefined;
  if (err.code === 'ok') return undefined;
  return (err.message as string) || (err.code as string) || 'Unknown TikTok error';
}

export async function fetchTikTokInsights(accessToken: string): Promise<TikTokInsights> {
  try {
    const [userResult, videosResult] = await Promise.allSettled([
      fetchUserInfo(accessToken),
      fetchVideos(accessToken),
    ]);

    const user = userResult.status === 'fulfilled' ? userResult.value : null;
    const videos = videosResult.status === 'fulfilled' ? videosResult.value : [];

    if (!user) {
      return { platform: 'tiktok', connected: true, error: 'Could not fetch TikTok profile' };
    }

    return {
      platform: 'tiktok',
      connected: true,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      username: user.username,
      bioDescription: user.bioDescription,
      isVerified: user.isVerified,
      profileDeepLink: user.profileDeepLink,
      followers: user.followers,
      following: user.following,
      totalLikes: user.totalLikes,
      videoCount: user.videoCount,
      recentVideos: videos,
    };
  } catch (e) {
    return {
      platform: 'tiktok',
      connected: true,
      error: e instanceof Error ? e.message : 'Failed to fetch TikTok insights',
    };
  }
}

async function fetchUserInfo(token: string): Promise<{
  displayName: string;
  avatarUrl: string;
  username?: string;
  bioDescription?: string;
  isVerified?: boolean;
  profileDeepLink?: string;
  followers: number;
  following: number;
  totalLikes: number;
  videoCount: number;
} | null> {
  const fields = [
    'open_id',
    'union_id',
    'avatar_url',
    'avatar_large_url',
    'display_name',
    'username',
    'bio_description',
    'profile_deep_link',
    'is_verified',
    'follower_count',
    'following_count',
    'likes_count',
    'video_count',
  ].join(',');
  const res = await fetchWithRetry(
    `${TIKTOK_API}/user/info/?fields=${fields}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { maxRetries: 1 },
  );

  const data = await res.json();
  const error = parseTikTokError(data);
  if (error) return null;

  const user = data.data?.user;
  if (!user) return null;

  return {
    displayName: user.display_name || 'TikTok User',
    avatarUrl: user.avatar_large_url || user.avatar_url || '',
    username: user.username || undefined,
    bioDescription: user.bio_description || undefined,
    isVerified: typeof user.is_verified === 'boolean' ? user.is_verified : undefined,
    profileDeepLink: user.profile_deep_link || undefined,
    followers: user.follower_count || 0,
    following: user.following_count || 0,
    totalLikes: user.likes_count || 0,
    videoCount: user.video_count || 0,
  };
}

async function fetchVideos(token: string): Promise<TikTokVideo[]> {
  const fields = 'id,title,cover_image_url,create_time,share_url,view_count,like_count,comment_count,share_count';
  const res = await fetchWithRetry(
    `${TIKTOK_API}/video/list/?fields=${fields}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: 10 }),
    },
    { maxRetries: 1 },
  );

  const data = await res.json();
  const error = parseTikTokError(data);
  if (error) return [];

  const videos = data.data?.videos;
  if (!Array.isArray(videos)) return [];

  return videos.map((v: Record<string, unknown>) => ({
    id: v.id as string,
    title: (v.title as string) || undefined,
    coverUrl: (v.cover_image_url as string) || undefined,
    createTime: (v.create_time as number) || 0,
    shareUrl: (v.share_url as string) || undefined,
    views: (v.view_count as number) || 0,
    likes: (v.like_count as number) || 0,
    comments: (v.comment_count as number) || 0,
    shares: (v.share_count as number) || 0,
  }));
}
