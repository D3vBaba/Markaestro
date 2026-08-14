import { fetchWithRetry } from '@/lib/fetch-retry';
import type { TikTokSettings } from '@/lib/public-api/post-settings';
import {
  TIKTOK_API,
  buildTikTokMediaProxyUrl,
  downloadVideoForTikTokUpload,
  getTikTokFileUploadPlan,
  parseTikTokError,
  uploadTikTokVideoBytes,
} from './tiktok-media';

/**
 * TikTok Direct Post.
 *
 * Separate from the inbox hand-off in `tiktok-publishing.ts` on purpose: this
 * path publishes straight to the creator's profile and is only reachable when
 * the post explicitly carries `settings.postMode === 'direct_post'`. Posts
 * without TikTok settings keep the inbox behavior untouched.
 *
 * Direct Post is gated on TikTok's Content Posting API audit. Until the audit
 * passes, TikTok forces every post from an unaudited client to SELF_ONLY
 * regardless of what we send — that is TikTok's enforcement, not ours, and it
 * needs no special handling here.
 *
 * The UX requirements TikTok audits against (creator_info-driven controls, no
 * default privacy level, unchecked interaction toggles, commercial disclosure,
 * consent text) live in the composer UI. Everything this module enforces is
 * the server-side half of those same rules, so an API caller cannot bypass
 * what the UI requires.
 *
 * @see https://developers.tiktok.com/doc/content-sharing-guidelines
 */

export type TikTokCreatorInfo = {
  creatorAvatarUrl: string | null;
  creatorUsername: string | null;
  creatorNickname: string | null;
  /** Privacy levels this account may post with, in TikTok's own order. */
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

export type TikTokCreatorInfoFailureReason = 'auth' | 'rate_limited' | 'unsupported' | 'transient';

export type TikTokCreatorInfoResult =
  | { ok: true; info: TikTokCreatorInfo }
  | { ok: false; error: string; reason: TikTokCreatorInfoFailureReason };

function classifyCreatorInfoError(status: number, code: string): TikTokCreatorInfoFailureReason {
  if (status === 401 || code === 'access_token_invalid' || code === 'token_expired') return 'auth';
  if (status === 429 || code === 'rate_limit_exceeded') return 'rate_limited';
  if (code === 'scope_not_authorized' || code === 'scope_permission_missed') return 'unsupported';
  return 'transient';
}

/**
 * Query the creator's current posting capabilities. TikTok requires this
 * immediately before rendering the post form — the returned privacy options
 * and interaction flags are what the UI must offer, and a `spam_risk_*` error
 * here means the creator has hit a posting limit and we must stop.
 *
 * Rate limit: 20 requests per minute per access token.
 */
export async function queryTikTokCreatorInfo(accessToken: string): Promise<TikTokCreatorInfoResult> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${TIKTOK_API}/post/publish/creator_info/query/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
      { maxRetries: 1 },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'TikTok creator info request failed',
      reason: 'transient',
    };
  }

  const data = await res.json().catch(() => ({}));
  const error = parseTikTokError(data);
  if (error || !res.ok) {
    const code = (data.error?.code as string | undefined) || '';
    return {
      ok: false,
      error: error || `TikTok creator info failed (HTTP ${res.status})`,
      reason: classifyCreatorInfoError(res.status, code),
    };
  }

  const info = (data.data ?? {}) as Record<string, unknown>;
  const privacyLevelOptions = Array.isArray(info.privacy_level_options)
    ? info.privacy_level_options.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];

  if (privacyLevelOptions.length === 0) {
    // Without options there is nothing valid for the creator to select, and
    // TikTok rejects any privacy_level we might guess at.
    return {
      ok: false,
      error: 'TikTok returned no available privacy levels for this account',
      reason: 'unsupported',
    };
  }

  return {
    ok: true,
    info: {
      creatorAvatarUrl: typeof info.creator_avatar_url === 'string' ? info.creator_avatar_url : null,
      creatorUsername: typeof info.creator_username === 'string' ? info.creator_username : null,
      creatorNickname: typeof info.creator_nickname === 'string' ? info.creator_nickname : null,
      privacyLevelOptions,
      commentDisabled: info.comment_disabled === true,
      duetDisabled: info.duet_disabled === true,
      stitchDisabled: info.stitch_disabled === true,
      maxVideoPostDurationSec: typeof info.max_video_post_duration_sec === 'number'
        ? info.max_video_post_duration_sec
        : null,
    },
  };
}

/**
 * Server-side mirror of the compliance rules the composer enforces. Returns
 * an error string when the settings are not publishable, or null when they
 * are. Runs against live creator_info so a stale client cannot submit a
 * privacy level the account no longer offers.
 */
export function validateTikTokDirectPostSettings(
  settings: TikTokSettings | undefined,
  info: TikTokCreatorInfo,
): string | null {
  if (!settings?.privacyLevel) {
    // TikTok requires an explicit selection — there is no compliant default.
    return 'TikTok Direct Post requires a privacy level. Select one before posting.';
  }

  if (!info.privacyLevelOptions.includes(settings.privacyLevel)) {
    return `TikTok does not allow "${settings.privacyLevel}" for this account. Available: ${info.privacyLevelOptions.join(', ')}.`;
  }

  const brandOrganic = settings.brandOrganicToggle === true;
  const brandedContent = settings.brandContentToggle === true;

  if (settings.commercialContentDisclosure === true && !brandOrganic && !brandedContent) {
    return 'You need to indicate if your content promotes yourself, a third party, or both.';
  }

  if ((brandOrganic || brandedContent) && settings.commercialContentDisclosure !== true) {
    return 'Commercial content disclosure must be enabled to label content as promotional or a paid partnership.';
  }

  if (brandedContent && settings.privacyLevel === 'SELF_ONLY') {
    return 'Branded content visibility cannot be set to private.';
  }

  if (settings.disableComment === false && info.commentDisabled) {
    return 'This TikTok account has comments turned off, so comments cannot be enabled for this post.';
  }

  if (settings.disableDuet === false && info.duetDisabled) {
    return 'This TikTok account has Duet turned off, so Duet cannot be enabled for this post.';
  }

  if (settings.disableStitch === false && info.stitchDisabled) {
    return 'This TikTok account has Stitch turned off, so Stitch cannot be enabled for this post.';
  }

  return null;
}

