"use client";

import { Textarea } from "@/components/ui/textarea";
import {
  getSocialChannelConfig,
  getSocialChannelLabel,
  getSocialChannelMaxLength,
} from "@/lib/social/channel-catalog";

export default function ContentEditor({
  content,
  onChange,
  channel,
  channels,
  disabled,
}: {
  content: string;
  onChange: (value: string) => void;
  channel: string;
  channels?: string[];
  disabled?: boolean;
}) {
  const activeChannels = channels?.length ? channels : [channel];
  const limit = Math.min(...activeChannels.map(getSocialChannelMaxLength));
  const limitingChannel = activeChannels
    .map((item) => getSocialChannelConfig(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.maxLength - b.maxLength)[0];
  const count = content.length;
  const isOver = count > limit;
  const channelLabel = activeChannels.length > 1
    ? `${getSocialChannelLabel(limitingChannel?.channel ?? channel)} limit`
    : getSocialChannelLabel(channel);

  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        disabled={disabled}
        placeholder="Generated content will appear here..."
        className="font-mono text-sm"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {channelLabel} ({limit.toLocaleString()} chars)
        </span>
        <span className={isOver ? "text-destructive font-medium" : "text-muted-foreground"}>
          {count.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
