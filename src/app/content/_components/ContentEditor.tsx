"use client";

import { Textarea } from "@/components/ui/textarea";

const CHAR_LIMITS: Record<string, number> = {
  x: 280,
  instagram: 2200,
  facebook: 63206,
  tiktok: 2200,
};

export default function ContentEditor({
  content,
  onChange,
  channel,
  disabled,
}: {
  content: string;
  onChange: (value: string) => void;
  channel: string;
  disabled?: boolean;
}) {
  const limit = CHAR_LIMITS[channel] || 63206;
  const count = content.length;
  const isOver = count > limit;

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
          {channel === "instagram" ? "Instagram (2,200 chars)" : channel === "tiktok" ? "TikTok (2,200 chars)" : "Facebook (63,206 chars)"}
        </span>
        <span className={isOver ? "text-destructive font-medium" : "text-muted-foreground"}>
          {count.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
