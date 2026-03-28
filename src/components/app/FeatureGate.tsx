"use client";

import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useState } from "react";

type FeatureKey = keyof typeof PLANS.starter.gated;

type FeatureGateProps = {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

function getMinimumTier(feature: FeatureKey): PlanTier {
  const tiers: PlanTier[] = ["starter", "pro", "business"];
  for (const tier of tiers) {
    if (PLANS[tier].gated[feature]) return tier;
  }
  return "business";
}

function DefaultUpgradePrompt({ feature }: { feature: FeatureKey }) {
  const [busy, setBusy] = useState(false);
  const minTier = getMinimumTier(feature);
  const plan = PLANS[minTier];

  async function handleUpgrade() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>("/api/stripe/portal", { method: "POST" });
      if (res.ok && res.data.url) {
        window.location.href = res.data.url;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-8 flex flex-col items-center text-center">
      <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">
        Upgrade to {plan.name}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">
        This feature requires the {plan.name} plan or higher.
        Upgrade to unlock it starting at ${plan.price.annual}/mo.
      </p>
      <Button className="mt-5 rounded-xl" onClick={handleUpgrade} disabled={busy}>
        {busy ? "Loading..." : `Upgrade to ${plan.name}`}
      </Button>
    </div>
  );
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { canAccess } = useSubscription();

  if (canAccess(feature)) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : <DefaultUpgradePrompt feature={feature} />;
}
