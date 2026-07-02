import { fetchWithRetry } from '@/lib/fetch-retry';
import { getAccessToken } from '../base-adapter';
import { PlatformCapability } from '../types';
import type { PlatformAdapter, PlatformConnection, PublishRequest, PublishResult } from '../types';
import type { SocialChannel } from '@/lib/schemas';
import {
  LINKEDIN_API,
  LinkedInApiError,
  fetchLinkedInProfile,
  hasLinkedInScope,
  linkedinRestHeaders,
  matchLinkedInDestination,
  sanitizeLinkedInError,
  type LinkedInDestination,
} from '../linkedin-api';

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_MAX_ATTEMPTS = 60;
const MAX_LINKEDIN_IMAGES = 20;

type LinkedInPostContent =
  | { media: { id: string; title?: string; altText?: string } }
  | { multiImage: { images: Array<{ id: string; altText?: string }> } };

type LinkedInPostPayload = {
  author: string;
  commentary: string;
  visibility: 'PUBLIC';
  distribution: {
    feedDistribution: 'MAIN_FEED';
    targetEntities: [];
    thirdPartyDistributionChannels: [];
  };
  lifecycleState: 'PUBLISHED';
  isReshareDisabledByAuthor: false;
  content?: LinkedInPostContent;
};

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov|avi|webm|mkv)(\?|$)/.test(lower) || lower.includes('/videos/');
}

function requiredScope(destination: LinkedInDestination): string {
  return destination.type === 'page' ? 'w_organization_social' : 'w_member_social';
}

function validateScope(connection: PlatformConnection, destination: LinkedInDestination): string | null {
  const scope = requiredScope(destination);
  if (!hasLinkedInScope(connection, scope)) {
    return destination.type === 'page'
      ? 'LINKEDIN_PERMISSION_DENIED: LinkedIn Page publishing requires w_organization_social. Reconnect LinkedIn and grant Page posting permissions.'
      : 'LINKEDIN_PERMISSION_DENIED: LinkedIn profile publishing requires w_member_social. Reconnect LinkedIn and grant profile posting permissions.';
  }
  return null;
}

