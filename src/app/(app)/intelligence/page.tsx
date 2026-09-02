"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import BrandSwitcher from "@/components/app/BrandSwitcher";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import { userFacingError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useIntelligencePreviewAccess } from "@/hooks/useIntelligencePreviewAccess";
import { HowItWorksButton, SURFACE, TYPE, TrustLegendButton } from "@/components/intelligence/shared";
import { useIntelligenceFormat } from "@/components/intelligence/format";
import { OverviewTab } from "@/components/intelligence/OverviewTab";
import { AudienceTab } from "@/components/intelligence/AudienceTab";
import { ContentTab } from "@/components/intelligence/ContentTab";
import { PlaybookTab } from "@/components/intelligence/PlaybookTab";
import { ExperimentsTab } from "@/components/intelligence/ExperimentsTab";
import type { IntelligenceOverview } from "@/components/intelligence/types";

const TAB_IDS = ["overview", "content", "playbook", "audience", "experiments"] as const;
type TabId = (typeof TAB_IDS)[number];

/** Older inbox links and bookmarks used the previous tab names. */
const LEGACY_TABS: Record<string, TabId> = { advanced: "experiments", opportunities: "playbook" };

function resolveTab(raw: string | null | undefined): TabId {
  if (!raw) return "overview";
  if ((TAB_IDS as readonly string[]).includes(raw)) return raw as TabId;
  return LEGACY_TABS[raw] ?? "overview";
}

function QuotaMeter({ quota }: { quota: NonNullable<IntelligenceOverview["quota"]> }) {
  const t = useTranslations("intelligence.quota");
  const unlimited = quota.aiOperationsLimit < 0;
  const ratio = unlimited ? 0 : Math.min(1, quota.aiOperationsUsed / Math.max(1, quota.aiOperationsLimit));
  const askLimited = typeof quota.strategistTurnsLimit === "number" && quota.strategistTurnsLimit >= 0;
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400" title={t("hint")}>
      {!unlimited && (
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-400" : "bg-violet-500")} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      )}
      <span className="whitespace-nowrap tabular-nums">
        {unlimited
          ? t("aiOpsUnlimited", { used: quota.aiOperationsUsed })
          : t("aiOps", { used: quota.aiOperationsUsed, limit: quota.aiOperationsLimit })}
        {askLimited && (
          <> · {t("strategist", { used: quota.strategistTurnsUsed ?? 0, limit: quota.strategistTurnsLimit })}</>
        )}
      </span>
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={null}>
      <IntelligencePageContent />
    </Suspense>
  );
}

function IntelligencePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canAccess = useIntelligencePreviewAccess();
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const [productId, setProductId] = useState("");
  const urlTab = resolveTab(searchParams?.get("tab"));
  const [activeTab, setActiveTab] = useState<TabId>(urlTab);
  // A ?tab= link has to win even when the page is already mounted (inbox
  // results link straight to an experiment).
  const [seenUrlTab, setSeenUrlTab] = useState(urlTab);
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab);
    setActiveTab(urlTab);
  }
  const [recomputing, setRecomputing] = useState(false);
  const path = `/api/intelligence/overview${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`;
  const { data, loading, refreshing, error, refresh } = useApiQuery<IntelligenceOverview>(canAccess ? path : null);
  const selectedId = productId || data?.productId || "";

  useEffect(() => {
    if (!canAccess) router.replace("/dashboard");
  }, [canAccess, router]);

  if (!canAccess) return null;

  function selectTab(next: string) {
    const tab = resolveTab(next);
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString());
    if (tab === "overview") params.delete("tab"); else params.set("tab", tab);
    // The experiment deep link only makes sense on its own tab.
    if (tab !== "experiments") params.delete("experiment");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const showExperiments = Boolean(data?.phases?.experiments);
  // A stale experiments link on a workspace without that phase falls back to Overview.
  const visibleTab: TabId = activeTab === "experiments" && data && !showExperiments ? "overview" : activeTab;
  const newMoves = data
    ? data.opportunities.filter((item) => (item.status || "proposed") === "proposed").length
      + data.learnings.filter((item) => (item.status || "proposed") === "proposed").length
    : 0;
  const tabs = TAB_IDS
    .filter((value) => value !== "experiments" || showExperiments)
    .map((value) => ({ value, label: t(`tabs.${value}`), count: value === "playbook" ? newMoves : 0 }));

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
  const computed = fmt.dateTime(data?.computedAt);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data?.quota && <QuotaMeter quota={data.quota} />}
            <TrustLegendButton />
            <HowItWorksButton topic="page" />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 rounded-xl border-slate-200/80 bg-white text-xs font-medium shadow-2xs hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
              onClick={() => void recompute()}
              disabled={busy}
              title={computed ? t("actions.computedAt", { when: computed }) : undefined}
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
        <div className="space-y-5">
          <Skeleton className="h-9 w-80 rounded-xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/80 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">{t("errors.unavailableTitle")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">{t("errors.unavailableBody")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 rounded-xl border-rose-300 text-xs text-rose-700 hover:bg-rose-100/50 dark:border-rose-800 dark:text-rose-300"
            onClick={() => void refresh()}
          >
            <RefreshCw className="me-1 h-3.5 w-3.5" />
            {t("errors.retry")}
          </Button>
        </div>
      )}

      {data && !data.productId && (
        <div className={cn("px-6 py-16 text-center border-dashed", SURFACE)}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200/50 bg-blue-50 text-blue-600 shadow-2xs dark:border-blue-800/50 dark:bg-blue-950/60 dark:text-blue-400">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className={cn("mt-4", TYPE.sectionTitle)}>{t("empty.noBrandTitle")}</h2>
          <p className={cn("mx-auto mt-1 max-w-md", TYPE.hint)}>{t("empty.noBrandBody")}</p>
          <Button asChild className="mt-5 h-9 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700">
            <Link href="/products">{t("empty.createBrand")}</Link>
          </Button>
        </div>
      )}

      {scoped && scoped.totals && (
        <Tabs value={visibleTab} onValueChange={selectTab} className="w-full min-w-0 gap-5 sm:gap-6">
          <TabsList className="h-auto w-full max-w-full justify-start gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80 sm:w-fit">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-8 flex-none gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-slate-500 hover:text-slate-800 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs dark:text-slate-400 dark:hover:text-slate-200 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-slate-100"
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-bold tabular-nums leading-4 text-white">{tab.count}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab data={scoped} onNavigate={selectTab} />
          </TabsContent>
          <TabsContent value="content">
            <ContentTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="playbook">
            <PlaybookTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="audience">
            <AudienceTab productId={selectedId} data={scoped} />
          </TabsContent>
          {showExperiments && (
            <TabsContent value="experiments">
              <ExperimentsTab data={scoped} productId={selectedId} focusExperimentId={searchParams?.get("experiment")} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </>
  );
}
