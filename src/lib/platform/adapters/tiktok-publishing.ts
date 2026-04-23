import { fetchWithRetry } from '@/lib/fetch-retry';
import { isTikTokVideoUrl, validateTikTokMediaUrls } from '@/lib/tiktok-draft-flow';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

function parseTikTokError(data: Record<string, unknown>): string | undefined {
  const err = data.error as Record<string, unknown> | undefined;
  if (!err) return undefined;
  if (err.code === 'ok') return undefined;
  const code = err.code as string | undefined;
  const message = err.message as string | undefined;
  const logId = err.log_id as string | undefined;
  // TikTok's policy errors are intentionally vague; surface the error code and
  // log_id in the returned message so we can diagnose specific failures.
  const parts = [message || 'Unknown TikTok error'];
  if (code && code !== 'ok') parts.push(`code=${code}`);
  if (logId) parts.push(`log_id=${logId}`);
  return parts.join(' | ');
}

type TikTokPublishStatusResult = {
  status?: TikTokPublishStatus | string;
  failReason?: string;
  error?: string;
};

export async function fetchTikTokPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<TikTokPublishStatusResult> {
  const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const data = await res.json();
  const error = parseTikTokError(data);
  if (error) return { error };

  return {
    status: data.data?.status as string | undefined,
    failReason: data.data?.fail_reason as string | undefined,
  };
}

function buildTikTokMediaProxyUrl(mediaUrl: string, kind: 'image' | 'video'): string {
  const appUrl = process.env.OAUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl) {
    throw new Error('Missing app URL for TikTok media proxy');
  }

  const proxyPath = kind === 'video' ? '/api/media/video-proxy' : '/api/media/proxy';
  const proxyUrl = new URL(proxyPath, appUrl);
  proxyUrl.searchParams.set('url', mediaUrl);
  return proxyUrl.toString();
}

async function uploadVideoToTikTokInbox(
  accessToken: string,
  mediaUrl: string,
): Promise<{ publishId?: string; error?: string }> {
  // Video assets already live on our server-side storage, so expose them on a
  // verified Markaestro URL and let TikTok fetch them directly. This avoids the
  // slower download-into-memory + chunked re-upload flow from our app server.
  const proxyUrl = buildTikTokMediaProxyUrl(mediaUrl, 'video');
  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: proxyUrl,
      },
    }),
  });

  const initData = await initRes.json();
  const initError = parseTikTokError(initData);
  if (initError) {
    return { error: initError };
  }

  const publishId = initData.data?.publish_id as string | undefined;
  if (!publishId) {
    return { error: 'TikTok did not return a publish ID' };
  }

  return { publishId };
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
    const validationError = validateTikTokMediaUrls(request.mediaUrls);
    if (validationError) {
      return {
        success: false,
        error: validationError,
      };
    }

    const mediaUrls = request.mediaUrls || [];
    const videoUrls = mediaUrls.filter((url) => isTikTokVideoUrl(url));
    const imageUrls = mediaUrls.filter((url) => !isTikTokVideoUrl(url));

    try {
      if (videoUrls.length === 1) {
        const result = await uploadVideoToTikTokInbox(accessToken, videoUrls[0]);
        if (result.error) {
          return { success: false, error: `TikTok publish failed: ${result.error}` };
        }
        return {
          success: false,
          pending: true,
          externalId: result.publishId || '',
        };
      }

      // Photo carousel path uses MEDIA_UPLOAD (video.upload scope). Content
      // lands in the user's TikTok inbox; they finalize caption/privacy and
      // post from the app. Direct Post requires a separate audit approval.
      // PULL_FROM_URL still requires a verified domain, so Firebase URLs are
      // proxied through our own domain via /api/media/proxy.
      const proxyUrls = imageUrls.map((url) => buildTikTokMediaProxyUrl(url, 'image'));

      const body: Record<string, unknown> = {
        post_info: {
          title: request.content.substring(0, 90),
          description: request.content.substring(0, 4000),
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: request.photoCoverIndex ?? 0,
          photo_images: proxyUrls,
        },
        post_mode: 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
      };

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

      const publishId = data.data?.publish_id as string | undefined;
      if (!publishId) {
        return { success: false, error: 'TikTok did not return a publish ID' };
      }

      return {
        success: false,
        pending: true,
        externalId: publishId,
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
        `${TIKTOK_API}/user/info/?fields=open_id,display_name,avatar_url`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = await res.json();
      const error = parseTikTokError(data);
      if (error) return { ok: false, error };

      return { ok: true, label: 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'TikTok connection test failed' };
    }
  },

  validateConnection() {
    return null;
  },
};
