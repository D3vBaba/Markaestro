"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { AlertCircle } from "lucide-react";
import { apiDelete, apiGet } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import PostGridSkeleton from "./PostGridSkeleton";
import { getSocialChannelLabel } from "@/lib/social/channel-catalog";
import { Channel as ChannelIcon } from "@/components/mk/Channel";
import { copyText } from "@/lib/copy-text";

const CHANNELS = ["facebook", "instagram", "threads", "linkedin", "tiktok", "pinterest"] as const;
type Channel = (typeof CHANNELS)[number];

// Shared pill button style — mirrors PostCard's footer actions.
const pillBtn =
  "inline-flex items-center gap-1 px-3 py-2 sm:py-1 min-h-9 sm:min-h-0 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-accent bg-mk-paper";

type PlatformPost = {
  externalId: string;
  channel: Channel;
  content: string | null;
  mediaType: "text" | "image" | "video" | "carousel" | "unknown";
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  publishedAt: string | null;
  canDelete: boolean;
};

type ListResponse = {
  posts?: PlatformPost[];
  nextCursor?: string | null;
  error?: string;
  reason?: string;
  message?: string;
};

type Failure = { reason: string | null; message: string | null };

/** Deliberate, uniform empty/error state for the On Platform grid. */
function StateCard({
  tone = "neutral",
  icon,
  title,
  body,
  detail,
  children,
}: {
  tone?: "neutral" | "error";
  icon: React.ReactNode;
  title: string;
  body: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl py-12 sm:py-14 px-6 text-center"
      style={{
        background: "var(--mk-paper)",
        border: tone === "error" ? "1px solid var(--mk-rule)" : "1px dashed var(--mk-rule)",
      }}
    >
      <div
        className="mx-auto h-11 w-11 rounded-xl grid place-items-center mb-3.5"
        style={{ background: "var(--mk-panel)" }}
      >
        {icon}
      </div>
      <p
        className="text-[14px] font-medium m-0"
        style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
      >
        {title}
      </p>
      <p
        className="mt-1 mb-0 text-[13px] max-w-md mx-auto leading-relaxed"
        style={{ color: "var(--mk-ink-60)" }}
      >
        {body}
      </p>
      {detail && (
        <p
          className="mt-2 mb-0 font-mono text-[11px] max-w-md mx-auto wrap-break-word"
          style={{ color: "var(--mk-ink-40)" }}
        >
          {detail}
        </p>
      )}
      {children && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>
      )}
    </div>
  );
}

/** LinkedIn gates its list-posts API behind its partner program — retrying can't help. */
function isLinkedInPartnerRestriction(channel: Channel, failure: Failure) {
  return (
    channel === "linkedin" &&
    !!failure.message &&
    /not enough permissions|partnerApiPostsExternal/i.test(failure.message)
  );
}

