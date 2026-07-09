"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";

export default function MarkPostedDialog({
  open,
  onOpenChange,
  postId,
  channelLabel,
  onMarked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  channelLabel: string;
  onMarked?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const trimmed = url.trim();
      const res = await apiPost<{ ok: boolean; error?: string }>(
        `/api/posts/${postId}/mark-posted`,
        trimmed ? { externalUrl: trimmed } : {},
      );
      if (res.ok && res.data.ok) {
        toast.success("Marked as posted");
        setUrl("");
        onOpenChange(false);
        onMarked?.();
      } else {
        toast.error(res.data?.error || "Failed to mark as posted");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark as posted");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as posted</DialogTitle>
          <DialogDescription>
            Confirm you published this post on {channelLabel} yourself. Paste the
            link to the live post if you have it — it connects the post to its
            analytics later.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://www.${channelLabel.toLowerCase()}.com/… (optional)`}
          disabled={saving}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Mark as posted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
