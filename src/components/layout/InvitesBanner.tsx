"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { apiFetch } from "@/lib/api-client";
import { invalidateQueries } from "@/hooks/useApiQuery";
import { deferFromEffect } from "@/lib/defer-from-effect";

type PendingInvite = {
  workspaceId: string;
  workspaceName: string;
  role: string;
  invitedByEmail: string;
};

/**
 * Persistent banner offering each workspace invitation addressed to the
 * signed-in email. Joining is always an explicit choice made here (or
 * ignored until the invite expires) — never a side effect of logging in.
 */
export function InvitesBanner() {
  const { user } = useAuth();
  const { switchWorkspace, refresh: refreshWorkspaces } = useWorkspace();
  const t = useTranslations("shell.invitesBanner");
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [busyWorkspaceId, setBusyWorkspaceId] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!user) {
      setInvites([]);
      return;
    }
    try {
      const res = await apiFetch<{ invites: PendingInvite[] }>("/api/team/invites");
      if (res.ok) setInvites(res.data.invites);
    } catch {
      // Non-fatal — the banner just stays hidden.
    }
  }, [user]);

  useEffect(() => {
    deferFromEffect(fetchInvites);
  }, [fetchInvites]);

  if (!user || invites.length === 0) return null;

  async function handleAccept(invite: PendingInvite) {
    setBusyWorkspaceId(invite.workspaceId);
    try {
      const res = await apiFetch<{ joined: { workspaceId: string; workspaceName: string } }>(
        "/api/team/invites/accept",
        { method: "POST", body: JSON.stringify({ workspaceId: invite.workspaceId }) },
      );
      if (res.ok) {
        toast.success(t("joined", { workspaceName: invite.workspaceName }));
        setInvites((prev) => prev.filter((i) => i.workspaceId !== invite.workspaceId));
        await refreshWorkspaces();
        switchWorkspace(invite.workspaceId);
        invalidateQueries();
      } else {
        toast.error(t("acceptError"));
        void fetchInvites();
      }
    } finally {
      setBusyWorkspaceId(null);
    }
  }

  async function handleDecline(invite: PendingInvite) {
    setBusyWorkspaceId(invite.workspaceId);
    try {
      const res = await apiFetch("/api/team/invites/decline", {
        method: "POST",
        body: JSON.stringify({ workspaceId: invite.workspaceId }),
      });
      if (res.ok) {
        toast(t("declined", { workspaceName: invite.workspaceName }));
        setInvites((prev) => prev.filter((i) => i.workspaceId !== invite.workspaceId));
      } else {
        toast.error(t("declineError"));
      }
    } finally {
      setBusyWorkspaceId(null);
    }
  }

  return (
    <div className="border-b" style={{ background: "color-mix(in oklch, var(--mk-accent) 8%, var(--mk-paper))" }}>
      {invites.map((invite) => {
        const busy = busyWorkspaceId === invite.workspaceId;
        return (
          <div
            key={invite.workspaceId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-6 py-2.5 text-[13px]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">
                {invite.invitedByEmail
                  ? t("invitedBy", { inviterEmail: invite.invitedByEmail, workspaceName: invite.workspaceName })
                  : t("invited", { workspaceName: invite.workspaceName })}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <Button size="sm" disabled={busy} onClick={() => handleAccept(invite)}>
                {t("accept")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleDecline(invite)}>
                {t("decline")}
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
