"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import Notice from "@/components/app/Notice";
import EmptyState from "@/components/app/EmptyState";
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
import { HowItWorksButton, TrustLegendButton } from "@/components/intelligence/shared";
import { useIntelligenceFormat } from "@/components/intelligence/format";
import { OverviewTab } from "@/components/intelligence/OverviewTab";
import { AudienceTab } from "@/components/intelligence/AudienceTab";
import { ContentTab } from "@/components/intelligence/ContentTab";
import { PlaybookTab } from "@/components/intelligence/PlaybookTab";
import { ExperimentsTab } from "@/components/intelligence/ExperimentsTab";
import type { ExperimentDraft, IntelligenceOverview } from "@/components/intelligence/types";

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
    <div className="flex basis-full items-center gap-2 text-xs text-muted-foreground sm:basis-auto" title={t("hint")}>
      {!unlimited && (
        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full w-full origin-left rounded-full rtl:origin-right", ratio >= 1 ? "bg-mk-neg" : ratio >= 0.8 ? "bg-mk-warn" : "bg-foreground")} style={{ transform: `scaleX(${ratio})` }} />
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
  const [experimentDraft, setExperimentDraft] = useState<ExperimentDraft | null>(null);
  const path = `/api/intelligence/overview${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`;
  const { data, loading, refreshing, error, refresh } = useApiQuery<IntelligenceOverview>(canAccess ? path : null);
  const selectedId = productId || data?.productId || "";

  useEffect(() => {
    if (canAccess === false) router.replace("/dashboard");
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

  /** A move, pattern, or idea becomes a prefilled composer on the Experiments tab. */
  function startExperiment(draft: ExperimentDraft) {
    setExperimentDraft(draft);
    selectTab("experiments");
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
          <>
            {data?.quota && <QuotaMeter quota={data.quota} />}
            <TrustLegendButton />
            <HowItWorksButton topic="page" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void recompute()}
              disabled={busy}
              title={computed ? t("actions.computedAt", { when: computed }) : undefined}
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {recomputing ? t("actions.refreshing") : t("actions.refresh")}
            </Button>
          </>
        }
      >
        {data && data.products.length > 0 && (
          <BrandSwitcher
            label={t("productBar.brand")}
            emptyLabel={t("productBar.noBrandSelected")}
            products={data.products}
            value={selectedId}
            onChange={setProductId}
          />
        )}
      </PageHeader>

      {loading && !data && (
        <div className="space-y-5">
          <Skeleton className="h-9 w-80 rounded-lg" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {error && (
        <Notice
          tone="negative"
          icon={AlertCircle}
          title={t("errors.unavailableTitle")}
          className="mb-6"
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" />
              {t("errors.retry")}
            </Button>
          }
        >
          {t("errors.unavailableBody")}
        </Notice>
      )}

      {data && !data.productId && (
        <EmptyState
          icon={Plus}
          title={t("empty.noBrandTitle")}
          description={t("empty.noBrandBody")}
          action={
            <Button asChild>
              <Link href="/products">{t("empty.createBrand")}</Link>
            </Button>
          }
        />
      )}

      {scoped && scoped.totals && (
        <Tabs value={visibleTab} onValueChange={selectTab} className="w-full min-w-0 gap-6">
          <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
            <TabsList variant="line" className="scrollbar-hide w-full overflow-x-auto">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="rounded-md bg-foreground px-1.5 text-[11px] font-semibold tabular-nums leading-4 text-background">{tab.count}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="overview">
            <OverviewTab data={scoped} onNavigate={selectTab} onTest={startExperiment} />
          </TabsContent>
          <TabsContent value="content">
            <ContentTab data={scoped} productId={selectedId} />
          </TabsContent>
          <TabsContent value="playbook">
            <PlaybookTab data={scoped} productId={selectedId} onTest={startExperiment} />
          </TabsContent>
          <TabsContent value="audience">
            <AudienceTab productId={selectedId} data={scoped} />
          </TabsContent>
          {showExperiments && (
            <TabsContent value="experiments">
              <ExperimentsTab
                data={scoped}
                productId={selectedId}
                focusExperimentId={searchParams?.get("experiment")}
                draft={experimentDraft}
                onDraft={setExperimentDraft}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </>
  );
}
