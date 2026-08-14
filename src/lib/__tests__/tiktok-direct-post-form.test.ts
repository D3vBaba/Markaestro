import { describe, expect, it } from 'vitest';
import type { TikTokCreatorInfo } from '../platform/adapters/tiktok-direct-post';
import {
  emptyTikTokDirectPostForm,
  getTikTokConsentVariant,
  getTikTokDirectPostBlocker,
  isPrivacyOptionDisabled,
  toTikTokDirectPostSettings,
  type TikTokDirectPostFormState,
} from '../social/tiktok-direct-post-form';

function creatorInfo(overrides: Partial<TikTokCreatorInfo> = {}): TikTokCreatorInfo {
  return {
    creatorAvatarUrl: null,
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

function form(overrides: Partial<TikTokDirectPostFormState> = {}): TikTokDirectPostFormState {
  return { ...emptyTikTokDirectPostForm(), ...overrides };
}

describe('emptyTikTokDirectPostForm', () => {
  it('starts with no privacy level and nothing enabled', () => {
    // TikTok audits for exactly this: no default privacy, no pre-checked
    // interaction abilities, disclosure off.
    expect(emptyTikTokDirectPostForm()).toEqual({
      privacyLevel: null,
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      commercialContentDisclosure: false,
      yourBrand: false,
      brandedContent: false,
    });
  });
});

describe('getTikTokDirectPostBlocker', () => {
  it('blocks until a privacy level is chosen', () => {
    expect(getTikTokDirectPostBlocker(form(), null, creatorInfo()))
      .toEqual({ kind: 'privacy_not_selected' });
  });

  it('blocks when disclosure is on but neither label is picked', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE', commercialContentDisclosure: true });
    expect(getTikTokDirectPostBlocker(state, null, creatorInfo()))
      .toEqual({ kind: 'disclosure_without_selection' });
  });

  it('blocks branded content on a private post', () => {
    const state = form({
      privacyLevel: 'SELF_ONLY',
      commercialContentDisclosure: true,
      brandedContent: true,
    });
    expect(getTikTokDirectPostBlocker(state, null, creatorInfo()))
      .toEqual({ kind: 'branded_content_private' });
  });

  it('blocks a video longer than the account limit', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE' });
    expect(getTikTokDirectPostBlocker(state, 601, creatorInfo({ maxVideoPostDurationSec: 600 })))
      .toEqual({ kind: 'video_too_long', maxSeconds: 600 });
  });

  it('allows a video exactly at the account limit', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE' });
    expect(getTikTokDirectPostBlocker(state, 600, creatorInfo({ maxVideoPostDurationSec: 600 })))
      .toBeNull();
  });

  it('does not block on duration when it could not be measured', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE' });
    expect(getTikTokDirectPostBlocker(state, null, creatorInfo())).toBeNull();
  });

  it('allows "Your brand" on a private post — only branded content is restricted', () => {
    const state = form({
      privacyLevel: 'SELF_ONLY',
      commercialContentDisclosure: true,
      yourBrand: true,
    });
    expect(getTikTokDirectPostBlocker(state, null, creatorInfo())).toBeNull();
  });
});

describe('isPrivacyOptionDisabled', () => {
  it('disables only "Only me", and only while branded content is selected', () => {
    const withBranded = form({ brandedContent: true });
    expect(isPrivacyOptionDisabled('SELF_ONLY', withBranded)).toBe(true);
    expect(isPrivacyOptionDisabled('PUBLIC_TO_EVERYONE', withBranded)).toBe(false);
    expect(isPrivacyOptionDisabled('SELF_ONLY', form())).toBe(false);
  });
});

describe('getTikTokConsentVariant', () => {
  it('uses the default declaration when nothing is disclosed', () => {
    expect(getTikTokConsentVariant(form())).toBe('default');
  });

  it('uses the default declaration for "Your brand" alone', () => {
    expect(getTikTokConsentVariant(form({ commercialContentDisclosure: true, yourBrand: true })))
      .toBe('default');
  });

  it('uses the branded-content declaration when branded content is selected', () => {
    expect(getTikTokConsentVariant(form({ commercialContentDisclosure: true, brandedContent: true })))
      .toBe('brandedContent');
  });

  it('uses the branded-content declaration when both labels are selected', () => {
    const state = form({ commercialContentDisclosure: true, yourBrand: true, brandedContent: true });
    expect(getTikTokConsentVariant(state)).toBe('brandedContent');
  });
});

describe('toTikTokDirectPostSettings', () => {
  it('inverts the interaction checkboxes into TikTok\'s disable_* fields', () => {
    const state = form({
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      allowComment: true,
      allowDuet: false,
      allowStitch: true,
    });

    expect(toTikTokDirectPostSettings(state, creatorInfo(), 'video')).toEqual({
      __type: 'tiktok',
      postMode: 'direct_post',
      privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: false,
      disableDuet: true,
      disableStitch: false,
      commercialContentDisclosure: false,
      brandOrganicToggle: false,
      brandContentToggle: false,
    });
  });

  it('keeps an ability disabled when the account itself has turned it off', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: true });
    const settings = toTikTokDirectPostSettings(
      state,
      creatorInfo({ commentDisabled: true, duetDisabled: true }),
      'video',
    );

    expect(settings.disableComment).toBe(true);
    expect(settings.disableDuet).toBe(true);
  });

  it('omits Duet and Stitch for photo posts', () => {
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE', allowComment: true });
    const settings = toTikTokDirectPostSettings(state, creatorInfo(), 'photo', 2);

    expect(settings).not.toHaveProperty('disableDuet');
    expect(settings).not.toHaveProperty('disableStitch');
    expect(settings.photoCoverIndex).toBe(2);
  });

  it('drops both brand labels when the parent disclosure toggle is off', () => {
    // Guards against a stale label surviving after the creator collapses the
    // disclosure section.
    const state = form({ privacyLevel: 'PUBLIC_TO_EVERYONE', yourBrand: true, brandedContent: true });
    const settings = toTikTokDirectPostSettings(state, creatorInfo(), 'video');

    expect(settings.brandOrganicToggle).toBe(false);
    expect(settings.brandContentToggle).toBe(false);
  });
});
