"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import PostCard from "./PostCard";
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

export default function PublishedTab({ refreshKey }: { refreshKey: number }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

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
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">No published posts yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-2">Published posts will appear here with links to the live content.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const paginatedPosts = posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paginatedPosts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}
