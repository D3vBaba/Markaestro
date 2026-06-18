import { getSocialChannelConfig } from '@/lib/social/channel-catalog';

export type ChannelReadiness = {
  channel: string;
  state: string;
};

export type ReconciledChannelSelection = {
  selectedChannels: string[];
  channel: string;
};

function uniqueValidChannels(channels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const channel of channels) {
    if (!getSocialChannelConfig(channel) || seen.has(channel)) continue;
    seen.add(channel);
    result.push(channel);
  }

  return result;
}

/**
 * Keep the composer's selected channels aligned with channels that are actually
 * publish-ready for the current product. This prevents stale local drafts or
 * the default Facebook selection from submitting a hidden target channel.
 */
export function reconcileReadyChannelSelection(
  currentChannel: string,
  selectedChannels: readonly string[],
  channels: readonly ChannelReadiness[],
): ReconciledChannelSelection {
  const readyChannels = uniqueValidChannels(
    channels
      .filter((channel) => channel.state === 'ready')
      .map((channel) => channel.channel),
  );
  const readySet = new Set(readyChannels);
  const selectedReadyChannels = uniqueValidChannels(selectedChannels)
    .filter((channel) => readySet.has(channel));

  if (selectedReadyChannels.length > 0) {
    return {
      selectedChannels: selectedReadyChannels,
      channel: selectedReadyChannels.includes(currentChannel) ? currentChannel : selectedReadyChannels[0],
    };
  }

  const fallbackChannel = readySet.has(currentChannel) ? currentChannel : readyChannels[0];
  if (fallbackChannel) {
    return {
      selectedChannels: [fallbackChannel],
      channel: fallbackChannel,
    };
  }

  return {
    selectedChannels: [],
    channel: currentChannel,
  };
}

export function areChannelSelectionsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
