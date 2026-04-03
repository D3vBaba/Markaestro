"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import PlatformPreview from "@/components/app/PlatformPreview";

type Post = {
  id: string;
  content: string;
  channel: string;
  status: string;
  scheduledAt?: string | null;
  publishedAt?: string;
  externalUrl?: string;
  createdAt?: string;
  errorMessage?: string;
  mediaUrls?: string[];
};

const channelLabels: Record<string, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};


const statusDotColors: Record<string, string> = {
  draft: "bg-zinc-300",
  scheduled: "bg-amber-400",
  published: "bg-emerald-500",
  failed: "bg-red-500",
  publishing: "bg-blue-400",
};

const statusTextColors: Record<string, string> = {
  failed: "text-destructive",
  published: "text-emerald-600",
  scheduled: "text-amber-600",
};

export default function PostCard({
  post,
  onEdit,
  onDelete,
  onCancel,
  onPublish,
}: {
  post: Post;
  onEdit?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onPublish?: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="group border border-border/50 rounded-xl p-4 sm:p-5 space-y-3.5 bg-card hover:border-border/80 hover:shadow-sm transition-all overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground/70">
            {channelLabels[post.channel] || post.channel}
          </span>
          {post.scheduledAt && post.status === "scheduled" && (
            <>
              <span className="w-px h-3 bg-border/60" />
              <span className="text-[11px] text-muted-foreground truncate">
                {new Date(post.scheduledAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </>
          )}
        </div>
        {/* Status badge with dot */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${statusDotColors[post.status] || "bg-zinc-300"}`}
          />
          <span
            className={`text-[10px] uppercase tracking-wider font-medium ${statusTextColors[post.status] || "text-muted-foreground"}`}
          >
            {post.status}
          </span>
        </div>
      </div>

      {/* Media thumbnail */}
      {post.mediaUrls?.[0] && (
        <div className="rounded-lg overflow-hidden border border-border/30">
          {post.mediaUrls[0].match(/\.(mp4|mov|webm)(\?|$)/i) ? (
            <video
              src={post.mediaUrls[0]}
              className="w-full object-contain bg-black max-h-36"
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <a href={post.mediaUrls[0]} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in">
              <img
                src={post.mediaUrls[0]}
                alt=""
                className="w-full max-h-36 object-cover hover:opacity-90 transition-opacity"
                loading="lazy"
              />
            </a>
          )}
        </div>
      )}

      {/* Content / preview */}
      {showPreview ? (
        <PlatformPreview
          content={post.content}
          channel={post.channel}
          mediaUrls={post.mediaUrls}
          externalUrl={post.externalUrl}
        />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word line-clamp-4 text-foreground/80">
          {post.content}
        </p>
      )}

      {post.errorMessage && (
        <p className="text-xs text-destructive bg-destructive/5 rounded-lg px-3 py-2">
          {post.errorMessage}
        </p>
      )}

      {/* Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground/60">
          {post.publishedAt
            ? new Date(post.publishedAt).toLocaleDateString()
            : post.createdAt
            ? new Date(post.createdAt).toLocaleDateString()
            : ""}
        </span>
        <div className="flex flex-wrap items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Text" : "Preview"}
          </Button>
          {post.externalUrl && (
            <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground">
                View
              </Button>
            </a>
          )}
          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
          {onPublish && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onPublish}
            >
              Publish
            </Button>
          )}
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onCancel}
            >
              Unschedule
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
