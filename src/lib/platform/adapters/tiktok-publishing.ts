import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

function parseTikTokError(data: Record<string, unknown>): string | undefined {
  const err = data.error as Record<string, unknown> | undefined;
  if (!err) return undefined;
  if (err.code === 'ok') return undefined;
  return (err.message as string) || (err.code as string) || 'Unknown TikTok error';
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm)(\?|$)/.test(lower) || lower.includes('/videos/');
}

export const tiktokPublishingAdapter: PlatformAdapter = {
  id: 'tiktok-publishing',
  name: 'TikTok',
  channels: ['tiktok'],
  capabilities: [
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    const accessToken = getAccessToken(connection);

    if (!request.mediaUrls?.[0]) {
      return {
        success: false,
        error: 'TikTok requires media content (photo or video). Text-only posts are not supported.',
      };
    }

    const mediaUrl = request.mediaUrls[0];
    const isVideo = isVideoUrl(mediaUrl);

    try {
      // Build request body based on media type
      const body: Record<string, unknown> = {
        post_info: {
          title: request.content.substring(0, 90),
          description: request.content.substring(0, 4000),
          disable_comment: false,
          privacy_level: 'SELF_ONLY',
          auto_add_music: !isVideo, // don't auto-add music to videos
        },
        post_mode: 'DIRECT_POST',
        media_type: isVideo ? 'VIDEO' : 'PHOTO',
      };

      if (isVideo) {
        body.source_info = {
          source: 'PULL_FROM_URL',
          video_url: mediaUrl,
        };
      } else {
        body.source_info = {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [mediaUrl],
        };
      }

      const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/content/init/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(body),
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
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = getAccessToken(connection);
    try {
      const res = await fetchWithRetry(
        `${TIKTOK_API}/user/info/?fields=display_name,avatar_url,profile_deep_link,is_verified`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = await res.json();
      const error = parseTikTokError(data);
      if (error) return { ok: false, error };

      return { ok: true, label: data.data?.user?.display_name || 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok connection test failed' };
    }
  },

  validateConnection(_connection: PlatformConnection, _channel) {
    return null;
  },
};
