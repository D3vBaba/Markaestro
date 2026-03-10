"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Send, Pencil, ExternalLink, Clock } from "lucide-react";

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

const channelLabels: Record<string, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
};

const channelColors: Record<string, string> = {
  x: "bg-zinc-100 text-zinc-800",
  facebook: "bg-blue-50 text-blue-700",
  instagram: "bg-sky-50 text-sky-700",
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-amber-50 text-amber-700",
  publishing: "bg-blue-50 text-blue-700",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
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
  return (
    <Card className="shadow-sm">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`border-0 text-[10px] ${channelColors[post.channel] || ""}`}>
            {channelLabels[post.channel] || post.channel}
          </Badge>
          <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[post.status] || ""}`}>
            {post.status}
          </Badge>
          {post.scheduledAt && post.status === "scheduled" && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(post.scheduledAt).toLocaleString()}
            </span>
          )}
        </div>

        <p className="text-sm whitespace-pre-wrap line-clamp-4">{post.content}</p>

        {post.errorMessage && (
          <p className="text-xs text-destructive">Error: {post.errorMessage}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            {post.publishedAt
              ? `Published ${new Date(post.publishedAt).toLocaleString()}`
              : post.createdAt
              ? `Created ${new Date(post.createdAt).toLocaleString()}`
              : ""}
          </span>
          <div className="flex items-center gap-1">
            {post.externalUrl && (
              <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
            {onEdit && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {onPublish && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600" onClick={onPublish}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
