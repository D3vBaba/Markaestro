"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiDelete } from "@/lib/api-client";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PostCard from "./PostCard";
import PostGridSkeleton from "./PostGridSkeleton";
import Pagination from "@/components/app/Pagination";
import { sortPostsByNewestDate } from "@/lib/post-ordering";

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
  createdAt?: string;
  errorMessage?: string;
  mediaUrls?: string[];
};

export default function PublishedTab({
  refreshKey,
  productId,
  onCreatePost,
}: {
  refreshKey: number;
  /** Selected brand — scopes this tab to that brand's posts. */
  productId?: string;
  onCreatePost?: () => void;
}) {
  const t = useTranslations("content.publishedTab");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // A different brand means a different result set — start from page 1.
  // Adjusted during render rather than in an effect so the new brand's first
  // render already shows page 1 instead of paging twice.
  const [pagedProductId, setPagedProductId] = useState(productId);
  if (productId !== pagedProductId) {
    setPagedProductId(productId);
    setPage(1);
  }

  const handleDelete = async (id: string) => {
    // Optimistically remove, restore in place on failure
    const idx = posts.findIndex((p) => p.id === id);
    const removed = idx >= 0 ? posts[idx] : null;
    setPosts((cur) => cur.filter((p) => p.id !== id));
    const res = await apiDelete(`/api/posts/${id}`);
    if (res.ok) {
      toast.success(t("toasts.deleted"));
    } else {
      if (removed) {
        setPosts((cur) => {
          const next = cur.filter((p) => p.id !== id);
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      }
      toast.error(t("toasts.deleteFailed"));
    }
  };

  const fetchPublishedPage = useCallback(async (cursor?: string, append = false) => {
    try {
      const res = await apiGet<{ posts: Post[]; nextCursor?: string | null }>(
        `/api/posts?status=published&limit=${POSTS_FETCH_LIMIT}${productId ? `&productId=${encodeURIComponent(productId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      );
      if (res.ok) {
        const received = res.data.posts || [];
        setPosts((current) => append
          ? [...new Map([...current, ...received].map((post) => [post.id, post])).values()]
          : received);
        setNextCursor(res.data.nextCursor || null);
        return received.length > 0;
      }
    } catch {
      toast.error(t("toasts.loadFailed"));
    } finally {
      setLoading(false);
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const fetchPublished = useCallback(async () => {
    setPage(1);
    await fetchPublishedPage();
  }, [fetchPublishedPage]);

  const loadMorePublished = useCallback(async () => {
    if (!nextCursor) return false;
    const currentPageIsFull = posts.length >= page * POSTS_PER_PAGE;
    const loaded = await fetchPublishedPage(nextCursor, true);
    return currentPageIsFull && loaded;
  }, [fetchPublishedPage, nextCursor, page, posts.length]);

  useEffect(() => {
    deferFromEffect(fetchPublished);
  }, [fetchPublished, refreshKey]);

  if (loading) {
    return <PostGridSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
        {onCreatePost && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onCreatePost}>
            {t("createPost")}
          </Button>
        )}
      </div>
    );
  }

  // Newest date first, so page 1 is the most recent and paging walks backwards.
  const ordered = sortPostsByNewestDate(posts);
  const totalPages = Math.ceil(ordered.length / POSTS_PER_PAGE);
  const paginatedPosts = ordered.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paginatedPosts.map((post) => (
          <PostCard key={post.id} post={post} onDelete={() => handleDelete(post.id)} />
        ))}
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        hasMore={Boolean(nextCursor)}
        onLoadMore={loadMorePublished}
      />
    </>
  );
}
