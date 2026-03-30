"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useAuth } from "@/components/providers/AuthProvider";

type Post = {
  id: string;
  content: string;
  channel: string;
  status: string;
  createdBy?: string;
  submittedBy?: string;
  submittedForApprovalAt?: string;
  rejectionFeedback?: string;
  createdAt?: string;
  mediaUrls?: string[];
};

const CHANNEL_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700",
  facebook: "bg-blue-50 text-blue-700",
  tiktok: "bg-slate-50 text-slate-700",
  x: "bg-sky-50 text-sky-700",
};

export default function ApprovalsTab({ refreshKey }: { refreshKey: number }) {
  const { current } = useWorkspace();
  const { user } = useAuth();
  const wsId = current?.id ?? "default";
  const isReviewer = current?.role === "owner" || current?.role === "admin";

  const [pending, setPending] = useState<Post[]>([]);
  const [myDrafts, setMyDrafts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRes, draftRes] = await Promise.all([
        apiGet<{ posts: Post[] }>("/api/posts?status=pending_approval", wsId),
        apiGet<{ posts: Post[] }>("/api/posts?status=draft,rejected", wsId),
      ]);
      if (pendingRes.ok) setPending(pendingRes.data.posts ?? []);
      if (draftRes.ok) {
        // Only show posts created by the current user
        const allDrafts = draftRes.data.posts ?? [];
        setMyDrafts(user?.uid ? allDrafts.filter((p) => p.createdBy === user.uid) : allDrafts);
      }
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts, refreshKey]);

  async function submitForApproval(postId: string) {
    setSubmitting(postId);
    try {
      const res = await apiPost("/api/posts/approval", { postId }, wsId);
      if (res.ok) {
        toast.success("Submitted for review");
        fetchPosts();
      } else {
        toast.error("Failed to submit");
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function decide(postId: string, decision: "approved" | "rejected") {
    setReviewing(postId);
    try {
      const res = await apiPost("/api/posts/approval/review", {
        postId,
        decision,
        feedback: feedback[postId] ?? "",
      }, wsId);
      if (res.ok) {
        toast.success(decision === "approved" ? "Post approved" : "Post returned with feedback");
        setFeedback((f) => { const n = { ...f }; delete n[postId]; return n; });
        fetchPosts();
      } else {
        toast.error("Failed to update");
      }
    } finally {
      setReviewing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Reviewer: pending posts */}
      {isReviewer && (
        <section>
          <h3 className="text-sm font-semibold mb-4">
            Awaiting your review
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-primary text-white text-[10px] font-bold px-2 py-0.5">
                {pending.length}
              </span>
            )}
          </h3>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center border rounded-2xl">
              Nothing awaiting review.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map((post) => (
                <div key={post.id} className="rounded-2xl border bg-background p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Badge className={`text-[11px] border-0 ${CHANNEL_COLORS[post.channel] ?? "bg-muted text-muted-foreground"}`}>
                      {post.channel}
                    </Badge>
                    <Badge className="bg-amber-50 text-amber-700 border-0 text-[11px]">Pending review</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1 whitespace-pre-wrap line-clamp-5">
                    {post.content}
                  </p>
                  <Textarea
                    placeholder="Feedback for the author (optional)"
                    className="text-xs resize-none h-16"
                    value={feedback[post.id] ?? ""}
                    onChange={(e) => setFeedback((f) => ({ ...f, [post.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => decide(post.id, "approved")}
                      disabled={reviewing === post.id}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => decide(post.id, "rejected")}
                      disabled={reviewing === post.id}
                    >
                      Return
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Author: my drafts + rejected, ready to submit */}
      <section>
        <h3 className="text-sm font-semibold mb-4">Your drafts</h3>
        {myDrafts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border rounded-2xl">
            No drafts ready for submission.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myDrafts.map((post) => (
              <div key={post.id} className="rounded-2xl border bg-background p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Badge className={`text-[11px] border-0 ${CHANNEL_COLORS[post.channel] ?? "bg-muted text-muted-foreground"}`}>
                    {post.channel}
                  </Badge>
                  {post.status === "rejected" && (
                    <Badge className="bg-rose-50 text-rose-700 border-0 text-[11px]">Returned</Badge>
                  )}
                </div>
                {post.status === "rejected" && post.rejectionFeedback && (
                  <div className="rounded-lg bg-rose-50 border border-rose-100 p-2.5">
                    <p className="text-xs text-rose-700 font-medium">Reviewer feedback:</p>
                    <p className="text-xs text-rose-600 mt-0.5">{post.rejectionFeedback}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground leading-relaxed flex-1 whitespace-pre-wrap line-clamp-5">
                  {post.content}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submitForApproval(post.id)}
                  disabled={submitting === post.id}
                >
                  {submitting === post.id ? "Submitting…" : "Submit for review"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
