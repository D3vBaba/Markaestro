"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PostCard, { isManualQueuePost } from "./PostCard";
import PostEditSheet from "./PostEditSheet";
import ScheduleSheet from "./ScheduleSheet";
import PostGridSkeleton from "./PostGridSkeleton";
import Pagination from "@/components/app/Pagination";
import { isPlatformActionRequiredStatus, LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from "@/lib/tiktok-draft-flow";
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
  nextAction?: string;
  deliveryMode?: string;
  createdAt?: string;
  errorMessage?: string;
  mediaUrls?: string[];
};

export default function DraftsTab({
  refreshKey,
  productId,
  onCreatePost,
}: {
  refreshKey: number;
  /** Selected brand — scopes this tab to that brand's posts. */
  productId?: string;
  onCreatePost?: () => void;
}) {
  const t = useTranslations("content.draftsTab");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleChannel, setScheduleChannel] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [schedulePending, setSchedulePending] = useState<{ content: string; mediaUrls?: string[]; channel?: string } | null>(null);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // A different brand means a different result set — start from page 1.
  // Adjusted during render rather than in an effect so the new brand's first
  // render already shows page 1 instead of paging twice.
  const [pagedProductId, setPagedProductId] = useState(productId);
  if (productId !== pagedProductId) {
    setPagedProductId(productId);
    setPage(1);
  }

  const fetchDraftsPage = useCallback(async (cursor?: string, append = false) => {
    const scope = `&limit=${POSTS_FETCH_LIMIT}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    try {
      const statuses = [
        "draft",
        PLATFORM_ACTION_REQUIRED_STATUS,
        LEGACY_EXPORTED_FOR_REVIEW_STATUS,
        "failed",
        "partial_failed",
      ].join(",");
      const response = await apiGet<{ posts: Post[]; nextCursor?: string | null }>(`/api/posts?status=${statuses}${scope}`);
      if (response.ok) {
        const received = response.data.posts || [];
        setPosts((current) => append
          ? [...new Map([...current, ...received].map((post) => [post.id, post])).values()]
          : received);
        setNextCursor(response.data.nextCursor || null);
        return received;
      }
    } catch {
      toast.error(t("toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const fetchDrafts = useCallback(async () => {
    setPage(1);
    await fetchDraftsPage();
  }, [fetchDraftsPage]);

  const loadMoreDrafts = useCallback(async () => {
    if (!nextCursor) return false;
    const currentVisible = posts.filter((post) => !isPlatformActionRequiredStatus(post.status)).length;
    const received = await fetchDraftsPage(nextCursor, true);
    const receivedVisible = received.filter((post) => !isPlatformActionRequiredStatus(post.status)).length;
    return currentVisible >= page * POSTS_PER_PAGE &&
      currentVisible + receivedVisible > page * POSTS_PER_PAGE;
  }, [fetchDraftsPage, nextCursor, page, posts]);

  useEffect(() => {
    deferFromEffect(fetchDrafts);
  }, [fetchDrafts, refreshKey]);

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

  const handlePublish = async (id: string, channel: string) => {
    if (publishingIds.has(id)) return;

    setPublishingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const target = posts.find((p) => p.id === id);
    const isManual = target ? isManualQueuePost(target) : false;
    const isTikTok = channel === "tiktok";
    const loadingMessage = isManual
      ? t("toasts.addingToQueue")
      : isTikTok
        ? t("toasts.pushingTikTok")
        : t("toasts.publishingPost");
    const toastId = toast.loading(loadingMessage);

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
            outcome.manualReminder
              ? t("toasts.addedToQueue")
              : t("toasts.tiktokInboxConfirmed"),
            { id: toastId },
          );
          // These posts stay here while waiting on the user — flip the status locally
          setPosts((cur) =>
            cur.map((p) =>
              p.id === id
                ? {
                    ...p,
                    status: PLATFORM_ACTION_REQUIRED_STATUS,
                    nextAction: res.data.nextAction,
                  }
                : p,
            ),
          );
        } else {
          if (outcome.processing) {
            toast.success(
              outcome.hasTikTok
                ? t("toasts.tiktokProcessing")
                : t("toasts.stillProcessing"),
              { id: toastId },
            );
          } else {
            toast.success(t("toasts.posted"), { id: toastId });
          }
          // No longer a draft — drop it immediately
          setPosts((cur) => cur.filter((p) => p.id !== id));
        }
        // Background refetch keeps server-computed fields fresh without blocking the UI
        fetchDrafts();
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

  const handleScheduleFromEdit = (content: string, mediaUrls?: string[]) => {
    setSchedulePending({ content, mediaUrls, channel: editPost?.channel });
    setScheduleChannel(editPost?.channel);
    setScheduleOpen(true);
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!editPost || !schedulePending) return;
    const target = editPost;
    const pending = schedulePending;
    const restore = removeOptimistic(target.id);
    setEditPost(null);
    setSchedulePending(null);
    const res = await apiPut(`/api/posts/${target.id}`, {
      content: pending.content,
      mediaUrls: pending.mediaUrls ?? null,
      status: "scheduled",
      scheduledAt,
    });
    if (res.ok) {
      toast.success(t("toasts.scheduled"));
    } else {
      restore();
      toast.error(t("toasts.scheduleFailed"));
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
            {t("createFirst")}
          </Button>
        )}
      </div>
    );
  }

  // Posts waiting on the user aren't really drafts — surface them separately:
  // manual-queue posts the user publishes natively, and TikTok inbox handoffs.
  // Newest date first across all three fetched sets, so page 1 is the most
  // recent and paging walks backwards.
  const ordered = sortPostsByNewestDate(posts);
  const actionRequired = ordered.filter((p) => isPlatformActionRequiredStatus(p.status));
  const toPost = actionRequired.filter((p) => isManualQueuePost(p));
  const waitingInTikTok = actionRequired.filter((p) => !isManualQueuePost(p));
  const draftPosts = ordered.filter((p) => !isPlatformActionRequiredStatus(p.status));

  const totalPages = Math.ceil(draftPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = draftPosts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  const hasQueueSections = toPost.length > 0 || waitingInTikTok.length > 0;

  return (
    <>
      {toPost.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            {t("toPostHeading")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toPost.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onDelete={() => handleDelete(post.id)}
                onMarkedPosted={fetchDrafts}
              />
            ))}
          </div>
        </div>
      )}

      {waitingInTikTok.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            {t("waitingInTikTokHeading")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {waitingInTikTok.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onDelete={() => handleDelete(post.id)}
              />
            ))}
          </div>
        </div>
      )}

      {draftPosts.length > 0 && (
        <>
          {hasQueueSections && (
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              {t("draftsHeading")}
            </h3>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                publishing={publishingIds.has(post.id)}
                onEdit={() => setEditPost(post)}
                onDelete={() => handleDelete(post.id)}
                onPublish={() => handlePublish(post.id, post.channel)}
              />
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={Math.max(1, totalPages)}
            onPageChange={setPage}
            hasMore={Boolean(nextCursor)}
            onLoadMore={loadMoreDrafts}
          />
        </>
      )}

      {draftPosts.length === 0 && nextCursor && (
        <Pagination
          page={1}
          totalPages={1}
          onPageChange={setPage}
          hasMore
          onLoadMore={loadMoreDrafts}
        />
      )}

      <PostEditSheet
        post={editPost}
        open={!!editPost}
        onOpenChange={(open) => !open && setEditPost(null)}
        onSave={handleSaveEdit}
        onSchedule={handleScheduleFromEdit}
        title={t("editTitle")}
      />

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} channel={scheduleChannel} />
    </>
  );
}
