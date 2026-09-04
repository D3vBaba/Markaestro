"use client";

import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useState } from "react";
import { Clock } from "lucide-react";
import { ShellBanner } from "./ShellBanner";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function TrialBanner() {
  const { status, trialDaysLeft } = useSubscription();
  const { current: workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const t = useTranslations("shell.trialBanner");

  if (!status?.trialing || trialDaysLeft === null) return null;

  // Billing is owner-only (the server enforces billing.manage); everyone
  // else sees the countdown without a dead button.
  const canManageBilling = workspace?.role === "owner";

  const urgent = trialDaysLeft <= 2;

  async function handleUpgrade() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>('/api/stripe/portal', { method: 'POST' });
      if (res.ok && res.data.url) {
        toast(t("openingPortal"));
        window.open(res.data.url, "_blank", "noopener");
      } else {
        toast.error(t("portalError"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShellBanner
      tone={urgent ? "warn" : "accent"}
      icon={Clock}
      action={
        canManageBilling ? (
          <Button size="xs" variant={urgent ? "default" : "outline"} onClick={handleUpgrade} disabled={busy}>
            {busy ? t("loading") : t("manageBilling")}
          </Button>
        ) : null
      }
    >
      <span className="font-medium">
        {trialDaysLeft === 0 ? t("endsToday") : t("daysLeft", { days: trialDaysLeft })}
      </span>
      {status.tier && (
        <span className="ms-2 hidden text-muted-foreground sm:inline">
          {t("planSuffix", { tier: status.tier.charAt(0).toUpperCase() + status.tier.slice(1) })}
        </span>
      )}
    </ShellBanner>
  );
}
