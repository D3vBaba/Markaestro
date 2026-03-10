"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import ContentEditor from "./ContentEditor";
import ScheduleSheet from "./ScheduleSheet";
import { Loader2, FileText } from "lucide-react";
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

export default function DraftsTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulePostId, setSchedulePostId] = useState<string | null>(null);

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
    const res = await apiPost<{ ok: boolean; error?: string }>(`/api/posts/${id}/publish`, {});
    if (res.ok && res.data.ok) {
      toast.success("Posted!");
      fetchDrafts();
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
      toast.success("Draft updated");
      setEditPost(null);
      fetchDrafts();
    } else {
      toast.error("Failed to update");
    }
  };

  const openSchedule = (postId: string) => {
    setSchedulePostId(postId);
    setScheduleOpen(true);
  };

  const handleSchedule = async (scheduledAt: string) => {
    if (!schedulePostId) return;
    const res = await apiPut(`/api/posts/${schedulePostId}`, { status: "scheduled", scheduledAt });
    if (res.ok) {
      toast.success("Post scheduled");
      fetchDrafts();
    } else {
      toast.error("Failed to schedule");
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
        <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No drafts yet.</p>
        <p className="text-xs mt-1">Generate content from the Create tab to see drafts here.</p>
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
            onDelete={() => handleDelete(post.id)}
            onPublish={() => handlePublish(post.id)}
          />
        ))}
      </div>

      {/* Edit Sheet */}
      <Sheet open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Draft</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-4">
            {editPost && (
              <ContentEditor content={editContent} onChange={setEditContent} channel={editPost.channel} />
            )}
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => editPost && openSchedule(editPost.id)}>Schedule</Button>
            <Button onClick={saveEdit}>Save</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ScheduleSheet open={scheduleOpen} onOpenChange={setScheduleOpen} onSchedule={handleSchedule} />
    </>
  );
}
