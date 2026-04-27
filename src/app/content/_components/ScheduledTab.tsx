"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";
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

export default function ScheduledTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
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

  const handleCancel = async (id: string) => {
    const res = await apiPut(`/api/posts/${id}`, { status: "draft", scheduledAt: null });
    if (res.ok) {
      toast.success("Moved back to drafts");
      fetchScheduled();
    } else {
      toast.error("Failed to cancel schedule");
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/posts/${id}`);
    if (res.ok) {
      toast.success("Post deleted");
      fetchScheduled();
    } else {
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
    const res = await apiPut(`/api/posts/${editPost.id}`, { content, mediaUrls: mediaUrls ?? null });
    if (res.ok) {
      toast.success("Post updated");
      setEditPost(null);
      fetchScheduled();
    } else {
      toast.error("Failed to update");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No scheduled posts.</p>
        <p className="text-xs text-muted-foreground/60 mt-2">Schedule posts from the Create or Drafts tab.</p>
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
          />
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      <PostEditSheet
        post={editPost}
        open={!!editPost}
        onOpenChange={(open) => !open && setEditPost(null)}
        onSave={handleSaveEdit}
        title="Edit Scheduled Post"
      />
    </>
  );
}
