import type { SocialChannel } from '@/lib/schemas';
import { getUnavailableSocialChannels } from '@/lib/social/channel-status';
import {
  normalizeTargetChannels,
  validateSocialPost,
  type SocialPostValidationInput,
  type SocialPostValidationIssue,
} from '@/lib/social/post-validation';
import { getSocialChannelLabel } from '@/lib/social/channel-catalog';

export async function getSocialPostPreflightIssues(
  workspaceId: string,
  productId: string | undefined,
  input: SocialPostValidationInput,
  options: {
    requireReadyChannels?: boolean;
    channelDestinations?: Partial<Record<SocialChannel, string>>;
    /**
     * Channels the post will never send to a platform API (manual reminders).
     * They still get content validation, but demanding a ready connection for
     * a channel nothing will ever call would block posts that are fine.
     */
    manualChannels?: readonly SocialChannel[];
  } = {},
): Promise<SocialPostValidationIssue[]> {
  const issues = validateSocialPost(input);

  if (!options.requireReadyChannels) {
    return issues;
  }

  const manual = new Set<string>(options.manualChannels ?? []);
  const channels = normalizeTargetChannels(input).filter((channel) => !manual.has(channel));
  if (channels.length === 0) return issues;

  const unavailable = await getUnavailableSocialChannels(
    workspaceId,
    productId,
    channels as SocialChannel[],
    options.channelDestinations,
  );
  for (const item of unavailable) {
    issues.push({
      channel: item.channel,
      code: `VALIDATION_${item.channel.toUpperCase()}_NOT_READY`,
      message: `${getSocialChannelLabel(item.channel)} is not ready: ${item.reason}`,
    });
  }

  return issues;
}

export function formatPreflightIssues(issues: SocialPostValidationIssue[]): string {
  return issues.map((issue) => issue.message).join(' ');
}
