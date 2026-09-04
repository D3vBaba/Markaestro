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

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being deleted — a key into appCommon.confirmDeleteDialog.entities, e.g. "brand", "post", "teamMember" */
  entity: string;
  /** The name of the item being deleted, shown in bold */
  name?: string;
  /** Optional extra warning text */
  warning?: string;
  /** If true, user must type the entity name to confirm */
  requireTypedConfirmation?: boolean;
  /** Label for the confirm button (default: "Delete") */
  confirmLabel?: string;
  /** Called when the user confirms — return a promise to show loading state */
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmDeleteDialog({
  open,
  onOpenChange,
  entity,
  name,
  warning,
  requireTypedConfirmation = false,
  confirmLabel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const t = useTranslations("appCommon.confirmDeleteDialog");
  const entityLabel = t.has(`entities.${entity}`) ? t(`entities.${entity}`) : entity;
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState("");

  const needsTyping = requireTypedConfirmation && name;
  const typedMatch = !needsTyping || typed.toLowerCase() === name!.toLowerCase();

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      setTyped("");
      onOpenChange(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {name ? t("titleNamed", { entity: entityLabel }) : t("titleGeneric", { entity: entityLabel })}
          </DialogTitle>
          <DialogDescription>
            {name ? (
              t.rich("descriptionNamed", {
                name: () => <span className="font-semibold text-foreground">{name}</span>,
              })
            ) : (
              t("descriptionGeneric", { entity: entityLabel })
            )}
          </DialogDescription>
        </DialogHeader>

        {warning && (
          <p className="m-0 rounded-lg bg-mk-neg-soft px-3 py-2.5 text-[13px] leading-5 text-mk-neg">
            {warning}
          </p>
        )}

        {needsTyping && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t.rich("typeToConfirm", {
                name: () => <span className="font-mono font-semibold text-foreground">{name}</span>,
              })}
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name!}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && typedMatch && !loading) handleConfirm();
              }}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !typedMatch}
          >
            {loading && <Loader2 className="size-4 animate-spin me-1.5" />}
            {confirmLabel || t("deleteDefault")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
