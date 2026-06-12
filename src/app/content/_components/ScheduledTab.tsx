"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";
import ScheduleSheet from "./ScheduleSheet";
import PostGridSkeleton from "./PostGridSkeleton";
import Pagination from "@/components/app/Pagination";

const POSTS_PER_PAGE = 6;

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
  onCreatePost,
}: {
  refreshKey: number;
  onCreatePost?: () => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [reschedulePost, setReschedulePost] = useState<Post | null>(null);
  const [reschedulePending, setReschedulePending] = useState<{ content: string; mediaUrls?: string[] } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const fetchScheduled = useCallback(async () => {
    try {
      const res = await apiGet<{ posts: Post[] }>("/api/posts?status=scheduled");
      if (res.ok) setPosts(res.data.posts || []);
    } catch {
      toast.error("Failed to load scheduled posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScheduled();
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
      toast.success("Moved back to drafts");
      fetchScheduled();
    } else {
      restore();
      toast.error("Failed to cancel schedule");
    }
  };

  const handleDelete = async (id: string) => {
    const restore = removeOptimistic(id);
    const res = await apiDelete(`/api/posts/${id}`);
    if (res.ok) {
      toast.success("Post deleted");
    } else {
      restore();
      toast.error("Failed to delete post");
    }
  };

  const handlePublishNow = async (id: string, channel: string) => {
    if (publishingIds.has(id)) return;

    setPublishingIds((prev) => new Set(prev).add(id));

    const isTikTok = channel === "tiktok";
    const toastId = toast.loading(
      isTikTok ? "Pushing to TikTok inbox…" : "Publishing post…",
    );

    try {
      const res = await apiPost<{
        ok: boolean;
        status?: string;
        pending?: boolean;
        error?: string;
        channels?: Array<{ channel: string; success: boolean }>;
      }>(`/api/posts/${id}/publish`, {});

      if (res.ok && res.data.ok) {
        const hasTikTok = (res.data.channels || []).some((c) => c.channel === "tiktok");
        if (hasTikTok) {
          toast.success(
            "TikTok confirmed inbox delivery. Open the TikTok app to finalize and post.",
            { id: toastId },
          );
        } else if (res.data.status === "publishing" || res.data.pending) {
          toast.success("Post submitted and still processing.", { id: toastId });
        } else {
          toast.success("Posted!", { id: toastId });
        }
        // Post is no longer scheduled — drop it immediately, refetch in the background
        setPosts((cur) => cur.filter((p) => p.id !== id));
        fetchScheduled();
      } else {
        toast.error(res.data.error || "Publishing failed", { id: toastId });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Publishing failed",
        { id: toastId },
      );
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
      toast.success("Post updated");
    } else {
      setPosts((cur) => cur.map((p) => (p.id === target.id ? { ...p, ...prev } : p)));
      toast.error("Failed to update");
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
      toast.success("Post rescheduled");
      fetchScheduled();
    } else {
      setPosts((cur) => cur.map((p) => (p.id === target.id ? { ...p, ...prev } : p)));
      toast.error("Failed to reschedule");
    }
  };

  if (loading) {
    return <PostGridSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
        {onCreatePost && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onCreatePost}>
            Schedule your first post
          </Button>
        )}
      </div>
    );
  }

  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const paginatedPosts = posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

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

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      <PostEditSheet
        post={editPost}
        open={!!editPost}
        onOpenChange={(open) => !open && setEditPost(null)}
        onSave={handleSaveEdit}
        onSchedule={handleSaveAndReschedule}
        scheduleLabel="Save & Reschedule"
        title="Edit Scheduled Post"
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
