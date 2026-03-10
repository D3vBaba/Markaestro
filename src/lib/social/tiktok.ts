import type { PublishResult, TikTokConfig } from './types';
import { fetchWithRetry } from '@/lib/fetch-retry';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

/** Parse TikTok's error response format. */
function parseTikTokError(data: Record<string, unknown>): string | undefined {
  const err = data.error as Record<string, unknown> | undefined;
  if (!err) return undefined;
  if (err.code === 'ok') return undefined;
  return (err.message as string) || (err.code as string) || 'Unknown TikTok error';
}

/**
 * Publish content to TikTok via Content Posting API v2.
 * TikTok requires media (photo or video) — text-only posts are not supported.
 */
export async function publishToTikTok(
  config: TikTokConfig,
  content: string,
  mediaUrl?: string,
): Promise<PublishResult> {
  if (!config.accessToken) {
    return { success: false, error: 'TikTok access token is missing' };
  }

  if (!mediaUrl) {
    return {
      success: false,
      error: 'TikTok requires media content (photo or video). Text-only posts are not supported.',
    };
  }

  try {
    const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/content/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: content.substring(0, 150),
          description: content,
          disable_comment: false,
          privacy_level: 'SELF_ONLY',
          auto_add_music: true,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [mediaUrl],
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      }),
    });

    const data = await res.json();
    const error = parseTikTokError(data);
    if (error) {
      return { success: false, error: `TikTok publish failed: ${error}` };
    }

    return {
      success: true,
      externalId: data.data?.publish_id || '',
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown TikTok publishing error',
    };
  }
}

/**
 * Test TikTok connection by fetching user info.
 */
export async function testTikTokConnection(
  config: TikTokConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetchWithRetry(
      `${TIKTOK_API}/user/info/?fields=open_id,display_name,avatar_url`,
      { headers: { Authorization: `Bearer ${config.accessToken}` } },
    );

    const data = await res.json();
    const error = parseTikTokError(data);
    if (error) {
      return { ok: false, error };
    }

    return {
      ok: true,
      username: data.data?.user?.display_name || 'Connected',
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'TikTok connection test failed',
    };
  }
}
