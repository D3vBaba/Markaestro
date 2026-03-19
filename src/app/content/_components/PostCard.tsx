"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import PlatformPreview from "@/components/app/PlatformPreview";

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

const channelLabels: Record<string, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export default function PostCard({
  post,
  onEdit,
  onDelete,
  onPublish,
}: {
  post: Post;
  onEdit?: () => void;
  onDelete?: () => void;
  onPublish?: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="group border border-border/40 rounded-lg p-5 space-y-4 bg-card hover:border-border transition-colors">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{channelLabels[post.channel] || post.channel}</span>
        <span className="w-px h-3 bg-border" />
        <span className={post.status === "failed" ? "text-destructive" : ""}>{post.status}</span>
        {post.scheduledAt && post.status === "scheduled" && (
          <>
            <span className="w-px h-3 bg-border" />
            <span>{new Date(post.scheduledAt).toLocaleString()}</span>
          </>
        )}
      </div>

      {showPreview ? (
        <PlatformPreview content={post.content} channel={post.channel} mediaUrls={post.mediaUrls} externalUrl={post.externalUrl} />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-4">{post.content}</p>
      )}

      {post.errorMessage && (
        <p className="text-xs text-destructive">{post.errorMessage}</p>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-border/30">
        <span className="text-[11px] text-muted-foreground">
          {post.publishedAt
            ? new Date(post.publishedAt).toLocaleDateString()
            : post.createdAt
            ? new Date(post.createdAt).toLocaleDateString()
            : ""}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Text" : "Preview"}
          </Button>
          {post.externalUrl && (
            <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground">
                View
              </Button>
            </a>
          )}
          {onEdit && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground" onClick={onEdit}>
              Edit
            </Button>
          )}
          {onPublish && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-foreground" onClick={onPublish}>
              Publish
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
