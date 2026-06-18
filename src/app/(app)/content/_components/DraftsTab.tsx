"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";
import ScheduleSheet from "./ScheduleSheet";
import PostGridSkeleton from "./PostGridSkeleton";
import Pagination from "@/components/app/Pagination";
import { isPlatformActionRequiredStatus, LEGACY_EXPORTED_FOR_REVIEW_STATUS, PLATFORM_ACTION_REQUIRED_STATUS } from "@/lib/tiktok-draft-flow";

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

export default function DraftsTab({
  refreshKey,
  onCreatePost,
}: {
  refreshKey: number;
  onCreatePost?: () => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleChannel, setScheduleChannel] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [schedulePending, setSchedulePending] = useState<{ content: string; mediaUrls?: string[]; channel?: string } | null>(null);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());

  const fetchDrafts = useCallback(async () => {
    try {
      const [draftsRes, reviewRes, failedRes] = await Promise.all([
        apiGet<{ posts: Post[] }>("/api/posts?status=draft"),
        apiGet<{ posts: Post[] }>(`/api/posts?status=${PLATFORM_ACTION_REQUIRED_STATUS},${LEGACY_EXPORTED_FOR_REVIEW_STATUS}`),
        apiGet<{ posts: Post[] }>("/api/posts?status=failed,partial_failed"),
      ]);
      const drafts = draftsRes.ok ? (draftsRes.data.posts || []) : [];
      const reviewReady = reviewRes.ok ? (reviewRes.data.posts || []) : [];
      const failed = failedRes.ok ? (failedRes.data.posts || []) : [];
      const all = [...reviewReady, ...failed, ...drafts].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      setPosts(all);
    } catch {
      toast.error("Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
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
      toast.success("Draft deleted");
    } else {
      restore();
      toast.error("Failed to delete");
    }
  };

  const handlePublish = async (id: string, channel: string) => {
    if (publishingIds.has(id)) return;

    setPublishingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const isTikTok = channel === "tiktok";
    const loadingMessage = isTikTok
      ? "Pushing to TikTok inbox…"
      : "Publishing post…";
    const toastId = toast.loading(loadingMessage);

    try {
      const res = await apiPost<{
        ok: boolean;
        status?: string;
        pending?: boolean;
        error?: string;
        channels?: Array<{ channel: string; success: boolean; pending?: boolean }>;
      }>(`/api/posts/${id}/publish`, {});

      if (res.ok && res.data.ok) {
        const hasTikTok = (res.data.channels || []).some((c) => c.channel === "tiktok");
        if (hasTikTok) {
          toast.success(
            "TikTok confirmed inbox delivery. Open the TikTok app to finalize and post.",
            { id: toastId },
          );
          // TikTok posts stay here while waiting in the inbox — flip the status locally
          setPosts((cur) =>
            cur.map((p) => (p.id === id ? { ...p, status: PLATFORM_ACTION_REQUIRED_STATUS } : p)),
          );
        } else {
          if (res.data.status === "publishing" || res.data.pending) {
            toast.success("Post submitted and still processing.", { id: toastId });
          } else {
            toast.success("Posted!", { id: toastId });
          }
          // No longer a draft — drop it immediately
          setPosts((cur) => cur.filter((p) => p.id !== id));
        }
        // Background refetch keeps server-computed fields fresh without blocking the UI
        fetchDrafts();
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
      toast.success("Draft updated");
    } else {
      setPosts((cur) => cur.map((p) => (p.id === target.id ? { ...p, ...prev } : p)));
      toast.error("Failed to update");
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
      toast.success("Post scheduled");
    } else {
      restore();
      toast.error("Failed to schedule");
    }
  };

  if (loading) {
    return <PostGridSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No drafts yet.</p>
        {onCreatePost && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onCreatePost}>
            Create your first post
          </Button>
        )}
      </div>
    );
  }

  // Posts pushed to the TikTok inbox aren't really drafts — surface them separately.
  const waitingInTikTok = posts.filter((p) => isPlatformActionRequiredStatus(p.status));
  const draftPosts = posts.filter((p) => !isPlatformActionRequiredStatus(p.status));

  const totalPages = Math.ceil(draftPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = draftPosts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (
    <>
      {waitingInTikTok.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Waiting in TikTok
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
          {waitingInTikTok.length > 0 && (
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Drafts
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

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      <PostEditSheet
        post={editPost}
        open={!!editPost}
        onOpenChange={(open) => !open && setEditPost(null)}
        onSave={handleSaveEdit}
        onSchedule={handleScheduleFromEdit}
        title="Edit Draft"
      />

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} channel={scheduleChannel} />
    </>
  );
}
