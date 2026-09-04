import { Play } from "lucide-react";
import { Channel } from "./Channel";
import { cn } from "@/lib/utils";

const VIDEO_URL = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/**
 * The one way a post is pictured across the app: its thumbnail (platform
 * poster, first image, or the derived poster of a video asset), with a play
 * mark when the underlying media is a video, and the channel glyph when there
 * is nothing to show.
 */
export function PostThumbnail({
  src,
  mediaUrl,
  channel,
  size = 48,
  className,
  rounded = "rounded-lg",
}: {
  /** Resolved thumbnail; see attachPostThumbnails on the server. */
  src?: string | null;
  /** First media URL, used to detect video and as an image fallback. */
  mediaUrl?: string | null;
  channel: string;
  size?: number;
  className?: string;
  rounded?: string;
}) {
  const isVideo = Boolean(mediaUrl && VIDEO_URL.test(mediaUrl));
  const image = src || (mediaUrl && !isVideo ? mediaUrl : null);
  const box = { width: size, height: size };

  if (!image) {
    return (
      <span className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-muted", rounded, className)} style={box} aria-hidden>
        <Channel channel={channel} size={Math.round(size * 0.46)} />
        {/* A video with no derived poster yet: let the browser paint its first
            frame over the glyph. preload=metadata fetches only the header. */}
        {isVideo && mediaUrl ? (
          <video
            src={`${mediaUrl}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            tabIndex={-1}
          />
        ) : null}
        {isVideo ? (
          <span className="absolute bottom-1 end-1 grid size-4 place-items-center rounded-full bg-black/60 text-white">
            <Play className="size-2.5" fill="currentColor" />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className={cn("relative block shrink-0 overflow-hidden border border-border bg-muted", rounded, className)} style={box} aria-hidden>
      <img src={image} alt="" className="size-full object-cover" loading="lazy" draggable={false} />
      {isVideo ? (
        <span className="absolute bottom-1 end-1 grid size-4 place-items-center rounded-full bg-black/60 text-white">
          <Play className="size-2.5" fill="currentColor" />
        </span>
      ) : null}
    </span>
  );
}
