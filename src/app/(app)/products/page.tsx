"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import Notice from "@/components/app/Notice";
import EmptyStateBlock from "@/components/app/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import Pagination from "@/components/app/Pagination";
import ProductCard, { type ConnectionChip, type ProductCardData } from "./_components/ProductCard";
import ProductDetailSheet, { type IntegrationInfo } from "./_components/ProductDetailSheet";
import { readConnectOutcome, type ConnectOutcome } from "@/components/app/ConnectionOutcomeCard";
import { resolveConnectionChipTone } from "@/lib/integrations/channel-status";
import ProductCreateWizard from "./_components/ProductCreateWizard";
import { apiDelete } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { toast } from "sonner";
import { cn } from "@/lib/utils";


type Product = ProductCardData;

const SOCIAL_PROVIDERS = ["meta", "instagram", "tiktok", "threads", "pinterest", "linkedin", "x"] as const;

function getScopedSocialIntegrations(integrations: IntegrationInfo[]) {
  return integrations.filter(
    (integration) =>
      SOCIAL_PROVIDERS.includes(integration.provider as typeof SOCIAL_PROVIDERS[number]) &&
      integration.scope === "product",
  );
}

function toConnectionChip(integ: IntegrationInfo): ConnectionChip {
  return {
    provider: integ.provider,
    status: integ.status,
    lastRefreshError: integ.lastRefreshError,
    pageName: integ.pageName,
    username: integ.username,
    tone: resolveConnectionChipTone(integ.provider, integ),
  };
}

type FilterTab = "all" | "active" | "development";

const providerLabels: Record<string, string> = {
  meta: "Meta",
  instagram: "Instagram",
  tiktok: "TikTok",
  threads: "Threads",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  x: "X",
};

type OauthCallback = {
  result: string;
  provider: string | null;
  productId: string | null;
  needsPageSelect: boolean;
  /** Pages this authorization dropped out of the Facebook grant. */
  ungrantedPages: string[];
  reason: string | null;
  /** The same redirect, shaped for the persistent outcome panel in the sheet. */
  outcome: ConnectOutcome | null;
};

/** Read the OAuth redirect params once on mount (null during SSR / no callback). */
function readOauthCallback(): OauthCallback | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const result = params.get("oauth");
  if (!result) return null;
  return {
    result,
    provider: params.get("provider"),
    productId: params.get("productId"),
    needsPageSelect: params.get("needsPageSelect") === "1",
    ungrantedPages: (params.get("ungrantedPages") || "").split("|").filter(Boolean),
    reason: params.get("reason"),
    outcome: readConnectOutcome(params),
  };
}

/** Read the ?open=<productId>&section=… deep link once on mount (e.g. the
    "Connect" CTA on the Posts page's On Platform tab). */
function readOpenDeepLink(): { productId: string; section: "foundation" | "channels" } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const productId = params.get("open");
  if (!productId) return null;
  return {
    productId,
    section: params.get("section") === "channels" ? "channels" : "foundation",
  };
}

