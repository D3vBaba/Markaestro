"use client";

import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";

export function TrialBanner() {
  const { status, trialDaysLeft } = useSubscription();
  const [busy, setBusy] = useState(false);

  if (!status?.trialing || trialDaysLeft === null) return null;

  const urgent = trialDaysLeft <= 2;

  async function handleUpgrade() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>('/api/stripe/portal', { method: 'POST' });
      if (res.ok && res.data.url) {
        toast("Opening billing portal…");
        window.open(res.data.url, "_blank", "noopener");
      } else {
        toast.error("Could not open the billing portal. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-6 py-2.5 text-[13px] border-b"
      style={{
        background: urgent
          ? "color-mix(in oklch, var(--mk-warn) 14%, var(--mk-paper))"
          : "var(--mk-accent-soft)",
        color: urgent
          ? "color-mix(in oklch, var(--mk-warn) 70%, var(--mk-ink))"
          : "var(--mk-accent)",
        borderColor: urgent
          ? "color-mix(in oklch, var(--mk-warn) 24%, var(--mk-paper))"
          : "color-mix(in oklch, var(--mk-accent) 20%, var(--mk-paper))",
      }}
    >
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" />
        <span className="font-medium">
          {trialDaysLeft === 0
            ? "Your trial ends today"
            : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your trial`}
        </span>
        {status.tier && (
          <span className="text-xs opacity-70">
            · {status.tier.charAt(0).toUpperCase() + status.tier.slice(1)} plan
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant={urgent ? "default" : "outline"}
        className="h-7 text-xs rounded-lg"
        onClick={handleUpgrade}
        disabled={busy}
      >
        {busy ? "Loading..." : "Manage Billing"}
      </Button>
    </div>
  );
}
