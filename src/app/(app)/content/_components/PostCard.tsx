"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import PlatformPreview from "@/components/app/PlatformPreview";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import MarkPostedDialog from "./MarkPostedDialog";
import { getSocialChannelLabel } from "@/lib/social/channel-catalog";
import { isPlatformActionRequiredStatus, LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from "@/lib/tiktok-draft-flow";
import { MANUAL_REMINDER_DELIVERY_MODE, MANUAL_REMINDER_NEXT_ACTION } from "@/lib/manual-publish-flow";
import { downloadMediaFiles } from "@/lib/download-media";
import { copyText } from "@/lib/copy-text";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Channel } from "@/components/mk/Channel";
import { cn } from "@/lib/utils";

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
  deliveryMode?: string;
  targetChannels?: string[];
  /** Present on drafts created by Intelligence ("Draft this"). */
  intelligence?: { kind?: string; rationale?: string | null } | null;
};

const channelAppUrls: Record<string, string> = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/",
  facebook: "https://www.facebook.com/",
  threads: "https://www.threads.net/",
  linkedin: "https://www.linkedin.com/",
  pinterest: "https://www.pinterest.com/",
};

export function isManualQueuePost(post: Pick<Post, "nextAction" | "deliveryMode">): boolean {
  return (
    post.nextAction === MANUAL_REMINDER_NEXT_ACTION ||
    post.deliveryMode === MANUAL_REMINDER_DELIVERY_MODE
  );
}

const STATUS_CHIP: Record<string, string> = {
  failed: "bg-mk-neg-soft text-mk-neg",
  partial_failed: "bg-mk-warn-soft text-mk-warn",
  published: "bg-mk-pos-soft text-mk-pos",
  scheduled: "bg-mk-accent-soft text-mk-accent",
  draft: "bg-muted text-mk-ink-80",
  publishing: "bg-mk-warn-soft text-mk-warn",
  [PLATFORM_ACTION_REQUIRED_STATUS]: "bg-mk-accent-soft text-mk-accent",
  [LEGACY_EXPORTED_FOR_REVIEW_STATUS]: "bg-mk-accent-soft text-mk-accent",
};

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-mk-accent/30 border-t-mk-accent", className)}
      aria-hidden
    />
  );
}

