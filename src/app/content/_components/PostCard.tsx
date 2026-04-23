"use client";

import { useState } from "react";
import PlatformPreview from "@/components/app/PlatformPreview";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";

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
  exported_for_review: "bg-violet-500",
};

const statusTextColors: Record<string, string> = {
  failed: "text-destructive",
  published: "text-emerald-600",
  scheduled: "text-amber-600",
  publishing: "text-blue-500",
  exported_for_review: "text-violet-600",
};

const statusLabels: Record<string, string> = {
  exported_for_review: "Ready in Markaestro",
};

// Shared pill button style
const pillBtn =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border border-blue-200 bg-white text-blue-600 text-[11px] font-medium hover:bg-blue-50 hover:border-blue-300 transition-colors whitespace-nowrap";
const pillBtnDestructive =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border border-red-200 bg-white text-red-500 text-[11px] font-medium hover:bg-red-50 hover:border-red-300 transition-colors whitespace-nowrap";
const pillBtnDisabled =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border border-blue-100 bg-white text-blue-300 text-[11px] font-medium cursor-not-allowed whitespace-nowrap";

export default function PostCard({
  post,
  publishing = false,
  onEdit,
  onDelete,
  onCancel,
  onPublish,
}: {
  post: Post;
  publishing?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onPublish?: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const displayStatus = publishing ? "publishing" : post.status;

  return (
    <div className="group border border-border/50 rounded-xl overflow-hidden bg-card hover:border-border/80 hover:shadow-sm transition-all">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/30">
        {/* Left: channel + scheduled date */}
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
          {(post.publishedAt || post.createdAt) && post.status !== "scheduled" && (
            <>
              <span className="w-px h-3 bg-border/60" />
              <span className="text-[11px] text-muted-foreground truncate">
                {new Date(post.publishedAt ?? post.createdAt!).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </>
          )}
        </div>

        {/* Right: status badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {publishing && (
            <div className="w-3 h-3 rounded-full border-2 border-blue-300 border-t-blue-500 animate-spin" />
          )}
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${statusDotColors[displayStatus] || "bg-zinc-300"} ${publishing ? "hidden" : ""}`}
          />
          <span
            className={`text-[10px] uppercase tracking-wider font-medium ${statusTextColors[displayStatus] || "text-muted-foreground"}`}
          >
            {statusLabels[displayStatus] || displayStatus}
          </span>
        </div>
      </div>

      {/* Media thumbnail */}
      {post.mediaUrls?.[0] && (
        <div className="border-b border-border/30">
          {post.mediaUrls[0].match(/\.(mp4|mov|webm)(\?|$)/i) ? (
            <video
              src={post.mediaUrls[0]}
              className="w-full object-contain bg-black max-h-48"
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <a href={post.mediaUrls[0]} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in">
              <img
                src={post.mediaUrls[0]}
                alt=""
                className="w-full max-h-48 object-cover hover:opacity-90 transition-opacity"
                loading="lazy"
              />
            </a>
          )}
        </div>
      )}

      {/* Content / preview */}
      <div className="px-4 py-3">
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
          <p className="mt-2 text-xs text-destructive bg-destructive/5 rounded-lg px-3 py-2">
            {post.errorMessage}
          </p>
        )}
      </div>

      {/* Publishing overlay banner */}
      {publishing && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-300 border-t-blue-500 animate-spin shrink-0" />
          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Publishing to {channelLabels[post.channel] || post.channel}…</p>
        </div>
      )}

      {/* Footer: action buttons */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
        <button
          className={pillBtn}
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "Text" : "Preview"}
        </button>

        {post.externalUrl && (
          <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
            <button className={pillBtn}>View</button>
          </a>
        )}

        {onEdit && (
          <button className={pillBtn} onClick={onEdit}>
            Edit
          </button>
        )}

        {onPublish && (
          <button
            className={publishing ? pillBtnDisabled : pillBtn}
            onClick={publishing ? undefined : onPublish}
            disabled={publishing}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}

        {onCancel && (
          <button className={pillBtn} onClick={onCancel}>
            Unschedule
          </button>
        )}

        {onDelete && (
          <button className={pillBtnDestructive} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>

      {onDelete && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          entity="post"
          name={channelLabels[post.channel] || post.channel}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}