export default function ProductsPage() {
  const t = useTranslations("products.page");
  const {
    data: productsData,
    loading,
    refresh: refreshProducts,
  } = useApiQuery<{ products: Product[] }>("/api/products");
  // Optimistic delete overrides — hide cards immediately; on API failure the
  // id is removed from the set so the card reappears.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const products = useMemo(() => {
    const base = productsData?.products ?? [];
    return base.filter((p) => !deletedIds.has(p.id));
  }, [productsData, deletedIds]);

  // One batched request for every product's connection statuses (null path
  // until the product list has loaded). Keyed on sorted ids so reordering
  // doesn't bust the cache.
  const connectionsPath = useMemo(() => {
    const ids = (productsData?.products ?? []).map((p) => p.id);
    if (ids.length === 0) return null;
    return `/api/integrations?productIds=${[...ids].sort().join(",")}`;
  }, [productsData]);
  const { data: connectionsData } = useApiQuery<{
    products: Record<string, IntegrationInfo[]>;
  }>(connectionsPath);
  const connectionCache = useMemo(() => {
    const cache: Record<string, ConnectionChip[]> = {};
    for (const [pid, integrations] of Object.entries(connectionsData?.products ?? {})) {
      const scoped = getScopedSocialIntegrations(integrations || []);
      cache[pid] = scoped.map(toConnectionChip);
    }
    return cache;
  }, [connectionsData]);

  // OAuth callback / deep-link params are captured once and drive the
  // *initial* state below (highlight + sheet open on a section) — no
  // setState-in-effect needed.
  const [oauthCallback] = useState(readOauthCallback);
  const [openDeepLink] = useState(readOpenDeepLink);
  const oauthProductId =
    oauthCallback?.result === "success" ? oauthCallback.productId : null;
  // A failed connect names the brand it started from too, so the failure
  // panel opens on that brand's Channels section with a Try again button.
  const outcomeProductId = oauthCallback?.outcome ? oauthCallback.productId : null;
  const initialDetailId = outcomeProductId ?? openDeepLink?.productId ?? null;
  const [connectOutcome, setConnectOutcome] = useState<ConnectOutcome | null>(
    oauthCallback?.outcome ?? null,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [detailSection, setDetailSection] = useState<"foundation" | "channels">(
    outcomeProductId ? "channels" : openDeepLink?.section ?? "foundation",
  );
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [highlightId, setHighlightId] = useState<string | null>(oauthProductId);
  // Facebook's dialog replaces the whole grant, so a narrowed selection
  // silently kills the Pages left unticked. Surface that persistently — a toast
  // that fades is how this became a day of failed posts.
  const [ungrantedPages, setUngrantedPages] = useState<string[]>(
    oauthCallback?.result === "success" && oauthCallback.provider === "meta"
      ? oauthCallback.ungrantedPages
      : [],
  );

  useEffect(() => {
    // Deep-link cleanup — the sheet is already open from initial state; drop
    // the params so a refresh doesn't re-open it.
    if (openDeepLink) window.history.replaceState({}, "", "/products");
  }, [openDeepLink]);

  useEffect(() => {
    // OAuth callback side effects: toasts, URL cleanup, cache invalidation
    if (!oauthCallback) return;
    const { result, provider, productId, needsPageSelect, reason } = oauthCallback;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // The outcome panel inside the brand sheet is the durable record of what
    // happened; a toast would only repeat it and then fade. When the sheet
    // cannot open (a failure with no brand to open), the toast is the record.
    if (result === "success" && provider) {
      window.history.replaceState({}, "", "/products");
      invalidateQueries("/api/products");
      invalidateQueries("/api/integrations");
    } else if (result === "error" && provider) {
      const label = providerLabels[provider] || provider;
      if (!productId) {
        if (reason === "access_denied") {
          toast.error(t("toasts.declinedPermission", { provider: label }));
        } else {
          toast.error(t("toasts.connectionFailed", { provider: label }));
        }
      }
      window.history.replaceState({}, "", "/products");
    }

    if (result === "success" && productId) {
      // The card is highlighted from first render; fade it after a beat
      timers.push(setTimeout(() => setHighlightId(null), 2500));
      void needsPageSelect;
    }

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthCallback]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    // Optimistic removal — hide the card immediately and re-show it (by
    // dropping the override) if the API call fails.
    setDeletedIds((prev) => new Set(prev).add(id));
    const restore = () => {
      setDeletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error(t("toasts.deleteFailed"));
    };
    try {
      const res = await apiDelete(`/api/products/${id}`);
      if (res.ok) {
        toast.success(t("toasts.deleted"));
        // Refetch; the override keeps the card hidden until fresh data
        // (without the product) arrives, so it never flashes back.
        invalidateQueries("/api/products");
      } else {
        restore();
      }
    } catch {
      restore();
    }
  };

  const counts = {
    all: products.length,
    active: products.filter((p) => p.status === "active").length,
    development: products.filter((p) => p.status === "development" || p.status === "beta").length,
  };

  const PAGE_SIZE = 9;
  const [page, setPage] = useState(1);
  const [pagedFor, setPagedFor] = useState(filter);
  if (pagedFor !== filter) { setPagedFor(filter); setPage(1); }
  const visible = products.filter((p) => {
    if (filter === "active") return p.status === "active";
    if (filter === "development") return p.status === "development" || p.status === "beta";
    return true;
  });

  const filterLabels: Record<FilterTab, string> = {
    all: t("filters.all"),
    active: t("filters.active"),
    development: t("filters.development"),
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" /> {t("addBrand")}
          </Button>
        }
      />

      {ungrantedPages.length > 0 && (
        <Notice
          tone="warning"
          icon={AlertTriangle}
          title={t("ungrantedPages.title", { count: ungrantedPages.length })}
          className="mb-6"
          action={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/guides/channels">{t("ungrantedPages.howItWorks")}</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setUngrantedPages([])}>
                {t("ungrantedPages.dismiss")}
              </Button>
            </>
          }
        >
          {t("ungrantedPages.body", { pages: ungrantedPages.join(", ") })}
        </Notice>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)} className="mb-6">
        <TabsList>
          {(["all", "active", "development"] as FilterTab[]).map((tab) => (
            <TabsTrigger key={tab} value={tab} className="gap-1.5">
              {filterLabels[tab]}
              <span className={cn("tabular-nums", filter === tab ? "text-muted-foreground" : "text-mk-ink-40")}>
                {counts[tab]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading && !productsData ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl border border-border bg-muted/60" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} filter={filter} />
      ) : (
        <>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                connections={connectionCache[p.id] || []}
                index={i}
                highlighted={highlightId === p.id}
                onOpen={() => setDetailId(p.id)}
                onDelete={() => setDeleteTarget({ id: p.id, name: p.name })}
              />
            ))}
          </AnimatePresence>
        </div>
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(visible.length / PAGE_SIZE))} onPageChange={setPage} />
        </>
      )}

      <ProductCreateWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          invalidateQueries("/api/products");
          setDetailId(id);
        }}
      />

      <ProductDetailSheet
        productId={detailId}
        open={!!detailId}
        initialSection={detailSection}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null);
            setDetailSection("foundation");
          }
        }}
        onSaved={() => {
          invalidateQueries("/api/integrations");
          refreshProducts();
        }}
        onDeleted={() => {
          invalidateQueries("/api/integrations");
          refreshProducts();
        }}
        connectOutcome={detailId && detailId === outcomeProductId ? connectOutcome : null}
        onConnectOutcomeDismiss={() => setConnectOutcome(null)}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        entity="brand"
        name={deleteTarget?.name}
        warning={t("deleteWarning")}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function EmptyState({
  onCreate,
  filter,
}: {
  onCreate: () => void;
  filter: FilterTab;
}) {
  const t = useTranslations("products.page");
  const labels = {
    all: t("emptyState.all"),
    active: t("emptyState.active"),
    development: t("emptyState.development"),
  } as const;
  return (
    <EmptyStateBlock
      icon={Package}
      title={labels[filter]}
      description={t("emptyState.body")}
      action={
        <Button onClick={onCreate}>
          <Plus className="size-4" /> {t("addBrand")}
        </Button>
      }
    />
  );
}
