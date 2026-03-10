"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import ContentEditor from "./ContentEditor";
import { Loader2, CalendarClock } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

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
};

export default function ScheduledTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState("");

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

  const openEdit = (post: Post) => {
    setEditPost(post);
    setEditContent(post.content);
  };

  const saveEdit = async () => {
    if (!editPost) return;
    const res = await apiPut(`/api/posts/${editPost.id}`, { content: editContent });
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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No scheduled posts.</p>
        <p className="text-xs mt-1">Schedule posts from the Create or Drafts tab.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onEdit={() => openEdit(post)}
            onDelete={() => handleCancel(post.id)}
            onPublish={() => handlePublishNow(post.id)}
          />
        ))}
      </div>

      <Sheet open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Scheduled Post</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-4">
            {editPost && (
              <ContentEditor content={editContent} onChange={setEditContent} channel={editPost.channel} />
            )}
          </div>
          <SheetFooter>
            <Button onClick={saveEdit}>Save Changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
