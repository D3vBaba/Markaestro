import { graphApiFetch } from '@/lib/platform/meta-graph-api';
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
    const [metricsResult, postsResult, profileResult] = await Promise.allSettled([
      fetchPageMetrics(pageAccessToken, pageId),
      fetchPagePosts(pageAccessToken, pageId),
      fetchPageProfile(pageAccessToken, pageId),
    ]);

    const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
    const posts = postsResult.status === 'fulfilled' ? postsResult.value : [];
    const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;

    return {
      platform: 'facebook',
      connected: true,
      pageName: profile?.name || pageName,
      username: profile?.username,
      avatarUrl: profile?.avatarUrl,
      bio: profile?.about,
      profileUrl: profile?.link,
      isVerified: profile?.isVerified,
      followers: profile?.followers,
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

type FacebookPageProfile = {
  name?: string;
  username?: string;
  avatarUrl?: string;
  about?: string;
  link?: string;
  isVerified?: boolean;
  followers?: number;
};

async function fetchPageProfile(token: string, pageId: string): Promise<FacebookPageProfile | null> {
  const fields =
    'name,username,about,link,verification_status,fan_count,followers_count,picture.type(large){url}';
  const res = await graphApiFetch(
    `${GRAPH_API}/${pageId}?fields=${fields}&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;

  const picture = data.picture as { data?: { url?: string } } | undefined;
  const verification = (data.verification_status as string) || undefined;

  return {
    name: (data.name as string) || undefined,
    username: (data.username as string) || undefined,
    avatarUrl: picture?.data?.url,
    about: (data.about as string) || undefined,
    link: (data.link as string) || undefined,
    isVerified:
      verification === undefined ? undefined : verification !== 'not_verified' && verification !== '',
    followers:
      (data.followers_count as number) ?? (data.fan_count as number) ?? undefined,
  };
}

async function fetchPageMetrics(
  token: string,
  pageId: string,
): Promise<{ impressions: number; engagements: number; reach: number } | null> {
  const metrics = 'page_impressions,page_post_engagements,page_impressions_unique';
  const res = await graphApiFetch(
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
  const fields =
    'id,message,created_time,full_picture,permalink_url,shares,likes.summary(true),comments.summary(true)';
  const res = await graphApiFetch(
    `${GRAPH_API}/${pageId}/posts?fields=${fields}&limit=10&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );

  if (!res.ok) return [];
  const data = await res.json();

  const posts: FacebookPost[] = (data.data || []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    message: (p.message as string) || undefined,
    imageUrl: (p.full_picture as string) || undefined,
    createdTime: p.created_time as string,
    permalink: (p.permalink_url as string) || undefined,
    likes: (p.likes as { summary?: { total_count?: number } })?.summary?.total_count || 0,
    comments: (p.comments as { summary?: { total_count?: number } })?.summary?.total_count || 0,
    shares: (p.shares as { count?: number })?.count || 0,
  }));

  await Promise.all(
    posts.map(async (post) => {
      const extra = await fetchFacebookPostInsights(token, post.id);
      if (extra) {
        post.views = extra.views;
        post.reach = extra.reach;
      }
    }),
  );

  return posts;
}

async function fetchFacebookPostInsights(
  token: string,
  postId: string,
): Promise<{ views?: number; reach?: number } | null> {
  try {
    const metrics = 'post_impressions,post_impressions_unique';
    const res = await graphApiFetch(
      `${GRAPH_API}/${postId}/insights?metric=${metrics}&access_token=${token}`,
      {},
      { maxRetries: 1 },
    );
    if (!res.ok) return null;
    const data = await res.json();
    let views: number | undefined;
    let reach: number | undefined;
    for (const entry of data.data || []) {
      const value = (entry.values?.[0]?.value as number) || 0;
      if (entry.name === 'post_impressions') views = value;
      else if (entry.name === 'post_impressions_unique') reach = value;
    }
    return { views, reach };
  } catch {
    return null;
  }
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
      displayName: profile?.name,
      username: profile?.username,
      avatarUrl: profile?.profilePictureUrl,
      bio: profile?.biography,
      website: profile?.website,
      profileUrl: profile?.username ? `https://instagram.com/${profile.username}` : undefined,
      followersCount: profile?.followersCount,
      follows: profile?.followsCount,
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

type IgProfile = {
  name?: string;
  username?: string;
  biography?: string;
  profilePictureUrl?: string;
  website?: string;
  followersCount: number;
  followsCount?: number;
  mediaCount: number;
};

async function fetchIgProfile(
  token: string,
  igAccountId: string,
  graphApi: string,
): Promise<IgProfile | null> {
  const fields =
    'name,username,biography,profile_picture_url,website,followers_count,follows_count,media_count';
  const res = await graphApiFetch(
    `${graphApi}/${igAccountId}?fields=${fields}&access_token=${token}`,
    {},
    { maxRetries: 1 },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  return {
    name: (data.name as string) || undefined,
    username: (data.username as string) || undefined,
    biography: (data.biography as string) || undefined,
    profilePictureUrl: (data.profile_picture_url as string) || undefined,
    website: (data.website as string) || undefined,
    followersCount: (data.followers_count as number) || 0,
    followsCount: (data.follows_count as number) || undefined,
    mediaCount: (data.media_count as number) || 0,
  };
}

async function fetchIgMedia(token: string, igAccountId: string, graphApi: string): Promise<InstagramMedia[]> {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink';
  const res = await graphApiFetch(
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
          const childRes = await graphApiFetch(
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

  // Fetch per-media insights (views/reach/saved/shares). Best-effort per item —
  // metric availability varies by media type and token scope; we swallow failures.
  await Promise.all(
    items.map(async (item) => {
      const insights = await fetchIgMediaInsights(token, item.id, item.mediaType, graphApi);
      if (insights) {
        item.views = insights.views;
        item.reach = insights.reach;
        item.saved = insights.saved;
        item.shares = insights.shares;
      }
    }),
  );

  return items;
}

async function fetchIgMediaInsights(
  token: string,
  mediaId: string,
  mediaType: string,
  graphApi: string,
): Promise<{ views?: number; reach?: number; saved?: number; shares?: number } | null> {
  // Metric set depends on media type. `views` is only supported for video-like content.
  const isVideoLike = mediaType === 'VIDEO' || mediaType === 'REELS';
  const metrics = isVideoLike
    ? 'views,reach,saved,shares'
    : 'reach,saved,shares';

  try {
    const res = await graphApiFetch(
      `${graphApi}/${mediaId}/insights?metric=${metrics}&access_token=${token}`,
      {},
      { maxRetries: 1 },
    );
    if (!res.ok) return null;
    const data = await res.json();

    const result: { views?: number; reach?: number; saved?: number; shares?: number } = {};
    for (const entry of data.data || []) {
      const value = (entry.values?.[0]?.value as number) || 0;
      if (entry.name === 'views') result.views = value;
      else if (entry.name === 'reach') result.reach = value;
      else if (entry.name === 'saved') result.saved = value;
      else if (entry.name === 'shares') result.shares = value;
    }
    return result;
  } catch {
    return null;
  }
}