async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchWithRetry(url, {}, { maxRetries: 2 });
  if (!res.ok) throw new Error(`Media download failed (${res.status})`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function initializeImageUpload(
  accessToken: string,
  owner: string,
): Promise<{ uploadUrl: string; image: string }> {
  const res = await fetchWithRetry(`${LINKEDIN_API}/images?action=initializeUpload`, {
    method: 'POST',
    headers: linkedinRestHeaders(accessToken, 'application/json'),
    body: JSON.stringify({
      initializeUploadRequest: { owner },
    }),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  const value = data.value || {};
  if (!res.ok || !value.uploadUrl || !value.image) {
    throw new LinkedInApiError(res.status, data.message || data.error || 'LinkedIn image upload initialization failed');
  }
  return {
    uploadUrl: String(value.uploadUrl),
    image: String(value.image),
  };
}

async function uploadImage(
  accessToken: string,
  owner: string,
  url: string,
): Promise<string> {
  const [{ uploadUrl, image }, media] = await Promise.all([
    initializeImageUpload(accessToken, owner),
    downloadBinary(url),
  ]);
  const uploadRes = await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': media.contentType },
    body: new Uint8Array(media.bytes),
  }, { maxRetries: 2 });
  if (!uploadRes.ok && uploadRes.status !== 201) {
    const text = await uploadRes.text().catch(() => '');
    throw new LinkedInApiError(uploadRes.status, text || uploadRes.statusText || 'LinkedIn image upload failed');
  }
  return image;
}

type VideoUploadInstruction = {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
};

async function initializeVideoUpload(
  accessToken: string,
  owner: string,
  fileSizeBytes: number,
): Promise<{ video: string; uploadToken?: string; uploadInstructions: VideoUploadInstruction[] }> {
  const res = await fetchWithRetry(`${LINKEDIN_API}/videos?action=initializeUpload`, {
    method: 'POST',
    headers: linkedinRestHeaders(accessToken, 'application/json'),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  const value = data.value || {};
  const instructions = Array.isArray(value.uploadInstructions) ? value.uploadInstructions : [];
  if (!res.ok || !value.video || instructions.length === 0) {
    throw new LinkedInApiError(res.status, data.message || data.error || 'LinkedIn video upload initialization failed');
  }
  return {
    video: String(value.video),
    uploadToken: typeof value.uploadToken === 'string' && value.uploadToken ? value.uploadToken : undefined,
    uploadInstructions: instructions.map((item: Record<string, unknown>) => ({
      uploadUrl: String(item.uploadUrl || ''),
      firstByte: Number(item.firstByte || 0),
      lastByte: Number(item.lastByte || 0),
    })).filter((item: VideoUploadInstruction) => item.uploadUrl),
  };
}

async function uploadVideoParts(
  instructions: VideoUploadInstruction[],
  bytes: Buffer,
  contentType: string,
): Promise<string[]> {
  const uploadedPartIds: string[] = [];
  for (const instruction of instructions) {
    const start = Math.max(0, instruction.firstByte);
    const endExclusive = Math.min(bytes.length, Math.max(start, instruction.lastByte + 1));
    const chunk = bytes.subarray(start, endExclusive);
    if (chunk.length === 0) continue;
    const res = await fetchWithRetry(instruction.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(chunk),
    }, { maxRetries: 2 });
    if (!res.ok && res.status !== 201) {
      const text = await res.text().catch(() => '');
      throw new LinkedInApiError(res.status, text || res.statusText || 'LinkedIn video upload failed');
    }
    const etag = res.headers.get('etag')?.replace(/^"|"$/g, '');
    if (etag) uploadedPartIds.push(etag);
  }
  return uploadedPartIds;
}

async function finalizeVideoUpload(
  accessToken: string,
  video: string,
  uploadedPartIds: string[],
  uploadToken?: string,
): Promise<void> {
  const finalizeUploadRequest: Record<string, unknown> = { video };
  if (uploadToken) finalizeUploadRequest.uploadToken = uploadToken;
  if (uploadedPartIds.length > 0) finalizeUploadRequest.uploadedPartIds = uploadedPartIds;

  const res = await fetchWithRetry(`${LINKEDIN_API}/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: linkedinRestHeaders(accessToken, 'application/json'),
    body: JSON.stringify({ finalizeUploadRequest }),
  }, { maxRetries: 2 });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new LinkedInApiError(res.status, data.message || data.error || 'LinkedIn video finalize failed');
  }
}

async function waitForVideoReady(accessToken: string, video: string): Promise<void> {
  const encoded = encodeURIComponent(video);
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    const res = await fetchWithRetry(`${LINKEDIN_API}/videos/${encoded}`, {
      headers: linkedinRestHeaders(accessToken),
    }, { maxRetries: 1 });
    const data = await res.json().catch(() => ({}));
    const status = String(data.status || data.processingStatus || '').toUpperCase();
    if (!res.ok) {
      if (res.status === 404) {
        await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
        continue;
      }
      throw new LinkedInApiError(res.status, data.message || data.error || 'LinkedIn video status failed');
    }
    if (!status || status === 'AVAILABLE' || status === 'PROCESSING_SUCCEEDED') return;
    if (status.includes('FAILED')) throw new LinkedInApiError(422, 'LinkedIn video processing failed');
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
  }
  throw new LinkedInApiError(408, 'LinkedIn video processing timed out');
}

async function uploadVideo(
  accessToken: string,
  owner: string,
  url: string,
): Promise<string> {
  const media = await downloadBinary(url);
  const upload = await initializeVideoUpload(accessToken, owner, media.bytes.length);
  const uploadedPartIds = await uploadVideoParts(upload.uploadInstructions, media.bytes, media.contentType);
  await finalizeVideoUpload(accessToken, upload.video, uploadedPartIds, upload.uploadToken);
  await waitForVideoReady(accessToken, upload.video);
  return upload.video;
}

function buildBasePostPayload(author: string, content: string): LinkedInPostPayload {
  return {
    author,
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
}

async function createLinkedInPost(
  accessToken: string,
  payload: LinkedInPostPayload,
): Promise<{ id: string; url: string }> {
  const res = await fetchWithRetry(`${LINKEDIN_API}/posts`, {
    method: 'POST',
    headers: linkedinRestHeaders(accessToken, 'application/json'),
    body: JSON.stringify(payload),
  }, { maxRetries: 2 });
  const data = await res.json().catch(() => ({}));
  const id = res.headers.get('x-restli-id') || data.id || data.value?.id;
  if (!res.ok || !id) {
    throw new LinkedInApiError(res.status, data.message || data.error || res.statusText || 'LinkedIn post create failed');
  }
  const postId = String(id);
  return {
    id: postId,
    url: `https://www.linkedin.com/feed/update/${postId}/`,
  };
}

async function publishToLinkedIn(
  connection: PlatformConnection,
  request: PublishRequest,
): Promise<PublishResult> {
  const destination = matchLinkedInDestination(connection, request.destinationId);
  if (!destination) {
    return { success: false, error: 'Select a LinkedIn Profile or Page before publishing.' };
  }

  const scopeError = validateScope(connection, destination);
  if (scopeError) return { success: false, error: scopeError };

  const content = request.content.trim();
  if (!content) {
    return { success: false, error: 'LinkedIn posts require text content.' };
  }

  const mediaUrls = request.mediaUrls ?? [];
  if (mediaUrls.length > MAX_LINKEDIN_IMAGES) {
    return { success: false, error: `LinkedIn supports up to ${MAX_LINKEDIN_IMAGES} images in one post.` };
  }

  const videoUrls = mediaUrls.filter(isVideoUrl);
  const imageUrls = mediaUrls.filter((url) => !isVideoUrl(url));
  if (videoUrls.length > 1 || (videoUrls.length === 1 && imageUrls.length > 0)) {
    return { success: false, error: 'LinkedIn video posts must contain exactly one video and no additional images.' };
  }

  const accessToken = getAccessToken(connection);
  const payload = buildBasePostPayload(destination.urn, content);

  try {
    if (videoUrls.length === 1) {
      const video = await uploadVideo(accessToken, destination.urn, videoUrls[0]);
      payload.content = { media: { id: video } };
    } else if (imageUrls.length === 1) {
      const image = await uploadImage(accessToken, destination.urn, imageUrls[0]);
      payload.content = { media: { id: image } };
    } else if (imageUrls.length > 1) {
      const images = await Promise.all(
        imageUrls.slice(0, MAX_LINKEDIN_IMAGES).map((url) => uploadImage(accessToken, destination.urn, url)),
      );
      payload.content = {
        multiImage: {
          images: images.map((id) => ({ id })),
        },
      };
    }

    const post = await createLinkedInPost(accessToken, payload);
    return { success: true, externalId: post.id, externalUrl: post.url };
  } catch (error) {
    if (error instanceof LinkedInApiError && error.status === 401) {
      return { success: false, error: `LINKEDIN_AUTH_REVOKED: ${error.message}` };
    }
    if (error instanceof LinkedInApiError && error.status === 403) {
      return { success: false, error: `LINKEDIN_PERMISSION_DENIED: ${error.message}` };
    }
    return { success: false, error: sanitizeLinkedInError(error) };
  }
}

export const linkedinPublishingAdapter: PlatformAdapter = {
  id: 'linkedin-publishing',
  name: 'LinkedIn',
  channels: ['linkedin'],
  capabilities: [
    PlatformCapability.PUBLISH_TEXT,
    PlatformCapability.PUBLISH_IMAGE,
    PlatformCapability.PUBLISH_VIDEO,
    PlatformCapability.PUBLISH_CAROUSEL,
  ],

  async publish(connection, request: PublishRequest): Promise<PublishResult> {
    return publishToLinkedIn(connection, request);
  },

  async testConnection(connection) {
    const accessToken = getAccessToken(connection);
    try {
      const profile = await fetchLinkedInProfile(accessToken);
      return { ok: true, label: profile.name };
    } catch (error) {
      return { ok: false, error: sanitizeLinkedInError(error) };
    }
  },

  validateConnection(connection, _channel: SocialChannel): string | null {
    void _channel;
    const destination = matchLinkedInDestination(connection);
    if (!destination) {
      return 'Select a LinkedIn Profile or Page in product settings.';
    }
    return validateScope(connection, destination);
  },
};
