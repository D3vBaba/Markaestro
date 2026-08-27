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

const statusDotColors: Record<string, string> = {
  draft: "bg-slate-400",
  scheduled: "bg-blue-500",
  published: "bg-emerald-500",
  failed: "bg-rose-500",
  partial_failed: "bg-amber-500",
  publishing: "bg-amber-500",
  [PLATFORM_ACTION_REQUIRED_STATUS]: "bg-blue-500",
  [LEGACY_EXPORTED_FOR_REVIEW_STATUS]: "bg-blue-500",
};

const statusBadgeStyles: Record<string, string> = {
  failed: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/60 dark:border-rose-800/40",
  partial_failed: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40",
  published: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40",
  scheduled: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/40",
  draft: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  publishing: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40",
  [PLATFORM_ACTION_REQUIRED_STATUS]: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/40",
  [LEGACY_EXPORTED_FOR_REVIEW_STATUS]: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/40",
};

// Modern action button styles
const pillBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] whitespace-nowrap bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs cursor-pointer";
const pillBtnPrimary =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-[color,background-color,transform] duration-150 active:scale-[0.98] whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer";
const pillBtnDestructive =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] whitespace-nowrap bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-200 dark:hover:border-rose-900/40 shadow-2xs cursor-pointer";
const pillBtnDisabled =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap border-slate-200 dark:border-slate-800 text-slate-400 bg-slate-50 dark:bg-slate-850 cursor-not-allowed opacity-60";


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
    <div className="group rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800/60">
        {/* Left: channel + scheduled date */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 truncate min-w-0">

            {channelLabel}
          </span>
          {post.scheduledAt && post.status === "scheduled" && (
            <>
              <span className="w-px h-3 bg-border/60" />
              <span className="text-[11px] text-muted-foreground truncate">
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
              <span className="w-px h-3 bg-border/60" />
              <span className="text-[11px] text-muted-foreground truncate">
                {new Date(post.publishedAt ?? post.createdAt!).toLocaleDateString(locale, {
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
            <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-blue-600 animate-spin" />
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold border capitalize ${
              statusBadgeStyles[displayStatus] || statusBadgeStyles.draft
            }`}
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${statusDotColors[displayStatus] || "bg-slate-400"}`}
            />
            {inManualQueue && !publishing ? t("readyToPost") : statusLabels[displayStatus] || displayStatus}
          </span>
        </div>
      </div>

      {/* Media thumbnail */}
      {post.mediaUrls?.[0] && (
        <div className="border-b border-slate-100 dark:border-slate-800">
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
      <div className="px-5 py-4">
        {showPreview ? (
          <PlatformPreview
            content={post.content}
            channel={post.channel}
            mediaUrls={post.mediaUrls}
            externalUrl={post.externalUrl}
          />
        ) : (
          <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap wrap-break-word line-clamp-4 text-slate-700 dark:text-slate-300">
            {post.content}
          </p>
        )}

        {post.errorMessage && (
          <p className="mt-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/60 dark:border-rose-800/40 rounded-xl px-3 py-2">
            {tScheduledToasts("publishFailed")}
          </p>
        )}
      </div>

      {/* Manual posting banner */}
      {!publishing && inManualQueue && (
        <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border p-3 bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-800/40">
          <div className="mt-1 w-2 h-2 rounded-full shrink-0 bg-blue-600 dark:bg-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
              {t("readyToPostOn", { channel: primaryChannelLabel })}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              {t("manualInstructions", { channel: primaryChannelLabel })}
            </p>
            {channelAppUrls[post.channel] && (
              <a
                href={channelAppUrls[post.channel]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex mt-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 underline"
              >
                {t("openChannel", { channel: primaryChannelLabel })}
              </a>
            )}
          </div>
        </div>
      )}

      {/* TikTok inbox banner */}
      {!publishing && !inManualQueue && isPlatformActionRequiredStatus(post.status) && hasTikTokTarget && (
        <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border p-3 bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-800/40">
          <div className="mt-1 w-2 h-2 rounded-full shrink-0 bg-blue-600 dark:bg-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
              {t("readyInTikTokInbox")}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
              {t("tiktokInboxInstructions")}
            </p>
            <a
              href="https://www.tiktok.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex mt-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 underline"
            >
              {t("openTikTok")}
            </a>
          </div>
        </div>
      )}

      {/* Publishing overlay banner */}
      {publishing && (
        <div className="mx-5 mb-4 flex items-center gap-2.5 rounded-xl border p-3 bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-800/40">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-blue-600 animate-spin shrink-0" />
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
            {t("publishingTo", { channel: channelLabel })}
          </p>
        </div>
      )}

      {/* Footer: action buttons */}
      <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
        <button
          className={pillBtn}
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? t("text") : t("preview")}
        </button>

        {post.externalUrl && (
          <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
            <button className={pillBtn}>{t("view")}</button>
          </a>
        )}

        {Boolean(post.content?.trim()) && (
          <button className={pillBtn} onClick={handleCopyCaption}>
            {t("copyCaption")}
          </button>
        )}

        {inManualQueue && (
          <>
            {(post.mediaUrls?.length ?? 0) > 0 && (
              <button
                className={downloading ? pillBtnDisabled : pillBtn}
                onClick={handleDownloadMedia}
                disabled={downloading}
              >
                {downloading ? t("downloading") : t("downloadMedia")}
              </button>
            )}
            <button className={pillBtnPrimary} onClick={() => setMarkPostedOpen(true)}>
              {t("markAsPosted")}
            </button>
          </>
        )}

        {onEdit && (
          <button className={pillBtn} onClick={onEdit}>
            {t("edit")}
          </button>
        )}

        {onPublish && (
          <button
            className={publishing ? pillBtnDisabled : pillBtnPrimary}
            onClick={publishing ? undefined : onPublish}
            disabled={publishing}
          >
            {publishing ? t("publishing") : t("publish")}
          </button>
        )}

        {onReschedule && (
          <button className={pillBtn} onClick={onReschedule}>
            {t("reschedule")}
          </button>
        )}

        {onCancel && (
          <button className={pillBtn} onClick={onCancel}>
            {t("unschedule")}
          </button>
        )}

        {onDelete && (
          <button className={pillBtnDestructive} onClick={() => setConfirmDelete(true)}>
            {t("delete")}
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
