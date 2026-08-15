import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnection, PublishRequest } from '../platform/types';
import type { TikTokCreatorInfo } from '../platform/adapters/tiktok-direct-post';

const fetchWithRetry = vi.fn();

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: (...args: unknown[]) => fetchWithRetry(...args),
}));

vi.mock('@/lib/platform/base-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/base-adapter')>();
  return { ...actual, getAccessToken: () => 'test-token' };
});

vi.mock('@/lib/media/tiktok-transcode', () => ({
  transcodeForTikTok: async (buffer: Buffer) => buffer,
}));

const connection = { provider: 'tiktok' } as unknown as PlatformConnection;

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

const CREATOR_INFO_OK = {
  data: {
    creator_avatar_url: 'https://cdn.example/avatar.jpg',
    creator_username: 'markaestro',
    creator_nickname: 'Markaestro',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
  },
};

function creatorInfoFixture(overrides: Partial<TikTokCreatorInfo> = {}): TikTokCreatorInfo {
  return {
    creatorAvatarUrl: 'https://cdn.example/avatar.jpg',
    creatorUsername: 'markaestro',
    creatorNickname: 'Markaestro',
    privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: 600,
    ...overrides,
  };
}

beforeEach(() => {
  fetchWithRetry.mockReset();
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_APP_URL = 'https://markaestro.com';
});

describe('queryTikTokCreatorInfo', () => {
  it('maps TikTok\'s snake_case response onto the creator info shape', async () => {
    fetchWithRetry.mockResolvedValueOnce(jsonResponse(CREATOR_INFO_OK));
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(fetchWithRetry.mock.calls[0][0]).toBe(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    );
    expect(result).toEqual({
      ok: true,
      info: {
        creatorAvatarUrl: 'https://cdn.example/avatar.jpg',
        creatorUsername: 'markaestro',
        creatorNickname: 'Markaestro',
        privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
        commentDisabled: false,
        duetDisabled: true,
        stitchDisabled: false,
        maxVideoPostDurationSec: 600,
      },
    });
  });

  it('fails rather than guessing when TikTok returns no privacy options', async () => {
    fetchWithRetry.mockResolvedValueOnce(jsonResponse({ data: { privacy_level_options: [] } }));
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('classifies an expired token as an auth failure', async () => {
    fetchWithRetry.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'access_token_invalid', message: 'bad token' } }, 401),
    );
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(result).toMatchObject({ ok: false, reason: 'auth' });
  });

  // Posting caps and bans are terminal for this attempt — retrying only burns
  // what is left of the creator's quota, so they must not read as transient.
  it.each([
    'spam_risk_too_many_posts',
    'spam_risk_user_banned_from_posting',
    'reached_active_user_cap',
  ])('classifies %s as a posting block rather than a transient failure', async (code) => {
    fetchWithRetry.mockResolvedValueOnce(
      jsonResponse({ error: { code, message: 'blocked' } }, 200),
    );
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(result).toMatchObject({ ok: false, reason: 'posting_blocked' });
  });

  it('explains a posting cap instead of surfacing TikTok’s bare message', async () => {
    fetchWithRetry.mockResolvedValueOnce(
      jsonResponse({
        error: { code: 'spam_risk_too_many_posts', message: 'blocked', log_id: 'log_9' },
      }, 200),
    );
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('daily limit');
    // The raw code and log_id stay attached so a failure is still traceable.
    expect(result.error).toContain('spam_risk_too_many_posts');
    expect(result.error).toContain('log_9');
  });

  it('leaves an unrecognised error code untouched', async () => {
    fetchWithRetry.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'something_new', message: 'unexpected' } }, 200),
    );
    const { queryTikTokCreatorInfo } = await import('../platform/adapters/tiktok-direct-post');

    const result = await queryTikTokCreatorInfo('token');

    expect(result).toMatchObject({ ok: false, reason: 'transient' });
    if (result.ok) return;
    expect(result.error).toContain('unexpected');
  });
});

describe('validateTikTokDirectPostSettings', () => {
  it('rejects a post with no privacy level — TikTok has no compliant default', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    expect(validateTikTokDirectPostSettings({ __type: 'tiktok' }, creatorInfoFixture()))
      .toMatch(/requires a privacy level/i);
  });

  it('rejects a privacy level the account does not offer', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    const error = validateTikTokDirectPostSettings(
      { __type: 'tiktok', privacyLevel: 'FOLLOWER_OF_CREATOR' },
      creatorInfoFixture(),
    );

    expect(error).toMatch(/does not allow/i);
  });

  it('rejects branded content set to private', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    const error = validateTikTokDirectPostSettings(
      {
        __type: 'tiktok',
        privacyLevel: 'SELF_ONLY',
        commercialContentDisclosure: true,
        brandContentToggle: true,
      },
      creatorInfoFixture(),
    );

    expect(error).toBe('Branded content visibility cannot be set to private.');
  });

  it('rejects the disclosure toggle with neither label selected', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    const error = validateTikTokDirectPostSettings(
      { __type: 'tiktok', privacyLevel: 'PUBLIC_TO_EVERYONE', commercialContentDisclosure: true },
      creatorInfoFixture(),
    );

    expect(error).toMatch(/promotes yourself, a third party, or both/i);
  });

  it('rejects enabling an interaction the account has turned off', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    const error = validateTikTokDirectPostSettings(
      { __type: 'tiktok', privacyLevel: 'PUBLIC_TO_EVERYONE', disableDuet: false },
      creatorInfoFixture({ duetDisabled: true }),
    );

    expect(error).toMatch(/Duet turned off/i);
  });

  it('accepts a fully specified compliant post', async () => {
    const { validateTikTokDirectPostSettings } = await import('../platform/adapters/tiktok-direct-post');

    const error = validateTikTokDirectPostSettings(
      {
        __type: 'tiktok',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        commercialContentDisclosure: true,
        brandOrganicToggle: true,
      },
      creatorInfoFixture(),
    );

    expect(error).toBeNull();
  });
});