function ChannelStates({
  channel,
  failure,
  productId,
  onRetry,
}: {
  channel: Channel;
  failure: Failure;
  productId: string;
  onRetry: () => void;
}) {
  const t = useTranslations("content.platformPostsTab");
  const label = getSocialChannelLabel(channel);
  const connectHref = `/products?open=${encodeURIComponent(productId)}&section=channels`;

  if (failure.reason === "not_connected") {
    return (
      <StateCard
        icon={<ChannelIcon channel={channel} size={22} />}
        title={t("states.notConnectedTitle", { channel: label })}
        body={t("states.notConnectedBody", { channel: label })}
      >
        <Button size="sm" className="rounded-lg" asChild>
          <Link href={connectHref}>{t("states.connect", { channel: label })}</Link>
        </Button>
      </StateCard>
    );
  }

  if (failure.reason === "auth") {
    return (
      <StateCard
        icon={<ChannelIcon channel={channel} size={22} />}
        title={t("states.authTitle", { channel: label })}
        body={t("states.authBody", { channel: label })}
      >
        <Button size="sm" className="rounded-lg" asChild>
          <Link href={connectHref}>{t("states.reconnect", { channel: label })}</Link>
        </Button>
        <Button size="sm" variant="outline" className="rounded-lg" onClick={onRetry}>
          {t("states.checkAgain")}
        </Button>
      </StateCard>
    );
  }

  if (failure.reason === "unsupported" || isLinkedInPartnerRestriction(channel, failure)) {
    return (
      <StateCard
        icon={<ChannelIcon channel={channel} size={22} />}
        title={t("states.unsupportedTitle", { channel: label })}
        body={
          isLinkedInPartnerRestriction(channel, failure)
            ? t("states.linkedinPartnerBody")
            : t("states.unsupportedBody", { channel: label })
        }
      />
    );
  }

  if (failure.reason || failure.message) {
    return (
      <StateCard
        tone="error"
        icon={<AlertCircle className="h-5 w-5" style={{ color: "var(--mk-ink-60)" }} />}
        title={t("states.errorTitle", { channel: label })}
        body={t("states.errorBody", { channel: label })}
      >
        <Button size="sm" variant="outline" className="rounded-lg" onClick={onRetry}>
          {t("states.tryAgain")}
        </Button>
      </StateCard>
    );
  }

  // Connected, no failure — the account simply has no posts yet.
  return (
    <StateCard
      icon={<ChannelIcon channel={channel} size={22} />}
      title={t("states.emptyTitle", { channel: label })}
      body={t("states.emptyBody", { channel: label })}
    >
      <Button size="sm" variant="outline" className="rounded-lg" onClick={onRetry}>
        {t("refresh")}
      </Button>
    </StateCard>
  );
}

