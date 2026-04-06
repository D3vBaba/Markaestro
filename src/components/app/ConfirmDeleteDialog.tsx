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

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being deleted, e.g. "product", "campaign", "team member" */
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
            Delete {entity}
            {name ? "?" : ""}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            {name ? (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">{name}</span>?
                This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete this {entity}? This action
                cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {warning && (
          <p className="text-sm text-destructive/90 bg-destructive/5 border border-destructive/10 rounded-lg px-3 py-2.5 leading-relaxed">
            {warning}
          </p>
        )}

        {needsTyping && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type{" "}
              <span className="font-mono font-semibold text-foreground">
                {name}
              </span>{" "}
              to confirm.
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
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !typedMatch}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {confirmLabel || "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
