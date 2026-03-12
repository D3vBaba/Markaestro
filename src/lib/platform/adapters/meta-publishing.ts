import { fetchWithRetry } from '@/lib/fetch-retry';
import { decrypt } from '@/lib/crypto';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

const GRAPH_API = 'https://graph.facebook.com/v22.0';
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 15;

// ── Instagram helpers ───────────────────────────────────────────────

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

    if (data.status_code === 'FINISHED') return { ready: true };
    if (data.status_code === 'ERROR') {
      return { ready: false, error: data.status || 'Container processing failed' };
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
  }
  return { ready: false, error: 'Container processing timed out' };
}

async function getPermalink(mediaId: string, accessToken: string): Promise<string | undefined> {
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

// ── Resolve access token ────────────────────────────────────────────

function resolveAccessToken(connection: PlatformConnection): string {
  // Prefer page access token (set when user selects a page)
  const pageTokenEncrypted = connection.metadata.pageAccessTokenEncrypted as string | undefined;
  if (pageTokenEncrypted) {
    return decrypt(pageTokenEncrypted);
  }
  // Fall back to user access token
  return getAccessToken(connection);
}

// ── Facebook publish ────────────────────────────────────────────────

async function publishToFacebook(
  connection: PlatformConnection,
  content: string,
  mediaUrl?: string,
): Promise<PublishResult> {
  const pageId = getMeta(connection, 'pageId', '');
  if (!pageId) {
    return { success: false, error: 'No Facebook page selected. Go to Products > Integrations and select a Facebook page.' };
  }

  const accessToken = resolveAccessToken(connection);

  try {
    if (mediaUrl) {
      const res = await fetchWithRetry(`${GRAPH_API}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mediaUrl, message: content, access_token: accessToken }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: `Facebook photo error: ${err.error?.message || res.statusText}` };
      }

      const data = await res.json();
      const postId = data.post_id || data.id;
      return {
        success: true,
        externalId: postId,
        externalUrl: postId ? `https://www.facebook.com/${postId}` : undefined,
      };
    }

    // Text-only
    const res = await fetchWithRetry(`${GRAPH_API}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: `Facebook API error: ${err.error?.message || res.statusText}` };
    }

    const data = await res.json();
    const postId = data.id;
    return {
      success: true,
      externalId: postId,
      externalUrl: postId ? `https://www.facebook.com/${postId}` : undefined,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Facebook publishing error' };
  }
}

// ── Instagram publish ───────────────────────────────────────────────

async function publishToInstagram(
  connection: PlatformConnection,
  content: string,
  imageUrl?: string,
): Promise<PublishResult> {
  const igAccountId = getMeta(connection, 'igAccountId', '');
  if (!igAccountId) {
    return {
      success: false,
      error: 'No Instagram account linked. Select a Facebook page with a linked Instagram business account.',
    };
  }

  if (!imageUrl) {
    return { success: false, error: 'Instagram requires an image URL. Text-only posts are not supported.' };
  }

  const accessToken = resolveAccessToken(connection);

  try {
    // Step 1: Create container
    const containerRes = await fetchWithRetry(`${GRAPH_API}/${igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption: content, access_token: accessToken }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.json().catch(() => ({}));
      return { success: false, error: `Instagram container error: ${err.error?.message || containerRes.statusText}` };
    }

    const containerData = await containerRes.json();
    const containerId = containerData.id;
    if (!containerId) {
      return { success: false, error: 'Failed to create Instagram media container' };
    }

    // Step 2: Wait for processing
    const { ready, error: pollError } = await waitForContainer(containerId, accessToken);
    if (!ready) {
      return { success: false, error: `Instagram media processing failed: ${pollError}` };
    }

    // Step 3: Publish
    const publishRes = await fetchWithRetry(`${GRAPH_API}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json().catch(() => ({}));
      return { success: false, error: `Instagram publish error: ${err.error?.message || publishRes.statusText}` };
    }

    const publishData = await publishRes.json();
    const mediaId = publishData.id;
    const permalink = mediaId ? await getPermalink(mediaId, accessToken) : undefined;

    return { success: true, externalId: mediaId, externalUrl: permalink };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown Instagram publishing error' };
  }
}

// ── Adapter ─────────────────────────────────────────────────────────

export const metaPublishingAdapter: PlatformAdapter = {
  id: 'meta-publishing',
  name: 'Meta (Facebook & Instagram)',
  channels: ['facebook', 'instagram'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    if (request.channel === 'instagram') {
      return publishToInstagram(connection, request.content, request.mediaUrls?.[0]);
    }
    return publishToFacebook(connection, request.content, request.mediaUrls?.[0]);
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = resolveAccessToken(connection);
    try {
      const res = await fetchWithRetry(
        `${GRAPH_API}/me?fields=name,id`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.error?.message || `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, label: data.name || 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection: PlatformConnection, channel: SocialChannel): string | null {
    if (channel === 'facebook') {
      const pageId = getMeta(connection, 'pageId', '');
      if (!pageId) return 'No Facebook page selected';
    }
    if (channel === 'instagram') {
      const igAccountId = getMeta(connection, 'igAccountId', '');
      if (!igAccountId) return 'No Instagram business account linked';
    }
    return null;
  },
};
