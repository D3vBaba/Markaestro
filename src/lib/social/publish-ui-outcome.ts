import {
  isPlatformActionRequiredStatus,
  TIKTOK_MANUAL_PUBLISH_ACTION,
} from '@/lib/tiktok-draft-flow';
import { MANUAL_REMINDER_NEXT_ACTION } from '@/lib/manual-publish-flow';

type PublishChannelResult = {
  channel: string;
  success: boolean;
  pending?: boolean;
  error?: string;
};

export type PublishUiResponse = {
  status?: string;
  pending?: boolean;
  nextAction?: string;
  channels?: PublishChannelResult[];
};

/**
 * The channel results worth a failure toast. A pending channel is still
 * reconciling in the background, not failed; an entry with no error text has
 * nothing useful to display ("tiktok: undefined"); and a "Skipped …" result
 * is an intentional non-attempt.
 */
export function getFailedChannelResults<T extends PublishChannelResult>(
  channels: T[] | undefined,
): Array<T & { error: string }> {
  return (channels || []).filter(
    (c): c is T & { error: string } =>
      !c.success && !c.pending && typeof c.error === 'string' && c.error.length > 0 && !c.error.startsWith('Skipped'),
  );
}

export function getPublishUiOutcome(response: PublishUiResponse) {
  const status = response.status || (response.pending ? 'publishing' : 'published');
  const hasTikTok = (response.channels || []).some((channel) => channel.channel === 'tiktok');
  const platformActionRequired =
    isPlatformActionRequiredStatus(status) ||
    response.nextAction === TIKTOK_MANUAL_PUBLISH_ACTION;

  return {
    status,
    hasTikTok,
    platformActionRequired,
    // Waiting in the manual "To Post" queue rather than a platform inbox.
    manualReminder: response.nextAction === MANUAL_REMINDER_NEXT_ACTION,
    processing: status === 'publishing' || Boolean(response.pending),
  };
}
