import { describe, expect, it } from 'vitest';
import { getPublishUiOutcome } from '../social/publish-ui-outcome';
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
