"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import PostGridSkeleton from "./PostGridSkeleton";
import { getSocialChannelLabel } from "@/lib/social/channel-catalog";

const CHANNELS = ["facebook", "instagram", "threads", "linkedin", "tiktok", "pinterest"] as const;
type Channel = (typeof CHANNELS)[number];

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

const NO_DELETE_HINTS: Partial<Record<Channel, string>> = {
  instagram: "Instagram doesn't allow apps to delete posts — remove them in the Instagram app.",
  tiktok: "TikTok doesn't allow apps to delete videos — remove them in the TikTok app.",
};

function PlatformPostCard({
  post,
  onDelete,
  deleting,
}: {
  post: PlatformPost;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const thumbnail = post.thumbnailUrl || post.mediaUrl;

  return (
    <div className="group border border-border/50 rounded-xl overflow-hidden bg-card hover:border-border/80 hover:shadow-sm transition-all flex flex-col">
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
                {new Date(post.publishedAt).toLocaleDateString(undefined, {
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
          {post.content || <span className="text-muted-foreground italic">No caption</span>}
        </p>
      </div>

      {/* Footer: actions */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noopener noreferrer">
            <button className="inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-accent bg-mk-paper">
              View
            </button>
          </a>
        )}
        {post.canDelete ? (
          <button
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap hover:bg-mk-panel border-mk-rule text-mk-neg bg-mk-paper disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {NO_DELETE_HINTS[post.channel] || "Deleting isn't supported for this post."}
          </span>
        )}
      </div>

      {post.canDelete && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          entity="post"
          name={getSocialChannelLabel(post.channel)}
          warning={`This permanently removes the post from ${getSocialChannelLabel(post.channel)}.`}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

export default function PlatformPostsTab({ productId }: { productId: string }) {
  const [channel, setChannel] = useState<Channel>("facebook");
  const [posts, setPosts] = useState<PlatformPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    setErrorMessage(null);
    setPosts([]);
    setNextCursor(null);
    try {
      const res = await apiGet<ListResponse>(buildPath());
      if (res.ok) {
        setPosts(res.data.posts || []);
        setNextCursor(res.data.nextCursor ?? null);
      } else {
        setErrorMessage(res.data.message || "Failed to load posts from the platform.");
      }
    } catch {
      setErrorMessage("Failed to load posts from the platform.");
    } finally {
      setLoading(false);
    }
  }, [buildPath]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const loadMore = async () => {
    if (!nextCursor) return;
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
        toast.error(res.data.message || "Failed to load more posts");
      }
    } finally {
      setLoadingMore(false);
    }
  };

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
        toast.success(`Post deleted from ${getSocialChannelLabel(post.channel)}`);
      } else {
        toast.error(res.data.message || "Failed to delete the post on the platform");
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
            className={`px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors whitespace-nowrap ${
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
          className="ml-auto px-3 py-1.5 rounded-full border border-mk-rule text-[12px] font-medium text-mk-accent bg-mk-paper hover:bg-mk-panel transition-colors disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Live posts from your connected {getSocialChannelLabel(channel)} account — including posts
        published outside Markaestro.
      </p>

      {loading ? (
        <PostGridSkeleton />
      ) : errorMessage ? (
        <div className="text-center py-16 px-4">
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{errorMessage}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchPosts}>
            Try again
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground">
            No posts found on {getSocialChannelLabel(channel)}.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