describe('tiktokPublishingAdapter — Direct Post routing', () => {
  it('keeps posts without settings on the inbox endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    fetchWithRetry
      .mockResolvedValueOnce(jsonResponse({ data: { publish_id: 'inbox-1', upload_url: 'https://upload' } }))
      .mockResolvedValueOnce({ status: 201, text: async () => '' });

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const request: PublishRequest = {
      content: 'hello',
      channel: 'tiktok',
      mediaUrls: ['https://cdn.example/clip.mp4'],
    };

    await tiktokPublishingAdapter.publish(connection, request);

    expect(fetchWithRetry.mock.calls[0][0]).toBe(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
    );
  });

  it('routes an explicit direct_post video to the Direct Post endpoint with the chosen settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      body: null,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    fetchWithRetry
      .mockResolvedValueOnce(jsonResponse(CREATOR_INFO_OK))
      .mockResolvedValueOnce(jsonResponse({ data: { publish_id: 'direct-1', upload_url: 'https://upload' } }))
      .mockResolvedValueOnce({ status: 201, text: async () => '' });

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const request: PublishRequest = {
      content: 'hello',
      channel: 'tiktok',
      mediaUrls: ['https://cdn.example/clip.mp4'],
      settings: {
        __type: 'tiktok',
        postMode: 'direct_post',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disableComment: false,
        disableDuet: true,
        disableStitch: false,
        commercialContentDisclosure: true,
        brandOrganicToggle: true,
        brandContentToggle: false,
      },
    };

    const result = await tiktokPublishingAdapter.publish(connection, request);

    expect(fetchWithRetry.mock.calls[0][0]).toBe(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    );
    expect(fetchWithRetry.mock.calls[1][0]).toBe(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
    );

    const body = JSON.parse(fetchWithRetry.mock.calls[1][1].body as string);
    expect(body.post_info).toMatchObject({
      privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_comment: false,
      disable_duet: true,
      // creator_info reports duet_disabled: true, so it stays disabled
      // regardless — but stitch is allowed and was left enabled.
      disable_stitch: false,
      brand_organic_toggle: true,
      brand_content_toggle: false,
    });
    expect(body.source_info.source).toBe('FILE_UPLOAD');
    expect(result).toMatchObject({ success: false, pending: true, externalId: 'direct-1' });
  });

  it('routes a direct_post photo carousel with post_mode DIRECT_POST', async () => {
    fetchWithRetry
      .mockResolvedValueOnce(jsonResponse(CREATOR_INFO_OK))
      .mockResolvedValueOnce(jsonResponse({ data: { publish_id: 'direct-photo-1' } }));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const request: PublishRequest = {
      content: 'carousel',
      channel: 'tiktok',
      mediaUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      settings: {
        __type: 'tiktok',
        postMode: 'direct_post',
        privacyLevel: 'MUTUAL_FOLLOW_FRIENDS',
        disableComment: true,
        photoCoverIndex: 1,
      },
    };

    await tiktokPublishingAdapter.publish(connection, request);

    const body = JSON.parse(fetchWithRetry.mock.calls[1][1].body as string);
    expect(body.post_mode).toBe('DIRECT_POST');
    expect(body.media_type).toBe('PHOTO');
    expect(body.post_info.privacy_level).toBe('MUTUAL_FOLLOW_FRIENDS');
    expect(body.post_info.disable_comment).toBe(true);
    // Duet and Stitch do not apply to photo posts.
    expect(body.post_info).not.toHaveProperty('disable_duet');
    expect(body.post_info).not.toHaveProperty('disable_stitch');
    expect(body.source_info.photo_cover_index).toBe(1);
  });

  it('refuses a direct_post whose privacy level the account no longer offers', async () => {
    fetchWithRetry.mockResolvedValueOnce(jsonResponse(CREATOR_INFO_OK));

    const { tiktokPublishingAdapter } = await import('../platform/adapters/tiktok-publishing');
    const result = await tiktokPublishingAdapter.publish(connection, {
      content: 'carousel',
      channel: 'tiktok',
      mediaUrls: ['https://cdn.example/a.jpg'],
      settings: {
        __type: 'tiktok',
        postMode: 'direct_post',
        privacyLevel: 'FOLLOWER_OF_CREATOR',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not allow/i);
    // Nothing was published — only creator_info was called.
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
  });
});
