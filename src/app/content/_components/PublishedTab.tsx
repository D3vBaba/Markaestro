"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
import { Loader2, CheckCircle2 } from "lucide-react";

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

export default function PublishedTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPublished = useCallback(async () => {
    try {
      const res = await apiGet<{ posts: Post[] }>("/api/posts?status=published");
      if (res.ok) setPosts(res.data.posts || []);
    } catch {
      toast.error("Failed to load published posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublished();
  }, [fetchPublished, refreshKey]);

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
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No published posts yet.</p>
        <p className="text-xs mt-1">Published posts will appear here with links to the live content.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
