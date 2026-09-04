"use client";

import { useTranslations } from "next-intl";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { PLANS } from "@/lib/stripe/plans";
import type { PlanTier } from "@/lib/stripe/plans";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/app/EmptyState";
import { apiFetch } from "@/lib/api-client";
import { useState } from "react";
import { toast } from "sonner";

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
  const t = useTranslations("appCommon.featureGate");
  const { current: workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const minTier = getMinimumTier(feature);
  const plan = PLANS[minTier];
  // Billing is owner-only server-side; members see the lock without a
  // button that would only 403.
  const canManageBilling = workspace?.role === "owner";

  async function handleUpgrade() {
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>("/api/stripe/portal", { method: "POST" });
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
    <EmptyState
      icon={Lock}
      title={t("upgradeTo", { plan: plan.name })}
      description={t("requiresPlan", { plan: plan.name, price: plan.price.annual })}
      action={
        canManageBilling ? (
          <Button onClick={handleUpgrade} disabled={busy}>
            {busy ? t("loading") : t("upgradeTo", { plan: plan.name })}
          </Button>
        ) : undefined
      }
    />
  );
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { canAccess } = useSubscription();

  if (canAccess(feature)) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : <DefaultUpgradePrompt feature={feature} />;
}
