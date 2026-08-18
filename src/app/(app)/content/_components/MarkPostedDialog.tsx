"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { userFacingError } from "@/lib/user-facing-errors";

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
  const t = useTranslations("content.markPostedDialog");
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
        toast.success(t("toasts.marked"));
        setUrl("");
        onOpenChange(false);
        onMarked?.();
      } else {
        toast.error(userFacingError(res.data, t("toasts.failed")));
      }
    } catch {
      toast.error(t("toasts.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { channel: channelLabel })}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("urlPlaceholder", { channel: channelLabel.toLowerCase() })}
          disabled={saving}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 me-1.5 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
