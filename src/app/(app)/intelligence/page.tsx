"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import BrandSwitcher from "@/components/app/BrandSwitcher";
import Select from "@/components/app/Select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import { userFacingError } from "@/lib/user-facing-errors";
import { KpiCard } from "@/components/analytics/KpiCard";
import { cn } from "@/lib/utils";
import { useIntelligencePreviewAccess } from "@/hooks/useIntelligencePreviewAccess";
import { HowItWorksButton } from "@/components/intelligence/shared";
import { OverviewTab } from "@/components/intelligence/OverviewTab";
import { AudienceTab } from "@/components/intelligence/AudienceTab";
import { ContentTab } from "@/components/intelligence/ContentTab";
import { OpportunitiesTab } from "@/components/intelligence/OpportunitiesTab";
import { PlaybookTab } from "@/components/intelligence/PlaybookTab";
import { AdvancedTab } from "@/components/intelligence/AdvancedTab";
import type { IntelligenceOverview } from "@/components/intelligence/types";

const TAB_IDS = ["overview", "audience", "content", "opportunities", "playbook", "advanced"] as const;

function QuotaMeter({ quota }: { quota: NonNullable<IntelligenceOverview["quota"]> }) {
  const t = useTranslations("intelligence.quota");
  const unlimited = quota.aiOperationsLimit < 0;
  const ratio = unlimited ? 0 : Math.min(1, quota.aiOperationsUsed / Math.max(1, quota.aiOperationsLimit));
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400" title={t("hint")}>
      {!unlimited && (
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-400" : "bg-violet-500")} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      )}
      <span className="whitespace-nowrap">
        {unlimited
          ? t("aiOpsUnlimited", { used: quota.aiOperationsUsed })
          : t("aiOps", { used: quota.aiOperationsUsed, limit: quota.aiOperationsLimit })}
      </span>
    </div>
  );
}

export default function IntelligencePage() {
  const router = useRouter();
  const canAccess = useIntelligencePreviewAccess();
  const t = useTranslations("intelligence");
  const [productId, setProductId] = useState("");
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [recomputing, setRecomputing] = useState(false);
  const path = `/api/intelligence/overview${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`;
  const { data, loading, refreshing, error, refresh } = useApiQuery<IntelligenceOverview>(canAccess ? path : null);
  const selectedId = productId || data?.productId || "";

  useEffect(() => {
    if (!canAccess) router.replace("/dashboard");
  }, [canAccess, router]);

  if (!canAccess) return null;

  const tabs = TAB_IDS
    .filter((value) => value !== "advanced" || data?.phases?.advanced || data?.phases?.growth)
    .map((value) => ({ value, label: t(`tabs.${value}`) }));

  /** Refresh bypasses the hourly insights cache, then re-reads the cached result. */
  async function recompute() {
    setRecomputing(true);
    try {
      // Checked rather than awaited-and-forgotten: when the recompute fails,
      // invalidating and re-reading shows the same cached figures back with a
      // finished spinner, which reads as a successful refresh that changed
      // nothing.
      const res = await apiGet(`${path}${path.includes("?") ? "&" : "?"}fresh=1`);
      if (!res.ok) {
        toast.error(userFacingError(res.data, t("actions.refreshFailed")));
        return;
      }
      invalidateQueries("/api/intelligence/overview");
      invalidateQueries("/api/intelligence/timing");
      await refresh();
    } finally {
      setRecomputing(false);
    }
  }

  const busy = loading || refreshing || recomputing;
  const scoped = data && selectedId ? { ...data, productId: selectedId } : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data?.quota && <QuotaMeter quota={data.quota} />}
            <HowItWorksButton topic="page" />
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl h-8 text-xs font-medium gap-2 border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => void recompute()}
              disabled={busy}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {recomputing ? t("actions.refreshing") : t("actions.refresh")}
            </Button>
          </div>
        }
      />

      {data && data.products.length > 0 && (
        <BrandSwitcher
          label={t("productBar.brand")}
          emptyLabel={t("productBar.noBrandSelected")}
          products={data.products}
          value={selectedId}
          onChange={setProductId}
        />
      )}

      {loading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <KpiCard key={index} label="…" value={null} loading />
            ))}
          </div>
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl p-4 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">{t("errors.unavailableTitle")}</p>
            <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{t("errors.unavailableBody")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl text-xs shrink-0 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100/50"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {t("errors.retry")}
          </Button>
        </div>
      )}

      {data && !data.productId && (
        <div className="rounded-2xl px-6 py-16 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 shadow-2xs">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">{t("empty.noBrandTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{t("empty.noBrandBody")}</p>
          <Button asChild className="mt-5 h-9 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs">
            <Link href="/products">{t("empty.createBrand")}</Link>
          </Button>
        </div>
      )}

      {scoped && scoped.totals && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0 space-y-6">
          <div className="lg:hidden">
            <Select value={activeTab} onChange={(event) => setActiveTab(event.target.value)}>
              {tabs.map((tab) => (
                <option key={tab.value} value={tab.value}>{tab.label}</option>
              ))}
            </Select>
          </div>

          <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
            {tabs.map((tab) => {
              const active = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                    active
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <TabsContent value="overview" className="mt-0">
            <OverviewTab data={scoped} onNavigate={setActiveTab} />
          </TabsContent>
          <TabsContent value="audience" className="mt-0">
            <AudienceTab productId={selectedId} data={scoped} />
          </TabsContent>
          <TabsContent value="content" className="mt-0">
            <ContentTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="opportunities" className="mt-0">
            <OpportunitiesTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="playbook" className="mt-0">
            <PlaybookTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="advanced" className="mt-0">
            <AdvancedTab data={scoped} productId={selectedId} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
