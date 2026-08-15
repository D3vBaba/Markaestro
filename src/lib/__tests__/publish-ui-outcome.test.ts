import { describe, expect, it } from 'vitest';
import { getFailedChannelResults, getPublishUiOutcome } from '../social/publish-ui-outcome';
import { TIKTOK_MANUAL_PUBLISH_ACTION } from '../tiktok-draft-flow';

describe('getPublishUiOutcome', () => {
  it('treats TikTok inbox handoff as platform action required', () => {
    expect(getPublishUiOutcome({
      status: 'platform_action_required',
      nextAction: TIKTOK_MANUAL_PUBLISH_ACTION,
      channels: [{ channel: 'tiktok', success: true }],
    })).toMatchObject({
      status: 'platform_action_required',
      hasTikTok: true,
      platformActionRequired: true,
      processing: false,
    });
  });

  it('does not claim inbox delivery while TikTok is still processing', () => {
    expect(getPublishUiOutcome({
      status: 'publishing',
      pending: true,
      channels: [{ channel: 'tiktok', success: false, pending: true }],
    })).toMatchObject({
      status: 'publishing',
      hasTikTok: true,
      platformActionRequired: false,
      processing: true,
    });
  });

  it('classifies non-TikTok completed publishes as finished', () => {
    expect(getPublishUiOutcome({
      status: 'published',
      channels: [{ channel: 'linkedin', success: true }],
    })).toMatchObject({
      status: 'published',
      hasTikTok: false,
      platformActionRequired: false,
      processing: false,
    });
  });
});

describe('getFailedChannelResults', () => {
  it('keeps only channels that failed with an error worth showing', () => {
    expect(getFailedChannelResults([
      { channel: 'linkedin', success: false, error: 'LinkedIn rejected the media' },
      { channel: 'facebook', success: true },
    ])).toEqual([
      { channel: 'linkedin', success: false, error: 'LinkedIn rejected the media' },
    ]);
  });

  it('never reports a pending or error-less channel as failed', () => {
    // A TikTok Direct Post that completed during the route's inline poll can
    // come back as the pre-poll snapshot: success false, pending true, no
    // error. That rendered as "tiktok: undefined" — it must not toast at all.
    expect(getFailedChannelResults([
      { channel: 'tiktok', success: false, pending: true },
      { channel: 'tiktok', success: false },
    ])).toEqual([]);
  });

  it('drops intentionally skipped channels and handles a missing list', () => {
    expect(getFailedChannelResults([
      { channel: 'instagram', success: false, error: 'Skipped: already published' },
    ])).toEqual([]);
    expect(getFailedChannelResults(undefined)).toEqual([]);
  });
});
