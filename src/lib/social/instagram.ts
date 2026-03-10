import type { InstagramConfig, PublishResult } from './types';
import { fetchWithRetry } from '@/lib/fetch-retry';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 15; // 30 seconds max wait

/**
 * Poll a media container until it reaches FINISHED status.
 * Instagram containers take time to process — publishing before
 * the container is ready will fail silently.
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
): Promise<{ ready: boolean; error?: string }> {
  for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
    const res = await fetchWithRetry(
      `${GRAPH_API}/${containerId}?fields=status_code,status`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { maxRetries: 1 },
    );
    const data = await res.json();

    if (data.status_code === 'FINISHED') {
      return { ready: true };
    }
    if (data.status_code === 'ERROR') {
      return { ready: false, error: data.status || 'Container processing failed' };
    }
    // IN_PROGRESS — wait and retry
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
  }
  return { ready: false, error: 'Container processing timed out' };
}

/**
 * Fetch the permalink for an Instagram media post.
 * The Graph API media ID is not the same as the shortcode used in URLs.
 */
async function getPermalink(
  mediaId: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const res = await fetchWithRetry(
      `${GRAPH_API}/${mediaId}?fields=permalink`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    return data.permalink || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Instagram publishing via Meta Graph API.
 * Two-step process: create media container → wait for processing → publish.
 */
export async function publishToInstagram(
  config: InstagramConfig,
  content: string,
  imageUrl?: string,
): Promise<PublishResult> {
  if (!config.igAccountId) {
    return { success: false, error: 'Instagram Business Account ID is not configured. Select a Facebook page with a linked Instagram account.' };
  }

  if (!imageUrl) {
    return { success: false, error: 'Instagram requires an image URL to publish. Text-only posts are not supported.' };
  }

  try {
    // Step 1: Create media container
    const containerRes = await fetchWithRetry(`${GRAPH_API}/${config.igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: content,
        access_token: config.accessToken,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.json().catch(() => ({}));
      return {
        success: false,
        error: `Instagram container error: ${err.error?.message || containerRes.statusText}`,
      };
    }

    const containerData = await containerRes.json();
    const containerId = containerData.id;
    if (!containerId) {
      return { success: false, error: 'Failed to create Instagram media container — no ID returned' };
    }

    // Step 2: Wait for container to finish processing
    const { ready, error: pollError } = await waitForContainer(containerId, config.accessToken);
    if (!ready) {
      return { success: false, error: `Instagram media processing failed: ${pollError}` };
    }

    // Step 3: Publish the container
    const publishRes = await fetchWithRetry(`${GRAPH_API}/${config.igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: config.accessToken,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json().catch(() => ({}));
      return {
        success: false,
        error: `Instagram publish error: ${err.error?.message || publishRes.statusText}`,
      };
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;

    // Fetch the actual permalink (mediaId != shortcode)
    const permalink = mediaId ? await getPermalink(mediaId, config.accessToken) : undefined;

    return {
      success: true,
      externalId: mediaId,
      externalUrl: permalink,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown Instagram publishing error',
    };
  }
}