function PlatformPostCard({
  post,
  onDelete,
  deleting,
}: {
  post: PlatformPost;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useTranslations("content.platformPostsTab");
  const locale = useLocale();
  const noDeleteHints: Partial<Record<Channel, string>> = {
    instagram: t("noDeleteHints.instagram"),
    tiktok: t("noDeleteHints.tiktok"),
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const thumbnail = post.thumbnailUrl || post.mediaUrl;
  const caption = post.content?.trim() ?? "";

  const handleCopyCaption = async () => {
    if (await copyText(caption)) {
      toast.success(t("toasts.captionCopied"));
    } else {
      toast.error(t("toasts.copyFailed"));
    }
  };

  return (
    <div className="group border border-border/50 rounded-xl overflow-hidden bg-card hover:border-border/80 hover:shadow-xs transition-[border-color,box-shadow] flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground/70">
            {getSocialChannelLabel(post.channel)}
          </span>
          {post.publishedAt && (
            <>
              <span className="w-px h-3 bg-border/60" />
              <span className="text-[11px] text-muted-foreground truncate">
                {new Date(post.publishedAt).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">
          {post.mediaType !== "unknown" ? post.mediaType : ""}
        </span>
      </div>

      {/* Media thumbnail */}
      {thumbnail && (
        <div className="border-b border-border/30">
          {post.mediaType === "video" && post.mediaUrl ? (
            <video
              src={post.mediaUrl}
              poster={post.thumbnailUrl || undefined}
              className="w-full object-contain bg-black max-h-48"
              controls
              playsInline
              preload="none"
            />
          ) : (
            <img
              src={thumbnail}
              alt=""
              className="w-full max-h-48 object-cover"
              loading="lazy"
            />
          )}
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3 flex-1">
        <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word line-clamp-4 text-foreground/80">
          {post.content || <span className="text-muted-foreground italic">{t("noCaption")}</span>}
        </p>
      </div>

      {/* Footer: actions */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noopener noreferrer">
            <button className={pillBtn}>{t("view")}</button>
          </a>
        )}
        {caption.length > 0 && (
          <button className={pillBtn} onClick={handleCopyCaption}>
            {t("copyCaption")}
          </button>
        )}
        {post.canDelete ? (
          <button
            className="inline-flex items-center gap-1 px-3 py-2 sm:py-1 min-h-9 sm:min-h-0 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-neg bg-mk-paper disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          >
            {deleting ? t("deleting") : t("delete")}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {noDeleteHints[post.channel] || t("noDeleteDefault")}
          </span>
        )}
      </div>

      {post.canDelete && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          entity="post"
          name={getSocialChannelLabel(post.channel)}
          warning={t("deleteWarning", { channel: getSocialChannelLabel(post.channel) })}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

export default function PlatformPostsTab({ productId }: { productId: string }) {
  const t = useTranslations("content.platformPostsTab");
  const [channel, setChannel] = useState<Channel>("facebook");
  const [posts, setPosts] = useState<PlatformPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const buildPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ channel });
      if (productId) params.set("productId", productId);
      if (cursor) params.set("cursor", cursor);
      return `/api/social/posts?${params.toString()}`;
    },
    [channel, productId],
  );

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    setPosts([]);
    setNextCursor(null);
    try {
      const res = await apiGet<ListResponse>(buildPath());
      if (res.ok) {
        setPosts(res.data.posts || []);
        setNextCursor(res.data.nextCursor ?? null);
      } else {
        setFailure({
          reason: res.data.reason ?? null,
          message: res.data.message ?? null,
        });
      }
    } catch {
      setFailure({ reason: "transient", message: null });
    } finally {
      setLoading(false);
    }
  }, [buildPath]);

  useEffect(() => {
    deferFromEffect(fetchPosts);
  }, [fetchPosts]);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await apiGet<ListResponse>(buildPath(nextCursor));
      if (res.ok) {
        const fresh = res.data.posts || [];
        setPosts((cur) => {
          const seen = new Set(cur.map((p) => p.externalId));
          return [...cur, ...fresh.filter((p) => !seen.has(p.externalId))];
        });
        setNextCursor(res.data.nextCursor ?? null);
      } else {
        toast.error(t("toasts.loadMoreFailed"));
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, buildPath, t]);

  // Infinite scroll: fetch the next page as soon as the sentinel below the
  // grid enters view, instead of waiting for a manual "load more" click.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!nextCursor) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nextCursor, loadMore]);

  const handleDelete = async (post: PlatformPost) => {
    setDeletingId(post.externalId);
    try {
      const params = new URLSearchParams({ channel: post.channel, externalId: post.externalId });
      if (productId) params.set("productId", productId);
      const res = await apiDelete<{ ok?: boolean; message?: string }>(
        `/api/social/posts?${params.toString()}`,
      );
      if (res.ok) {
        setPosts((cur) => cur.filter((p) => p.externalId !== post.externalId));
        toast.success(t("toasts.deleted", { channel: getSocialChannelLabel(post.channel) }));
      } else {
        toast.error(t("toasts.deleteFailed"));
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Channel picker */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHANNELS.map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`px-3 py-2 sm:py-1.5 min-h-9 sm:min-h-0 rounded-full border text-[12px] font-medium transition-colors whitespace-nowrap ${
              channel === c
                ? "border-foreground bg-foreground text-background"
                : "border-mk-rule text-mk-ink-60 bg-mk-paper hover:bg-mk-panel"
            }`}
          >
            {getSocialChannelLabel(c)}
          </button>
        ))}
        <button
          onClick={fetchPosts}
          disabled={loading}
          className="ms-auto px-3 py-2 sm:py-1.5 min-h-9 sm:min-h-0 rounded-full border border-mk-rule text-[12px] font-medium text-mk-accent bg-mk-paper hover:bg-mk-panel transition-colors disabled:opacity-60"
        >
          {t("refresh")}
        </button>
      </div>

      <p className="text-[12px] text-muted-foreground">
        {t("liveFrom", { channel: getSocialChannelLabel(channel) })}
      </p>

      {loading ? (
        <PostGridSkeleton />
      ) : failure || posts.length === 0 ? (
        <ChannelStates
          channel={channel}
          failure={failure ?? { reason: null, message: null }}
          productId={productId}
          onRetry={fetchPosts}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PlatformPostCard
                key={post.externalId}
                post={post}
                deleting={deletingId === post.externalId}
                onDelete={() => handleDelete(post)}
              />
            ))}
          </div>
          {nextCursor && (
            <div ref={sentinelRef} className="flex justify-center py-2 h-8">
              {loadingMore && (
                <span className="text-[12px] text-muted-foreground">{t("loading")}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
