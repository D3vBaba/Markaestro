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
