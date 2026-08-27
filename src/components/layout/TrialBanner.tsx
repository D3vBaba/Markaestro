"use client";

import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useState } from "react";
import { Clock } from "lucide-react";
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
    <div
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-8 py-2.5 text-[13px] border-b ${
        urgent
          ? "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40"
          : "bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-900/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">
          {trialDaysLeft === 0
            ? t("endsToday")
            : t("daysLeft", { days: trialDaysLeft })}
        </span>
        {status.tier && (
          <span className="text-xs opacity-75 hidden sm:inline">
            {t("planSuffix", { tier: status.tier.charAt(0).toUpperCase() + status.tier.slice(1) })}
          </span>
        )}
      </div>
      {canManageBilling && (
        <Button
          size="sm"
          variant={urgent ? "default" : "outline"}
          className={`h-7 text-xs rounded-lg shrink-0 ${
            urgent ? "bg-amber-600 hover:bg-amber-700 text-white" : "border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100/50"
          }`}
          onClick={handleUpgrade}
          disabled={busy}
        >

          {busy ? t("loading") : t("manageBilling")}
        </Button>
      )}
    </div>
  );
}

