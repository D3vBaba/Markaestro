/**
 * Manual reminder ("notification publishing") flow.
 *
 * Posts with the `manual_reminder` delivery mode are never sent to a platform
 * API. Markaestro prepares the content and, when the post is due, moves it to
 * `platform_action_required` so the user can post it natively themselves and
 * confirm. This is the zero-automation-footprint alternative to
 * `direct_publish` (official platform APIs) and `platform_inbox` (TikTok's
 * draft handoff, which still calls the TikTok API).
 */

export const MANUAL_REMINDER_DELIVERY_MODE = 'manual_reminder';

export const MANUAL_REMINDER_NEXT_ACTION = 'post_manually_from_reminder';

// Shared "waiting on the user" post status. Originally introduced for the
// TikTok inbox handoff; manual reminder posts on any channel use it too.
export const PLATFORM_ACTION_REQUIRED_STATUS = 'platform_action_required';
export const LEGACY_EXPORTED_FOR_REVIEW_STATUS = 'exported_for_review';

export function isPlatformActionRequiredStatus(status: unknown): boolean {
  return status === PLATFORM_ACTION_REQUIRED_STATUS || status === LEGACY_EXPORTED_FOR_REVIEW_STATUS;
}

export function isManualReminderDeliveryMode(mode: unknown): mode is typeof MANUAL_REMINDER_DELIVERY_MODE {
  return mode === MANUAL_REMINDER_DELIVERY_MODE;
}

export function isManualReminderPost(post: Record<string, unknown>): boolean {
  return isManualReminderDeliveryMode(post.deliveryMode);
}

/** Recorded on posts the user confirmed they published natively themselves. */
export const MANUAL_PUBLISHED_VIA = 'manual';

/**
 * Best-effort extraction of the platform post ID from a URL the user pasted
 * when confirming a manual post. An ID lets the analytics poller attribute
 * metrics to the post later; a URL we can't parse is still stored verbatim.
 */
export function parseManualPostUrl(
  channel: string,
  rawUrl: string,
): { externalUrl: string; externalId: string } {
  const externalUrl = rawUrl.trim();
  const empty = { externalUrl, externalId: '' };
  if (!externalUrl) return { externalUrl: '', externalId: '' };

  let parsed: URL;
  try {
    parsed = new URL(externalUrl);
  } catch {
    return empty;
  }

  const path = parsed.pathname;

  switch (channel) {
    case 'instagram': {
      // instagram.com/p/{shortcode} or /reel/{shortcode}
      const match = path.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
      return { externalUrl, externalId: match?.[1] ?? '' };
    }
    case 'tiktok': {
      // tiktok.com/@user/video/{id} or /photo/{id}
      const match = path.match(/\/(?:video|photo)\/(\d+)/);
      return { externalUrl, externalId: match?.[1] ?? '' };
    }
    case 'facebook': {
      // facebook.com/.../posts/{id}, /videos/{id}, /photos/.../{id}, or ?story_fbid={id}
      const storyFbid = parsed.searchParams.get('story_fbid');
      if (storyFbid) return { externalUrl, externalId: storyFbid };
      const match = path.match(/\/(?:posts|videos|reel)\/(pfbid[A-Za-z0-9]+|\d+)/);
      return { externalUrl, externalId: match?.[1] ?? '' };
    }
    default:
      return empty;
  }
}
