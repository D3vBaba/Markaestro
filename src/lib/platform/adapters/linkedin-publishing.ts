import { fetchWithRetry } from '@/lib/fetch-retry';
import { emptyMetrics, getAccessToken, metricNum } from '../base-adapter';
import { PlatformCapability } from '../types';
import type {
  AudienceFetchResult,
  DeletePostInput,
  DeletePostResult,
  ListPostsInput,
  ListPostsResult,
  MetricsFetchInput,
  MetricsFetchResult,
  PlatformAdapter,
  PlatformConnection,
  PlatformPostSummary,
  PublishRequest,
  PublishResult,
} from '../types';
import type { SocialChannel } from '@/lib/schemas';
import {
  LINKEDIN_API,
  LinkedInApiError,
  fetchLinkedInProfile,
  getSelectedLinkedInDestination,
  hasLinkedInScope,
  linkedinErrorMessage,
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
    throw new LinkedInApiError(res.status, linkedinErrorMessage(data, 'LinkedIn image upload initialization failed').message);
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
): Promise<{ video: string; uploadToken: string; uploadInstructions: VideoUploadInstruction[] }> {
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
    throw new LinkedInApiError(res.status, linkedinErrorMessage(data, 'LinkedIn video upload initialization failed').message);
  }
  return {
    video: String(value.video),
    // LinkedIn returns an empty uploadToken for single-part uploads, and
    // finalizeUpload rejects the whole request when the field is absent — so
    // echo it back verbatim, empty string included.
    uploadToken: typeof value.uploadToken === 'string' ? value.uploadToken : '',
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

/**
 * All three fields are required by the API, so they are always sent — a
 * missing one fails the call with a generic "Invalid param" rather than
 * anything that points at the omission.
 */
async function finalizeVideoUpload(
  accessToken: string,
  video: string,
  uploadedPartIds: string[],
  uploadToken: string,
): Promise<void> {
  const res = await fetchWithRetry(`${LINKEDIN_API}/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: linkedinRestHeaders(accessToken, 'application/json'),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds } }),
  }, { maxRetries: 2 });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new LinkedInApiError(res.status, linkedinErrorMessage(data, 'LinkedIn video finalize failed').message);
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
      throw new LinkedInApiError(res.status, linkedinErrorMessage(data, 'LinkedIn video status failed').message);
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
    throw new LinkedInApiError(res.status, linkedinErrorMessage(data, res.statusText || 'LinkedIn post create failed').message);
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

// ── Metrics ─────────────────────────────────────────────────────────

function classifyLinkedInError(error: unknown): 'auth' | 'not_found' | 'unsupported' | 'transient' {
  if (error instanceof LinkedInApiError) {
    if (error.status === 401) return 'auth';
    if (error.status === 403) return 'unsupported';
    if (error.status === 404) return 'not_found';
  }
  return 'transient';
}

async function linkedinGet(accessToken: string, path: string): Promise<unknown> {
  const res = await fetchWithRetry(`${LINKEDIN_API}${path}`, {
    headers: linkedinRestHeaders(accessToken),
  }, { maxRetries: 1 });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = (data ?? {}) as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : res.statusText;
    throw new LinkedInApiError(res.status, message || 'LinkedIn API error');
  }
  return data;
}

/**
 * Fresh like/comment counts, available for both member and organization
 * posts — the fallback when the richer statistics endpoints are not
 * accessible with the connection's scopes.
 */
async function fetchSocialActionCounts(
  accessToken: string,
  postUrn: string,
): Promise<{ likes: number | null; comments: number | null }> {
  const data = await linkedinGet(accessToken, `/socialActions/${encodeURIComponent(postUrn)}`) as {
    likesSummary?: { totalLikes?: unknown; aggregatedTotalLikes?: unknown };
    commentsSummary?: { totalFirstLevelComments?: unknown; aggregatedTotalComments?: unknown };
  };
  return {
    likes: metricNum(data.likesSummary?.aggregatedTotalLikes ?? data.likesSummary?.totalLikes),
    comments: metricNum(data.commentsSummary?.aggregatedTotalComments ?? data.commentsSummary?.totalFirstLevelComments),
  };
}

/** Lifetime organic stats for a single organization post (admin scope required). */
async function fetchOrganizationPostMetrics(
  accessToken: string,
  destination: LinkedInDestination,
  postUrn: string,
): Promise<MetricsFetchResult> {
  const param = postUrn.includes(':ugcPost:') ? 'ugcPosts' : 'shares';
  const path = `/organizationalEntityShareStatistics?q=organizationalEntity` +
    `&organizationalEntity=${encodeURIComponent(destination.urn)}` +
    `&${param}=List(${encodeURIComponent(postUrn)})`;

  try {
    const data = await linkedinGet(accessToken, path) as {
      elements?: Array<{ totalShareStatistics?: Record<string, unknown> }>;
    };
    const stats = data.elements?.[0]?.totalShareStatistics;
    if (!stats) {
      // An absent element can mean zero activity, but also stats that simply
      // haven't populated yet — don't fabricate zeros. Fall back to the
      // always-fresh like/comment counts and leave the rest null.
      const counts = await fetchSocialActionCounts(accessToken, postUrn);
      const metrics = emptyMetrics();
      metrics.likes = counts.likes;
      metrics.comments = counts.comments;
      return { ok: true, metrics };
    }
    // The element exists, so unreported fields within it are real zeros.
    const metrics = emptyMetrics();
    metrics.views = metricNum(stats.impressionCount) ?? 0;
    metrics.reach = metricNum(stats.uniqueImpressionsCount) ?? 0;
    metrics.clicks = metricNum(stats.clickCount) ?? 0;
    metrics.likes = metricNum(stats.likeCount) ?? 0;
    metrics.comments = metricNum(stats.commentCount) ?? 0;
    metrics.shares = metricNum(stats.shareCount) ?? 0;
    for (const [key, value] of Object.entries(stats)) {
      const num = metricNum(value);
      if (num !== null) metrics.raw[key] = num;
    }
    return { ok: true, metrics };
  } catch (error) {
    const reason = classifyLinkedInError(error);
    if (reason !== 'unsupported') {
      return { ok: false, error: sanitizeLinkedInError(error), reason };
    }
    // No rw_organization_admin — fall back to public like/comment counts.
    try {
      const counts = await fetchSocialActionCounts(accessToken, postUrn);
      const metrics = emptyMetrics();
      metrics.likes = counts.likes;
      metrics.comments = counts.comments;
      return { ok: true, metrics };
    } catch (fallbackError) {
      return { ok: false, error: sanitizeLinkedInError(fallbackError), reason: classifyLinkedInError(fallbackError) };
    }
  }
}

/**
 * Member (profile) post analytics via memberCreatorPostAnalytics — needs the
 * r_member_postAnalytics scope; falls back to socialActions counts, and only
 * reports unsupported when neither surface is available.
 */
async function fetchMemberPostMetrics(
  accessToken: string,
  postUrn: string,
): Promise<MetricsFetchResult> {
  const entityKey = postUrn.includes(':ugcPost:') ? 'ugc' : 'share';
  const metrics = emptyMetrics();
  let gotAnalytics = false;

  try {
    const data = await linkedinGet(
      accessToken,
      `/memberCreatorPostAnalytics?q=entity&entity=(${entityKey}:${encodeURIComponent(postUrn)})&aggregation=TOTAL`,
    ) as { elements?: Array<{ metricType?: { creatorPostAnalyticsMetricType?: string } | string; count?: unknown }> };
    for (const el of data.elements ?? []) {
      const type = typeof el.metricType === 'string'
        ? el.metricType
        : el.metricType?.creatorPostAnalyticsMetricType;
      const count = metricNum(el.count);
      if (!type || count === null) continue;
      metrics.raw[type] = count;
      if (type === 'IMPRESSION') metrics.views = count;
      if (type === 'MEMBERS_REACHED') metrics.reach = count;
      if (type === 'REACTION') metrics.likes = count;
      if (type === 'COMMENT') metrics.comments = count;
      if (type === 'RESHARE') metrics.shares = count;
      if (type === 'POST_SAVE') metrics.saves = count;
      if (type === 'LINK_CLICKS') metrics.clicks = count;
      gotAnalytics = true;
    }
  } catch (error) {
    const reason = classifyLinkedInError(error);
    if (reason === 'auth' || reason === 'not_found') {
      return { ok: false, error: sanitizeLinkedInError(error), reason };
    }
  }

  if (!gotAnalytics) {
    try {
      const counts = await fetchSocialActionCounts(accessToken, postUrn);
      metrics.likes = counts.likes;
      metrics.comments = counts.comments;
    } catch (fallbackError) {
      return { ok: false, error: sanitizeLinkedInError(fallbackError), reason: classifyLinkedInError(fallbackError) };
    }
  }
  return { ok: true, metrics };
}

async function fetchLinkedInMetrics(
  connection: PlatformConnection,
  input: MetricsFetchInput,
): Promise<MetricsFetchResult> {
  const destination = matchLinkedInDestination(connection, input.destinationId);
  if (!destination) {
    return { ok: false, error: 'No LinkedIn destination stored for this post', reason: 'unsupported' };
  }
  const accessToken = getAccessToken(connection);
  if (destination.type === 'page') {
    return fetchOrganizationPostMetrics(accessToken, destination, input.externalId);
  }
  return fetchMemberPostMetrics(accessToken, input.externalId);
}

async function fetchLinkedInAudience(connection: PlatformConnection): Promise<AudienceFetchResult> {
  const destination = getSelectedLinkedInDestination(connection);
  if (!destination) return { ok: false, error: 'No LinkedIn destination selected', reason: 'unsupported' };
  const accessToken = getAccessToken(connection);

  try {
    if (destination.type === 'page') {
      const data = await linkedinGet(
        accessToken,
        `/networkSizes/${encodeURIComponent(destination.urn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      ) as { firstDegreeSize?: unknown };
      const followers = metricNum(data.firstDegreeSize);
      if (followers === null) return { ok: false, error: 'firstDegreeSize not returned', reason: 'unsupported' };
      return { ok: true, followers };
    }
    const data = await linkedinGet(accessToken, `/memberFollowersCount?q=me`) as {
      elements?: Array<{ followersCount?: unknown }>;
      followersCount?: unknown;
    };
    const followers = metricNum(data.elements?.[0]?.followersCount ?? data.followersCount);
    if (followers === null) {
      return { ok: false, error: 'followersCount not returned (r_member_profileAnalytics scope missing?)', reason: 'unsupported' };
    }
    return { ok: true, followers };
  } catch (error) {
    return { ok: false, error: sanitizeLinkedInError(error), reason: classifyLinkedInError(error) };
  }
}

// ── Platform post management (list / delete) ───────────────────────

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;

function mapLinkedInContent(content: unknown): PlatformPostSummary['mediaType'] {
  if (!content || typeof content !== 'object') return 'text';
  const record = content as Record<string, unknown>;
  if (record.multiImage) return 'carousel';
  const media = record.media as Record<string, unknown> | undefined;
  if (media && typeof media.id === 'string') {
    if (media.id.includes(':video:')) return 'video';
    if (media.id.includes(':image:')) return 'image';
    return 'unknown';
  }
  if (record.article) return 'unknown';
  return 'text';
}

/**
 * List posts authored by the selected destination via the versioned Posts
 * API author finder. Organization listing needs r_organization_admin /
 * Community Management access; member listing is gated by LinkedIn and may
 * come back 403 — classified as unsupported with the API's message.
 */
async function listLinkedInPosts(
  connection: PlatformConnection,
  input: ListPostsInput,
): Promise<ListPostsResult> {
  const destination = matchLinkedInDestination(connection, input.destinationId);
  if (!destination) {
    return { ok: false, error: 'Select a LinkedIn Profile or Page in brand settings.', reason: 'unsupported' };
  }
  const accessToken = getAccessToken(connection);
  const count = Math.min(Math.max(1, Math.floor(input.limit || DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT);
  const start = input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;

  try {
    const data = await linkedinGet(
      accessToken,
      `/posts?author=${encodeURIComponent(destination.urn)}&q=author&count=${count}&start=${start}&sortBy=LAST_MODIFIED`,
    ) as { elements?: Array<Record<string, unknown>>; paging?: { total?: number } };

    const elements = Array.isArray(data.elements) ? data.elements : [];
    const posts: PlatformPostSummary[] = elements
      .filter((el) => typeof el.id === 'string' && el.id)
      .map((el) => {
        const publishedAtMs = metricNum(el.publishedAt ?? el.createdAt);
        return {
          externalId: String(el.id),
          channel: 'linkedin' as const,
          content: typeof el.commentary === 'string' ? el.commentary : null,
          mediaType: mapLinkedInContent(el.content),
          mediaUrl: null,
          thumbnailUrl: null,
          permalink: `https://www.linkedin.com/feed/update/${el.id}/`,
          publishedAt: publishedAtMs !== null ? new Date(publishedAtMs).toISOString() : null,
          canDelete: true,
        };
      });

    const total = metricNum(data.paging?.total);
    const nextStart = start + elements.length;
    const hasMore = elements.length === count && (total === null || nextStart < total);
    return { ok: true, posts, nextCursor: hasMore ? String(nextStart) : undefined };
  } catch (error) {
    const reason = classifyLinkedInError(error);
    return {
      ok: false,
      error: sanitizeLinkedInError(error),
      reason: reason === 'not_found' ? 'unsupported' : reason,
    };
  }
}

async function deleteLinkedInPost(
  connection: PlatformConnection,
  input: DeletePostInput,
): Promise<DeletePostResult> {
  const destination = matchLinkedInDestination(connection, input.destinationId);
  if (destination) {
    const scopeError = validateScope(connection, destination);
    if (scopeError) return { ok: false, error: scopeError, reason: 'unsupported' };
  }
  const accessToken = getAccessToken(connection);
  const res = await fetchWithRetry(`${LINKEDIN_API}/posts/${encodeURIComponent(input.externalId)}`, {
    method: 'DELETE',
    headers: linkedinRestHeaders(accessToken),
  }, { maxRetries: 1 });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof data.message === 'string' ? data.message : res.statusText;
    const error = new LinkedInApiError(res.status, message || 'LinkedIn post delete failed');
    return { ok: false, error: sanitizeLinkedInError(error), reason: classifyLinkedInError(error) };
  }
  return { ok: true };
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

  async fetchMetrics(connection, input: MetricsFetchInput): Promise<MetricsFetchResult> {
    try {
      return await fetchLinkedInMetrics(connection, input);
    } catch (e) {
      return { ok: false, error: sanitizeLinkedInError(e), reason: classifyLinkedInError(e) };
    }
  },

  async fetchAudience(connection): Promise<AudienceFetchResult> {
    try {
      return await fetchLinkedInAudience(connection);
    } catch (e) {
      return { ok: false, error: sanitizeLinkedInError(e), reason: classifyLinkedInError(e) };
    }
  },

  async listPosts(connection, input: ListPostsInput): Promise<ListPostsResult> {
    try {
      return await listLinkedInPosts(connection, input);
    } catch (e) {
      const reason = classifyLinkedInError(e);
      return {
        ok: false,
        error: sanitizeLinkedInError(e),
        reason: reason === 'not_found' ? 'unsupported' : reason,
      };
    }
  },

  async deletePost(connection, input: DeletePostInput): Promise<DeletePostResult> {
    try {
      return await deleteLinkedInPost(connection, input);
    } catch (e) {
      return { ok: false, error: sanitizeLinkedInError(e), reason: classifyLinkedInError(e) };
    }
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
      return 'Select a LinkedIn Profile or Page in brand settings.';
    }
    return validateScope(connection, destination);
  },
};
