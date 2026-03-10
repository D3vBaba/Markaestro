import type { FacebookConfig, PublishResult } from './types';
import { fetchWithRetry } from '@/lib/fetch-retry';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export async function publishToFacebook(
  config: FacebookConfig,
  content: string,
  mediaUrl?: string,
): Promise<PublishResult> {
  if (!config.pageId) {
    return { success: false, error: 'Facebook page ID is not configured' };
  }

  try {
    // Photo post: use /{pageId}/photos endpoint
    if (mediaUrl) {
      const res = await fetchWithRetry(`${GRAPH_API}/${config.pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mediaUrl,
          message: content,
          access_token: config.accessToken,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return {
          success: false,
          error: `Facebook photo error: ${err.error?.message || res.statusText}`,
        };
      }

      const data = await res.json();
      const postId = data.post_id || data.id;
      return {
        success: true,
        externalId: postId,
        externalUrl: postId ? `https://www.facebook.com/${postId}` : undefined,
      };
    }

    // Text-only post: use /{pageId}/feed endpoint
    const res = await fetchWithRetry(`${GRAPH_API}/${config.pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        access_token: config.accessToken,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: `Facebook API error: ${err.error?.message || res.statusText}`,
      };
    }

    const data = await res.json();
    const postId = data.id;
    return {
      success: true,
      externalId: postId,
      externalUrl: postId ? `https://www.facebook.com/${postId}` : undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown Facebook publishing error',
    };
  }
}
