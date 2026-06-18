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
  options: { requireReadyChannels?: boolean } = {},
): Promise<SocialPostValidationIssue[]> {
  const issues = validateSocialPost(input);

  if (!options.requireReadyChannels) {
    return issues;
  }

  const channels = normalizeTargetChannels(input);
  if (channels.length === 0) return issues;

  const unavailable = await getUnavailableSocialChannels(workspaceId, productId, channels as SocialChannel[]);
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