export default function PostCard({
  post,
  publishing = false,
  onEdit,
  onDelete,
  onCancel,
  onPublish,
  onReschedule,
  onMarkedPosted,
}: {
  post: Post;
  publishing?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onPublish?: () => void;
  onReschedule?: () => void;
  onMarkedPosted?: () => void;
}) {
  const t = useTranslations("content.postCard");
  const tScheduledToasts = useTranslations("content.scheduledTab.toasts");
  const locale = useLocale();
  const statusLabels: Record<string, string> = {
    [PLATFORM_ACTION_REQUIRED_STATUS]: t("readyInTikTok"),
    [LEGACY_EXPORTED_FOR_REVIEW_STATUS]: t("readyInTikTok"),
    partial_failed: t("partiallyFailed"),
  };
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [markPostedOpen, setMarkPostedOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const displayStatus = publishing ? "publishing" : post.status;
  const hasTikTokTarget = post.channel === "tiktok" || post.targetChannels?.includes("tiktok");
  const channelLabel = post.targetChannels?.length
    ? post.targetChannels.map(getSocialChannelLabel).join(" + ")
    : getSocialChannelLabel(post.channel);
  const inManualQueue = isPlatformActionRequiredStatus(post.status) && isManualQueuePost(post);
  const primaryChannelLabel = getSocialChannelLabel(post.channel);

  const handleCopyCaption = async () => {
    if (await copyText(post.content)) {
      toast.success(t("toasts.captionCopied"));
    } else {
      toast.error(t("toasts.copyFailed"));
    }
  };

  const handleDownloadMedia = async () => {
    if (downloading || !post.mediaUrls?.length) return;
    setDownloading(true);
    try {
      await downloadMediaFiles(post.mediaUrls);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Channel channel={post.channel} size={22} />
          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {channelLabel}
          </span>
          {post.scheduledAt && post.status === "scheduled" && (
            <>
              <span className="text-xs tabular-nums text-muted-foreground truncate">
                {new Date(post.scheduledAt).toLocaleString(locale, {
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
              <span className="text-xs tabular-nums text-muted-foreground truncate">
                {new Date(post.publishedAt ?? post.createdAt!).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {post.intelligence?.kind === "generated_draft" && (
            <span
              title={post.intelligence.rationale || undefined}
              className="hidden rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-medium leading-4 text-mk-ink-80 sm:inline-flex"
            >
              {t("fromIntelligence")}
            </span>
          )}
          {publishing && <Spinner className="size-3" />}
          <span
            className={cn(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11.5px] font-medium capitalize leading-4",
              STATUS_CHIP[displayStatus] || STATUS_CHIP.draft,
            )}
          >
            {inManualQueue && !publishing ? t("readyToPost") : statusLabels[displayStatus] || displayStatus}
          </span>
        </div>
      </div>

      {/* Media thumbnail */}
      {post.mediaUrls?.[0] && (
        <div className="border-y border-border bg-muted">
          {post.mediaUrls[0].match(/\.(mp4|mov|webm)(\?|$)/i) ? (
            <video
              src={post.mediaUrls[0]}
              className="max-h-48 w-full bg-black object-contain"
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <a href={post.mediaUrls[0]} target="_blank" rel="noopener noreferrer" className="block cursor-zoom-in">
              <img
                src={post.mediaUrls[0]}
                alt=""
                className="max-h-48 w-full object-cover"
                loading="lazy"
              />
            </a>
          )}
        </div>
      )}

      {/* Content / preview */}
      <div className="px-4 pb-4 pt-1">
        {showPreview ? (
          <PlatformPreview
            content={post.content}
            channel={post.channel}
            mediaUrls={post.mediaUrls}
            externalUrl={post.externalUrl}
          />
        ) : (
          <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[13px] leading-5 text-mk-ink-80 wrap-break-word">
            {post.content}
          </p>
        )}

        {post.errorMessage && (
          <p className="m-0 mt-3 rounded-lg bg-mk-neg-soft px-3 py-2 text-xs text-mk-neg">
            {tScheduledToasts("publishFailed")}
          </p>
        )}
      </div>

      {/* Manual posting banner */}
      {!publishing && inManualQueue && (
        <div className="mx-4 mb-4 rounded-lg bg-mk-accent-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold text-foreground">
              {t("readyToPostOn", { channel: primaryChannelLabel })}
            </p>
            <p className="m-0 mt-0.5 text-xs leading-4 text-mk-ink-80">
              {t("manualInstructions", { channel: primaryChannelLabel })}
            </p>
            {channelAppUrls[post.channel] && (
              <a
                href={channelAppUrls[post.channel]}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex text-xs font-medium text-mk-accent underline underline-offset-4"
              >
                {t("openChannel", { channel: primaryChannelLabel })}
              </a>
            )}
          </div>
        </div>
      )}

      {/* TikTok inbox banner */}
      {!publishing && !inManualQueue && isPlatformActionRequiredStatus(post.status) && hasTikTokTarget && (
        <div className="mx-4 mb-4 rounded-lg bg-mk-accent-soft p-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold text-foreground">
              {t("readyInTikTokInbox")}
            </p>
            <p className="m-0 mt-0.5 text-xs leading-4 text-mk-ink-80">
              {t("tiktokInboxInstructions")}
            </p>
            <a
              href="https://www.tiktok.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex text-xs font-medium text-mk-accent underline underline-offset-4"
            >
              {t("openTikTok")}
            </a>
          </div>
        </div>
      )}

      {/* Publishing overlay banner */}
      {publishing && (
        <div className="mx-4 mb-4 flex items-center gap-2.5 rounded-lg bg-mk-accent-soft p-3">
          <Spinner />
          <p className="m-0 text-xs font-medium text-foreground">
            {t("publishingTo", { channel: channelLabel })}
          </p>
        </div>
      )}

      {/* Footer: actions. Primary action on the right, the rest as quiet buttons. */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2.5">
        <Button variant="ghost" size="xs" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? t("text") : t("preview")}
        </Button>

        {post.externalUrl && (
          <Button variant="ghost" size="xs" asChild>
            <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">{t("view")}</a>
          </Button>
        )}

        {Boolean(post.content?.trim()) && (
          <Button variant="ghost" size="xs" onClick={handleCopyCaption}>
            {t("copyCaption")}
          </Button>
        )}

        {onEdit && (
          <Button variant="ghost" size="xs" onClick={onEdit}>
            {t("edit")}
          </Button>
        )}

        {onReschedule && (
          <Button variant="ghost" size="xs" onClick={onReschedule}>
            {t("reschedule")}
          </Button>
        )}

        {onCancel && (
          <Button variant="ghost" size="xs" onClick={onCancel}>
            {t("unschedule")}
          </Button>
        )}

        {onDelete && (
          <Button variant="ghost" size="xs" className="text-mk-neg hover:bg-mk-neg-soft hover:text-mk-neg" onClick={() => setConfirmDelete(true)}>
            {t("delete")}
          </Button>
        )}

        <span className="flex-1" />

        {inManualQueue && (post.mediaUrls?.length ?? 0) > 0 && (
          <Button variant="outline" size="xs" onClick={handleDownloadMedia} disabled={downloading}>
            {downloading ? t("downloading") : t("downloadMedia")}
          </Button>
        )}
        {inManualQueue && (
          <Button size="xs" onClick={() => setMarkPostedOpen(true)}>
            {t("markAsPosted")}
          </Button>
        )}
        {onPublish && (
          <Button size="xs" onClick={publishing ? undefined : onPublish} disabled={publishing}>
            {publishing ? t("publishing") : t("publish")}
          </Button>
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

      {inManualQueue && (
        <MarkPostedDialog
          open={markPostedOpen}
          onOpenChange={setMarkPostedOpen}
          postId={post.id}
          channelLabel={primaryChannelLabel}
          onMarked={onMarkedPosted}
        />
      )}
    </div>
  );
}
