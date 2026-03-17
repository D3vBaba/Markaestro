"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";

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
      toast.error("Failed to delete");
    }
  };

  const handlePublishNow = async (id: string) => {
    const res = await apiPost<{ ok: boolean; error?: string }>(`/api/posts/${id}/publish`, {});
    if (res.ok && res.data.ok) {
      toast.success("Posted!");
      fetchScheduled();
    } else {
      toast.error(res.data.error || "Publishing failed");
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

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onEdit={() => setEditPost(post)}
            onDelete={() => handleCancel(post.id)}
            onPublish={() => handlePublishNow(post.id)}
          />
        ))}
      </div>

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
