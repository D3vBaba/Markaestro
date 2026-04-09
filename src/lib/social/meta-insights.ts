import { fetchWithRetry } from '@/lib/fetch-retry';
import type { FacebookPost, FacebookInsights, InstagramInsights, InstagramMedia } from './types';

const GRAPH_API = 'https://graph.facebook.com/v22.0';
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v25.0';

// ── Facebook Page Insights ──────────────────────────────────────

export async function fetchFacebookInsights(
  pageAccessToken: string,
  pageId: string,
  pageName?: string,
): Promise<FacebookInsights> {
  try {
    // Fetch page-level metrics and posts in parallel
    const [metricsResult, postsResult, pageResult] = await Promise.allSettled([
      fetchPageMetrics(pageAccessToken, pageId),
      fetchPagePosts(pageAccessToken, pageId),
      fetchPageFollowers(pageAccessToken, pageId),
    ]);

    const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
    const posts = postsResult.status === 'fulfilled' ? postsResult.value : [];
    const followers = pageResult.status === 'fulfilled' ? pageResult.value : undefined;

    return {
      platform: 'facebook',
      connected: true,
      pageName,
      followers,
      impressions7d: metrics?.impressions,
      engagements7d: metrics?.engagements,
      reach7d: metrics?.reach,
      recentPosts: posts,
    };
  } catch (e) {
    return {
      platform: 'facebook',
      connected: true,
      error: e instanceof Error ? e.message : 'Failed to fetch Facebook insights',
    };
  }
}

async function fetchPageFollowers(token: string, pageId: string): Promise<number | undefined> {
  const res = await fetchWithRetry(
    `${GRAPH_API}/${pageId}?fields=followers_count&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );
  if (!res.ok) return undefined;
  const data = await res.json();
  return data.followers_count;
}

async function fetchPageMetrics(
  token: string,
  pageId: string,
): Promise<{ impressions: number; engagements: number; reach: number } | null> {
  const metrics = 'page_impressions,page_post_engagements,page_impressions_unique';
  const res = await fetchWithRetry(
    `${GRAPH_API}/${pageId}/insights?metric=${metrics}&period=day&date_preset=last_7d&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );

  if (!res.ok) return null;
  const data = await res.json();

  let impressions = 0;
  let engagements = 0;
  let reach = 0;

  for (const entry of data.data || []) {
    const total = (entry.values || []).reduce(
      (sum: number, v: { value: number }) => sum + (v.value || 0),
      0,
    );
    if (entry.name === 'page_impressions') impressions = total;
    else if (entry.name === 'page_post_engagements') engagements = total;
    else if (entry.name === 'page_impressions_unique') reach = total;
  }

  return { impressions, engagements, reach };
}

async function fetchPagePosts(token: string, pageId: string): Promise<FacebookPost[]> {
  const fields = 'id,message,created_time,full_picture,shares,likes.summary(true),comments.summary(true)';
  const res = await fetchWithRetry(
    `${GRAPH_API}/${pageId}/posts?fields=${fields}&limit=10&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );

  if (!res.ok) return [];
  const data = await res.json();

  return (data.data || []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    message: (p.message as string) || undefined,
    imageUrl: (p.full_picture as string) || undefined,
    createdTime: p.created_time as string,
    likes: (p.likes as { summary?: { total_count?: number } })?.summary?.total_count || 0,
    comments: (p.comments as { summary?: { total_count?: number } })?.summary?.total_count || 0,
    shares: (p.shares as { count?: number })?.count || 0,
  }));
}

// ── Instagram Insights ──────────────────────────────────────────

export async function fetchInstagramInsights(
  accessToken: string,
  igAccountId: string,
  options?: { graphApi?: 'facebook' | 'instagram' },
): Promise<InstagramInsights> {
  const graphApi = options?.graphApi === 'instagram' ? INSTAGRAM_GRAPH_API : GRAPH_API;

  try {
    const [profileResult, mediaResult] = await Promise.allSettled([
      fetchIgProfile(accessToken, igAccountId, graphApi),
      fetchIgMedia(accessToken, igAccountId, graphApi),
    ]);

    const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
    const media = mediaResult.status === 'fulfilled' ? mediaResult.value : [];

    return {
      platform: 'instagram',
      connected: true,
      followersCount: profile?.followersCount,
      mediaCount: profile?.mediaCount,
      recentMedia: media,
    };
  } catch (e) {
    return {
      platform: 'instagram',
      connected: true,
      error: e instanceof Error ? e.message : 'Failed to fetch Instagram insights',
    };
  }
}

async function fetchIgProfile(
  token: string,
  igAccountId: string,
  graphApi: string,
): Promise<{ followersCount: number; mediaCount: number } | null> {
  const res = await fetchWithRetry(
    `${graphApi}/${igAccountId}?fields=followers_count,media_count&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    followersCount: data.followers_count || 0,
    mediaCount: data.media_count || 0,
  };
}

async function fetchIgMedia(token: string, igAccountId: string, graphApi: string): Promise<InstagramMedia[]> {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink';
  const res = await fetchWithRetry(
    `${graphApi}/${igAccountId}/media?fields=${fields}&limit=10&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );

  if (!res.ok) return [];
  const data = await res.json();

  const items: InstagramMedia[] = (data.data || []).map((m: Record<string, unknown>) => {
    const mediaType = (m.media_type as string) || 'IMAGE';
    // For VIDEO posts the media_url is a .mp4 — use thumbnail_url for display instead.
    // For IMAGE/CAROUSEL_ALBUM the media_url is the correct image URL (carousel parent
    // may not have one — handled below).
    const mediaUrl =
      mediaType === 'VIDEO'
        ? (m.thumbnail_url as string) || undefined
        : (m.media_url as string) || undefined;

    return {
      id: m.id as string,
      caption: (m.caption as string) || undefined,
      mediaType,
      mediaUrl,
      thumbnailUrl: (m.thumbnail_url as string) || undefined,
      timestamp: m.timestamp as string,
      likes: (m.like_count as number) || 0,
      comments: (m.comments_count as number) || 0,
      permalink: (m.permalink as string) || undefined,
    };
  });

  // CAROUSEL_ALBUM posts: the parent has no media_url — fetch the first child to get
  // a displayable image URL.
  await Promise.all(
    items
      .filter((item) => item.mediaType === 'CAROUSEL_ALBUM' && !item.mediaUrl)
      .map(async (item) => {
        try {
          const childRes = await fetchWithRetry(
            `${graphApi}/${item.id}/children?fields=media_url,thumbnail_url,media_type&access_token=${token}`,
            {},
            { maxRetries: 1 },
          );
          if (!childRes.ok) return;
          const childData = await childRes.json();
          const first = (childData.data as Record<string, unknown>[] | undefined)?.[0];
          if (!first) return;
          item.mediaUrl =
            first.media_type === 'VIDEO'
              ? (first.thumbnail_url as string) || undefined
              : (first.media_url as string) || undefined;
        } catch {
          // ignore — leave mediaUrl undefined, UI shows placeholder
        }
      }),
  );

  return items;
}
