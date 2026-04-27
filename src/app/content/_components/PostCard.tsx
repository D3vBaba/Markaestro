"use client";

import { useState } from "react";
import PlatformPreview from "@/components/app/PlatformPreview";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { getSocialChannelLabel } from "@/lib/social/channel-catalog";

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
  nextAction?: string;
  targetChannels?: string[];
};

const statusDotColors: Record<string, string> = {
  draft: "bg-mk-ink-20",
  scheduled: "bg-mk-accent",
  published: "bg-mk-pos",
  failed: "bg-mk-neg",
  publishing: "bg-mk-warn",
  exported_for_review: "bg-mk-accent",
};

const statusTextColors: Record<string, string> = {
  failed: "text-mk-neg",
  published: "text-mk-pos",
  scheduled: "text-mk-ink-60",
  publishing: "text-mk-warn",
  exported_for_review: "text-mk-accent",
};

const statusLabels: Record<string, string> = {
  exported_for_review: "Ready in TikTok",
};

// Shared pill button style
const pillBtn =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-accent bg-mk-paper";
const pillBtnDestructive =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-neg bg-mk-paper";
const pillBtnDisabled =
  "inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-medium cursor-not-allowed whitespace-nowrap border-mk-rule-soft text-mk-ink-40 bg-mk-paper";

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
  const channelLabel = post.targetChannels?.length
    ? post.targetChannels.map(getSocialChannelLabel).join(" + ")
    : getSocialChannelLabel(post.channel);

  return (
    <div className="group border border-border/50 rounded-xl overflow-hidden bg-card hover:border-border/80 hover:shadow-sm transition-all">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/30">
        {/* Left: channel + scheduled date */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground/70">
            {channelLabel}
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

      {/* TikTok inbox banner: post was pushed to the creator's inbox and
          needs to be finalized from the TikTok app. */}
      {!publishing && post.status === "exported_for_review" && post.channel === "tiktok" && (
        <div
          className="mx-4 mb-3 flex items-start gap-2 rounded-lg border px-3 py-2"
          style={{
            background: "var(--mk-accent-soft)",
            borderColor: "color-mix(in oklch, var(--mk-accent) 30%, var(--mk-paper))",
          }}
        >
          <div
            className="mt-0.5 w-2 h-2 rounded-full shrink-0"
            style={{ background: "var(--mk-accent)" }}
          />
          <div className="min-w-0 flex-1">
            <p
              className="text-[12px] font-medium"
              style={{ color: "var(--mk-accent)" }}
            >
              Ready in your TikTok inbox
            </p>
            <p className="text-[11px] text-mk-ink-60 mt-0.5">
              Open the TikTok app → Inbox → tap the upload notification to finish the caption and post.
              Drafts expire after ~7 days.
            </p>
            <a
              href="https://www.tiktok.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex mt-1.5 text-[11px] font-medium underline"
              style={{ color: "var(--mk-accent)" }}
            >
              Open TikTok
            </a>
          </div>
        </div>
      )}

      {/* Publishing overlay banner */}
      {publishing && (
        <div
          className="mx-4 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2"
          style={{
            background: "var(--mk-accent-soft)",
            borderColor: "color-mix(in oklch, var(--mk-accent) 30%, var(--mk-paper))",
          }}
        >
          <div
            className="w-3.5 h-3.5 rounded-full border-2 animate-spin shrink-0"
            style={{
              borderColor: "color-mix(in oklch, var(--mk-accent) 25%, var(--mk-paper))",
              borderTopColor: "var(--mk-accent)",
            }}
          />
          <p
            className="text-[12px] font-medium"
            style={{ color: "var(--mk-accent)" }}
          >
            Publishing to {channelLabel}...
          </p>
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
          name={channelLabel}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}
