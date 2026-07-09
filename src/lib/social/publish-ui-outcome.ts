import {
  isPlatformActionRequiredStatus,
  TIKTOK_MANUAL_PUBLISH_ACTION,
} from '@/lib/tiktok-draft-flow';
import { MANUAL_REMINDER_NEXT_ACTION } from '@/lib/manual-publish-flow';

type PublishChannelResult = {
  channel: string;
  success: boolean;
  pending?: boolean;
};

export type PublishUiResponse = {
  status?: string;
  pending?: boolean;
  nextAction?: string;
  channels?: PublishChannelResult[];
};

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
