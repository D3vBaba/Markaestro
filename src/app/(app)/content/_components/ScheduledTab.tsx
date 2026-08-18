"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";
import ScheduleSheet from "./ScheduleSheet";
import PostGridSkeleton from "./PostGridSkeleton";
import Pagination from "@/components/app/Pagination";
import { getPublishUiOutcome } from "@/lib/social/publish-ui-outcome";
import { sortPostsByNewestDate } from "@/lib/post-ordering";
import { userFacingError } from "@/lib/user-facing-errors";

const POSTS_PER_PAGE = 6;
const POSTS_FETCH_LIMIT = 60;

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

export default function ScheduledTab({
  refreshKey,
  productId,
  onCreatePost,
  onPlatformActionRequired,
}: {
  refreshKey: number;
  /** Selected brand — scopes this tab to that brand's posts. */
  productId?: string;
  onCreatePost?: () => void;
  onPlatformActionRequired?: () => void;
}) {
  const t = useTranslations("content.scheduledTab");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [reschedulePost, setReschedulePost] = useState<Post | null>(null);
  const [reschedulePending, setReschedulePending] = useState<{ content: string; mediaUrls?: string[] } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // A different brand means a different result set — start from page 1.
  // Adjusted during render rather than in an effect so the new brand's first
  // render already shows page 1 instead of paging twice.
  const [pagedProductId, setPagedProductId] = useState(productId);
  if (productId !== pagedProductId) {
    setPagedProductId(productId);
    setPage(1);
  }

  const fetchScheduledPage = useCallback(async (cursor?: string, append = false) => {
    try {
      const res = await apiGet<{ posts: Post[]; nextCursor?: string | null }>(
        `/api/posts?status=scheduled&limit=${POSTS_FETCH_LIMIT}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      );
      if (res.ok) {
        const received = res.data.posts || [];
        setPosts((current) => append
          ? [...new Map([...current, ...received].map((post) => [post.id, post])).values()]
          : received);
        setNextCursor(res.data.nextCursor || null);
        return received.length > 0;
      }
    } catch {
      toast.error(t("toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const fetchScheduled = useCallback(async () => {
    setPage(1);
    await fetchScheduledPage();
  }, [fetchScheduledPage]);

  const loadMoreScheduled = useCallback(async () => {
    if (!nextCursor) return false;
    const currentPageIsFull = posts.length >= page * POSTS_PER_PAGE;
    const loaded = await fetchScheduledPage(nextCursor, true);
    return currentPageIsFull && loaded;
  }, [fetchScheduledPage, nextCursor, page, posts.length]);

  useEffect(() => {
    deferFromEffect(fetchScheduled);
  }, [fetchScheduled, refreshKey]);

  // Remove a post from the list immediately; returns a function that restores it in place.
  const removeOptimistic = (id: string) => {
    const idx = posts.findIndex((p) => p.id === id);
    const removed = idx >= 0 ? posts[idx] : null;
    setPosts((cur) => cur.filter((p) => p.id !== id));
    return () => {
      if (!removed) return;
      setPosts((cur) => {
        const next = cur.filter((p) => p.id !== id);
        next.splice(Math.min(idx, next.length), 0, removed);
        return next;
      });
    };
  };

  const handleCancel = async (id: string) => {
    const restore = removeOptimistic(id);
    const res = await apiPut(`/api/posts/${id}`, { status: "draft", scheduledAt: null });
    if (res.ok) {
      toast.success(t("toasts.movedToDrafts"));
      fetchScheduled();
    } else {
      restore();
      toast.error(t("toasts.cancelFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    const restore = removeOptimistic(id);
    const res = await apiDelete(`/api/posts/${id}`);
    if (res.ok) {
      toast.success(t("toasts.deleted"));
    } else {
      restore();
      toast.error(t("toasts.deleteFailed"));
    }
  };

  const handlePublishNow = async (id: string, channel: string) => {
    if (publishingIds.has(id)) return;

    setPublishingIds((prev) => new Set(prev).add(id));

    const isTikTok = channel === "tiktok";
    const toastId = toast.loading(
      isTikTok ? t("toasts.pushingTikTok") : t("toasts.publishingPost"),
    );

    try {
      const res = await apiPost<{
        ok: boolean;
        status?: string;
        pending?: boolean;
        nextAction?: string;
        error?: string;
        channels?: Array<{ channel: string; success: boolean; pending?: boolean }>;
      }>(`/api/posts/${id}/publish`, {});

      if (res.ok && res.data.ok) {
        const outcome = getPublishUiOutcome(res.data);
        if (outcome.platformActionRequired) {
          toast.success(
            t("toasts.tiktokInboxConfirmed"),
            { id: toastId },
          );
          onPlatformActionRequired?.();
        } else if (outcome.processing) {
          toast.success(
            outcome.hasTikTok
              ? t("toasts.tiktokProcessing")
              : t("toasts.stillProcessing"),
            { id: toastId },
          );
        } else {
          toast.success(t("toasts.posted"), { id: toastId });
        }
        // Post is no longer scheduled — drop it immediately, refetch in the background
        setPosts((cur) => cur.filter((p) => p.id !== id));
        fetchScheduled();
      } else {
        toast.error(userFacingError(res.data, t("toasts.publishFailed")), { id: toastId });
      }
    } catch {
      toast.error(t("toasts.publishFailed"), { id: toastId });
    } finally {
      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSaveEdit = async (content: string, mediaUrls?: string[]) => {
    if (!editPost) return;
    const target = editPost;
    const prev = { content: target.content, mediaUrls: target.mediaUrls };
    setPosts((cur) =>
      cur.map((p) => (p.id === target.id ? { ...p, content, mediaUrls } : p)),
    );
    setEditPost(null);
    const res = await apiPut(`/api/posts/${target.id}`, { content, mediaUrls: mediaUrls ?? null });
    if (res.ok) {
      toast.success(t("toasts.updated"));
    } else {
      setPosts((cur) => cur.map((p) => (p.id === target.id ? { ...p, ...prev } : p)));
      toast.error(t("toasts.updateFailed"));
    }
  };

  // "Save & Reschedule" from the edit sheet: stash the edited content,
  // then pick the new time — both are saved in a single update.
  const handleSaveAndReschedule = (content: string, mediaUrls?: string[]) => {
    if (!editPost) return;
    setReschedulePost(editPost);
    setReschedulePending({ content, mediaUrls });
    setEditPost(null);
    setScheduleOpen(true);
  };

  const openReschedule = (post: Post) => {
    setReschedulePost(post);
    setReschedulePending(null);
    setScheduleOpen(true);
  };

  const handleReschedule = async (scheduledAt: string) => {
    if (!reschedulePost) return;
    const target = reschedulePost;
    const pending = reschedulePending;
    const prev = {
      scheduledAt: target.scheduledAt,
      content: target.content,
      mediaUrls: target.mediaUrls,
    };
    setPosts((cur) =>
      cur.map((p) =>
        p.id === target.id
          ? { ...p, scheduledAt, ...(pending ? { content: pending.content, mediaUrls: pending.mediaUrls } : {}) }
          : p,
      ),
    );
    const res = await apiPut(`/api/posts/${target.id}`, {
      ...(pending ? { content: pending.content, mediaUrls: pending.mediaUrls ?? null } : {}),
      status: "scheduled",
      scheduledAt,
    });
    if (res.ok) {
      toast.success(t("toasts.rescheduled"));
      fetchScheduled();
    } else {
      setPosts((cur) => cur.map((p) => (p.id === target.id ? { ...p, ...prev } : p)));
      toast.error(t("toasts.rescheduleFailed"));
    }
  };

  if (loading) {
    return <PostGridSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
        {onCreatePost && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onCreatePost}>
            {t("scheduleFirst")}
          </Button>
        )}
      </div>
    );
  }

  // Sorted at render, not at fetch, so an optimistic reschedule re-orders the
  // list immediately instead of waiting for the refetch.
  const ordered = sortPostsByNewestDate(posts);
  const totalPages = Math.ceil(ordered.length / POSTS_PER_PAGE);
  const paginatedPosts = ordered.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paginatedPosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            publishing={publishingIds.has(post.id)}
            onEdit={() => setEditPost(post)}
            onCancel={() => handleCancel(post.id)}
            onDelete={() => handleDelete(post.id)}
            onPublish={() => handlePublishNow(post.id, post.channel)}
            onReschedule={() => openReschedule(post)}
          />
        ))}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        hasMore={Boolean(nextCursor)}
        onLoadMore={loadMoreScheduled}
      />

      <PostEditSheet
        post={editPost}
        open={!!editPost}
        onOpenChange={(open) => !open && setEditPost(null)}
        onSave={handleSaveEdit}
        onSchedule={handleSaveAndReschedule}
        scheduleLabel={t("saveAndReschedule")}
        title={t("editTitle")}
      />

      <ScheduleSheet
        open={scheduleOpen}
        onOpenChange={(open) => {
          setScheduleOpen(open);
          if (!open) {
            setReschedulePost(null);
            setReschedulePending(null);
          }
        }}
        onSchedule={handleReschedule}
        channel={reschedulePost?.channel}
        initialDate={reschedulePost?.scheduledAt}
        excludePostId={reschedulePost?.id}
      />
    </>
  );
}
