"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import PostEditSheet from "./PostEditSheet";
import ScheduleSheet from "./ScheduleSheet";
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

export default function DraftsTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleChannel, setScheduleChannel] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [schedulePending, setSchedulePending] = useState<{ content: string; mediaUrls?: string[]; channel?: string } | null>(null);

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await apiGet<{ posts: Post[] }>("/api/posts?status=draft");
      if (res.ok) setPosts(res.data.posts || []);
    } catch {
      toast.error("Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts, refreshKey]);

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/posts/${id}`);
    if (res.ok) {
      toast.success("Draft deleted");
      fetchDrafts();
    } else {
      toast.error("Failed to delete");
    }
  };

  const handlePublish = async (id: string) => {
    const res = await apiPost<{
      ok: boolean;
      status?: string;
      pending?: boolean;
      error?: string;
      channels?: Array<{ channel: string; success: boolean }>;
    }>(`/api/posts/${id}/publish`, {});
    if (res.ok && res.data.ok) {
      const hasTikTok = (res.data.channels || []).some((c) => c.channel === "tiktok");
      if (res.data.status === "publishing" || res.data.pending) {
        toast.success(
          hasTikTok
            ? "TikTok accepted the upload. It can take a minute to appear, and Direct Post will not create an inbox draft."
            : "Post submitted and still processing.",
        );
      } else if (hasTikTok) {
        toast.success("TikTok posted. Check the connected account's private posts, not drafts or inbox notifications.");
      } else {
        toast.success("Posted!");
      }
      fetchDrafts();
    } else {
      toast.error(res.data.error || "Publishing failed");
    }
  };

  const handleSaveEdit = async (content: string, mediaUrls?: string[]) => {
    if (!editPost) return;
    const res = await apiPut(`/api/posts/${editPost.id}`, { content, mediaUrls: mediaUrls ?? null });
    if (res.ok) {
      toast.success("Draft updated");
      setEditPost(null);
      fetchDrafts();
    } else {
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
    const res = await apiPut(`/api/posts/${editPost.id}`, {
      content: schedulePending.content,
      mediaUrls: schedulePending.mediaUrls ?? null,
      status: "scheduled",
      scheduledAt,
    });
    if (res.ok) {
      toast.success("Post scheduled");
      setEditPost(null);
      setSchedulePending(null);
      fetchDrafts();
    } else {
      toast.error("Failed to schedule");
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
        <p className="text-sm text-muted-foreground">No drafts yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-2">Generate content from the Create tab to see drafts here.</p>
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
            onEdit={() => setEditPost(post)}
            onDelete={() => handleDelete(post.id)}
            onPublish={() => handlePublish(post.id)}
          />
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

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
