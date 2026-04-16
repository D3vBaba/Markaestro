import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken, getMeta } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';

// LinkedIn's versioned API requires a LinkedIn-Version header in YYYYMM format.
// Monthly versions are supported for ~12 months. Bump this periodically.
const LINKEDIN_API_VERSION = '202604';
const LINKEDIN_REST = 'https://api.linkedin.com/rest';
const LINKEDIN_API_V2 = 'https://api.linkedin.com/v2';
const IMAGE_UPLOAD_POLL_INTERVAL_MS = 1500;
const IMAGE_UPLOAD_POLL_MAX_ATTEMPTS = 20;

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_API_VERSION,
  };
}

function getAuthorUrn(connection: PlatformConnection): string {
  return getMeta(connection, 'authorUrn', '');
}

function buildPostUrl(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
}

async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
  if (!res.ok) {
    throw new Error(`Media download failed (${res.status}) for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { bytes: buf, contentType };
}

async function initializeImageUpload(
  accessToken: string,
  authorUrn: string,
): Promise<{ uploadUrl: string; imageUrn: string }> {
  const res = await fetchWithRetry(`${LINKEDIN_REST}/images?action=initializeUpload`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `LinkedIn image init failed (${res.status}): ${err.message || err.error || res.statusText}`,
    );
  }

  const data = await res.json();
  const uploadUrl = data?.value?.uploadUrl;
  const imageUrn = data?.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new Error('LinkedIn image init response missing uploadUrl or image URN');
  }
  return { uploadUrl, imageUrn };
}

async function uploadImageBinary(uploadUrl: string, bytes: Buffer, contentType: string): Promise<void> {
  // LinkedIn's returned uploadUrl is a pre-signed URL that expects a raw binary PUT.
  // Auth headers are embedded in the URL; do NOT send Authorization here.
  const res = await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes as unknown as BodyInit,
  });

  if (!res.ok && res.status !== 201) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LinkedIn image upload failed (${res.status}): ${errText || res.statusText}`);
  }
}

async function waitForImageAvailable(accessToken: string, imageUrn: string): Promise<void> {
  // Poll GET /rest/images/{urn} until status is AVAILABLE. Newly uploaded images
  // briefly sit in PROCESSING — attaching them too early causes a post error.
  const encoded = encodeURIComponent(imageUrn);
  for (let i = 0; i < IMAGE_UPLOAD_POLL_MAX_ATTEMPTS; i++) {
    const res = await fetchWithRetry(`${LINKEDIN_REST}/images/${encoded}`, {
      headers: authHeaders(accessToken),
    }, { maxRetries: 1 });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const status = typeof data.status === 'string' ? data.status : '';
      if (status === 'AVAILABLE') return;
      if (status === 'FAILED' || status === 'DELETED') {
        throw new Error(`LinkedIn image processing ${status.toLowerCase()}`);
      }
    }
    await new Promise((r) => setTimeout(r, IMAGE_UPLOAD_POLL_INTERVAL_MS));
  }
  throw new Error('LinkedIn image processing timed out');
}

async function uploadImageForPost(
  accessToken: string,
  authorUrn: string,
  mediaUrl: string,
): Promise<string> {
  const { bytes, contentType } = await downloadBinary(mediaUrl);
  const { uploadUrl, imageUrn } = await initializeImageUpload(accessToken, authorUrn);
  await uploadImageBinary(uploadUrl, bytes, contentType);
  await waitForImageAvailable(accessToken, imageUrn);
  return imageUrn;
}

type LinkedInPostBody = {
  author: string;
  commentary: string;
  visibility: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN';
  distribution: {
    feedDistribution: 'MAIN_FEED' | 'NONE';
    targetEntities: unknown[];
    thirdPartyDistributionChannels: unknown[];
  };
  lifecycleState: 'PUBLISHED' | 'DRAFT';
  isReshareDisabledByAuthor: boolean;
  content?: {
    media?: { id: string; altText?: string; title?: string };
    multiImage?: { images: Array<{ id: string; altText?: string }> };
  };
};

async function createPost(accessToken: string, body: LinkedInPostBody): Promise<{ postUrn: string }> {
  const res = await fetchWithRetry(`${LINKEDIN_REST}/posts`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 201) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `LinkedIn post create failed (${res.status}): ${err.message || err.error || res.statusText}`,
    );
  }

  const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
  if (!postUrn) {
    throw new Error('LinkedIn post create succeeded but no x-restli-id header returned');
  }
  return { postUrn };
}

async function publishToLinkedIn(
  connection: PlatformConnection,
  content: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  const authorUrn = getAuthorUrn(connection);
  if (!authorUrn) {
    return {
      success: false,
      error: 'LinkedIn author not set. Reconnect LinkedIn from settings.',
    };
  }

  const accessToken = getAccessToken(connection);

  try {
    const body: LinkedInPostBody = {
      author: authorUrn,
      commentary: content,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (mediaUrls.length === 1) {
      const imageUrn = await uploadImageForPost(accessToken, authorUrn, mediaUrls[0]);
      body.content = { media: { id: imageUrn } };
    } else if (mediaUrls.length > 1) {
      // LinkedIn MultiImage supports up to 20 images per post.
      const limited = mediaUrls.slice(0, 20);
      const imageUrns = await Promise.all(
        limited.map((url) => uploadImageForPost(accessToken, authorUrn, url)),
      );
      body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
    }

    const { postUrn } = await createPost(accessToken, body);
    return {
      success: true,
      externalId: postUrn,
      externalUrl: buildPostUrl(postUrn),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown LinkedIn publishing error',
    };
  }
}

export const linkedinPublishingAdapter: PlatformAdapter = {
  id: 'linkedin-publishing',
  name: 'LinkedIn',
  channels: ['linkedin'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection: PlatformConnection, request: PublishRequest): Promise<PublishResult> {
    return publishToLinkedIn(connection, request.content, request.mediaUrls ?? []);
  },

  async testConnection(connection: PlatformConnection) {
    const accessToken = getAccessToken(connection);
    try {
      // /v2/userinfo is the OIDC-standard endpoint exposed by the Sign In with LinkedIn
      // using OpenID Connect product — it's the cheapest call that validates a token.
      const res = await fetchWithRetry(`${LINKEDIN_API_V2}/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, { maxRetries: 1 });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.message || err.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      const label = typeof data.name === 'string' && data.name
        ? data.name
        : getMeta(connection, 'displayName', 'LinkedIn');
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection test failed' };
    }
  },

  validateConnection(connection: PlatformConnection, _channel: SocialChannel): string | null {
    if (!getAuthorUrn(connection)) {
      return 'LinkedIn author not selected. Reconnect LinkedIn from settings.';
    }
    return null;
  },
};