/**
 * Build the `post_info` block shared by the video and photo Direct Post
 * endpoints. Interaction toggles are sent as TikTok's `disable_*` inverse of
 * what the creator checked; anything the creator left unchecked stays
 * disabled, matching the "nothing pre-enabled" requirement.
 */
function buildDirectPostInfo(
  title: string,
  settings: TikTokSettings,
  info: TikTokCreatorInfo,
): Record<string, unknown> {
  return {
    title,
    privacy_level: settings.privacyLevel,
    // An account-level restriction always wins over the post-level choice.
    disable_comment: info.commentDisabled || settings.disableComment !== false,
    brand_content_toggle: settings.brandContentToggle === true,
    brand_organic_toggle: settings.brandOrganicToggle === true,
  };
}

export type TikTokDirectPostResult = { publishId: string } | { error: string };

async function directPostVideo(
  accessToken: string,
  mediaUrl: string,
  title: string,
  settings: TikTokSettings,
  info: TikTokCreatorInfo,
): Promise<TikTokDirectPostResult> {
  // Same reasoning as the inbox flow: FILE_UPLOAD rather than PULL_FROM_URL so
  // the video passes through our transcode and TikTok's frame-rate check.
  const video = await downloadVideoForTikTokUpload(mediaUrl);
  if ('error' in video) return { error: video.error };

  const plan = getTikTokFileUploadPlan(video.buffer.byteLength);
  const initRes = await fetchWithRetry(`${TIKTOK_API}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        ...buildDirectPostInfo(title, settings, info),
        disable_duet: info.duetDisabled || settings.disableDuet !== false,
        disable_stitch: info.stitchDisabled || settings.disableStitch !== false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: video.buffer.byteLength,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    }),
  });

  const initData = await initRes.json().catch(() => ({}));
  const initError = parseTikTokError(initData);
  if (initError) return { error: initError };

  const publishId = initData.data?.publish_id as string | undefined;
  const uploadUrl = initData.data?.upload_url as string | undefined;
  if (!publishId || !uploadUrl) {
    return { error: 'TikTok did not return a Direct Post upload URL' };
  }

  const upload = await uploadTikTokVideoBytes(
    uploadUrl,
    video.buffer,
    video.contentType,
    plan.chunkSize,
    plan.totalChunkCount,
  );
  if ('error' in upload) return { error: upload.error };

  return { publishId };
}

async function directPostPhotos(
  accessToken: string,
  imageUrls: string[],
  content: string,
  photoCoverIndex: number,
  settings: TikTokSettings,
  info: TikTokCreatorInfo,
): Promise<TikTokDirectPostResult> {
  // PULL_FROM_URL requires a verified domain, so Firebase URLs are served
  // through our own proxy route — identical to the inbox photo path.
  const proxyUrls = imageUrls.map((url) => buildTikTokMediaProxyUrl(url, 'image'));

  const res = await fetchWithRetry(`${TIKTOK_API}/post/publish/content/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        // Duet and Stitch do not apply to photo posts, so they are omitted
        // rather than sent as `true` — TikTok rejects unknown combinations.
        ...buildDirectPostInfo(content.substring(0, 90), settings, info),
        description: content.substring(0, 4000),
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: photoCoverIndex,
        photo_images: proxyUrls,
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  });

  const data = await res.json().catch(() => ({}));
  const error = parseTikTokError(data);
  if (error) return { error };

  const publishId = data.data?.publish_id as string | undefined;
  if (!publishId) return { error: 'TikTok did not return a publish ID' };

  return { publishId };
}

/**
 * Publish via Direct Post. Re-queries creator_info first so the privacy level
 * and interaction toggles are validated against the account's live state at
 * publish time — a scheduled post may sit for days between composition and
 * publication, and the creator can change their account settings in between.
 */
export async function publishTikTokDirectPost(input: {
  accessToken: string;
  content: string;
  videoUrls: string[];
  imageUrls: string[];
  photoCoverIndex: number;
  settings: TikTokSettings;
}): Promise<TikTokDirectPostResult> {
  const creatorInfo = await queryTikTokCreatorInfo(input.accessToken);
  if (!creatorInfo.ok) {
    return { error: `TikTok creator info unavailable: ${creatorInfo.error}` };
  }

  const validationError = validateTikTokDirectPostSettings(input.settings, creatorInfo.info);
  if (validationError) return { error: validationError };

  if (input.videoUrls.length === 1) {
    return directPostVideo(
      input.accessToken,
      input.videoUrls[0],
      input.content.substring(0, 2200),
      input.settings,
      creatorInfo.info,
    );
  }

  return directPostPhotos(
    input.accessToken,
    input.imageUrls,
    input.content,
    input.photoCoverIndex,
    input.settings,
    creatorInfo.info,
  );
}
