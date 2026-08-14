import type { TikTokCreatorInfo } from '@/lib/platform/adapters/tiktok-direct-post';
import type { TikTokSettings } from '@/lib/public-api/post-settings';
import { tiktokPrivacyLevels } from '@/lib/public-api/post-settings';

/**
 * The Direct Post composer's state machine, kept out of the component so
 * every rule TikTok audits against is unit-testable.
 *
 * @see https://developers.tiktok.com/doc/content-sharing-guidelines
 */

export type TikTokPrivacyLevel = (typeof tiktokPrivacyLevels)[number];

export type TikTokDirectPostFormState = {
  /**
   * Null until the creator picks one. TikTok requires the privacy dropdown to
   * have no default value, so this must never be seeded — not from a previous
   * post, not from the first available option.
   */
  privacyLevel: TikTokPrivacyLevel | null;
  /** Interaction abilities. All start off: nothing may be pre-enabled. */
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** Parent commercial content disclosure toggle. Off by default. */
  commercialContentDisclosure: boolean;
  /** "Your brand" → labels the post "Promotional content". */
  yourBrand: boolean;
  /** "Branded content" → labels the post "Paid partnership". */
  brandedContent: boolean;
};

export function emptyTikTokDirectPostForm(): TikTokDirectPostFormState {
  return {
    privacyLevel: null,
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    commercialContentDisclosure: false,
    yourBrand: false,
    brandedContent: false,
  };
}

export function isTikTokPrivacyLevel(value: string): value is TikTokPrivacyLevel {
  return (tiktokPrivacyLevels as readonly string[]).includes(value);
}

/** Photo posts have no Duet or Stitch, so those controls are not rendered. */
export type TikTokMediaKind = 'video' | 'photo';

/**
 * Branded content cannot be private. The privacy option stays visible but
 * disabled, with hover text explaining why — TikTok specifies both.
 */
export function isPrivacyOptionDisabled(
  option: string,
  state: TikTokDirectPostFormState,
): boolean {
  return option === 'SELF_ONLY' && state.brandedContent;
}

/**
 * Which compliance declaration to show above the post button. TikTok
 * specifies the exact wording; "both selected" uses the branded-content
 * variant.
 */
export function getTikTokConsentVariant(
  state: TikTokDirectPostFormState,
): 'default' | 'brandedContent' {
  return state.commercialContentDisclosure && state.brandedContent ? 'brandedContent' : 'default';
}

export type TikTokDirectPostBlocker =
  | { kind: 'privacy_not_selected' }
  | { kind: 'disclosure_without_selection' }
  | { kind: 'branded_content_private' }
  | { kind: 'video_too_long'; maxSeconds: number };

/**
 * The publish button's gate. Returns the first blocking reason, or null when
 * the form is publishable. Each blocker maps to a hover message in the UI.
 */
export function getTikTokDirectPostBlocker(
  state: TikTokDirectPostFormState,
  videoDurationSec: number | null,
  creatorInfo: TikTokCreatorInfo,
): TikTokDirectPostBlocker | null {
  if (!state.privacyLevel) {
    return { kind: 'privacy_not_selected' };
  }

  if (state.commercialContentDisclosure && !state.yourBrand && !state.brandedContent) {
    return { kind: 'disclosure_without_selection' };
  }

  if (state.brandedContent && state.privacyLevel === 'SELF_ONLY') {
    return { kind: 'branded_content_private' };
  }

  const maxSeconds = creatorInfo.maxVideoPostDurationSec;
  if (maxSeconds !== null && videoDurationSec !== null && videoDurationSec > maxSeconds) {
    return { kind: 'video_too_long', maxSeconds };
  }

  return null;
}

/**
 * Project the form onto the persisted post settings. Interaction abilities
 * invert into TikTok's `disable_*` shape here rather than in the component,
 * and an ability the account itself has turned off is always sent disabled
 * regardless of the checkbox — the checkbox is greyed out in that case, so
 * this only guards against stale client state.
 */
export function toTikTokDirectPostSettings(
  state: TikTokDirectPostFormState,
  creatorInfo: TikTokCreatorInfo,
  mediaKind: TikTokMediaKind,
  photoCoverIndex?: number,
): TikTokSettings {
  const settings: TikTokSettings = {
    __type: 'tiktok',
    postMode: 'direct_post',
    disableComment: creatorInfo.commentDisabled || !state.allowComment,
    commercialContentDisclosure: state.commercialContentDisclosure,
    brandOrganicToggle: state.commercialContentDisclosure && state.yourBrand,
    brandContentToggle: state.commercialContentDisclosure && state.brandedContent,
  };

  if (state.privacyLevel) settings.privacyLevel = state.privacyLevel;
  if (mediaKind === 'video') {
    settings.disableDuet = creatorInfo.duetDisabled || !state.allowDuet;
    settings.disableStitch = creatorInfo.stitchDisabled || !state.allowStitch;
  }
  if (photoCoverIndex !== undefined) settings.photoCoverIndex = photoCoverIndex;

  return settings;
}
