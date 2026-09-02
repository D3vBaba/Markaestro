"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ProductCard, { type ConnectionChip, type ProductCardData } from "./_components/ProductCard";
import ProductDetailSheet, { type IntegrationInfo } from "./_components/ProductDetailSheet";
import { resolveConnectionChipTone } from "@/lib/integrations/channel-status";
import ProductCreateWizard from "./_components/ProductCreateWizard";
import { apiDelete } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { toast } from "sonner";
import { cn } from "@/lib/utils";


type Product = ProductCardData;

const SOCIAL_PROVIDERS = ["meta", "instagram", "tiktok", "threads", "pinterest", "linkedin"] as const;

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
};

type OauthCallback = {
  result: string;
  provider: string | null;
  productId: string | null;
  needsPageSelect: boolean;
  /** Pages this authorization dropped out of the Facebook grant. */
  ungrantedPages: string[];
  reason: string | null;
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
  const initialDetailId = oauthProductId ?? openDeepLink?.productId ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const [detailSection, setDetailSection] = useState<"foundation" | "channels">(
    oauthProductId ? "channels" : openDeepLink?.section ?? "foundation",
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

    if (result === "success" && provider) {
      toast.success(t("toasts.connected", { provider: providerLabels[provider] || provider }));
      window.history.replaceState({}, "", "/products");
      invalidateQueries("/api/products");
      invalidateQueries("/api/integrations");
    } else if (result === "error" && provider) {
      const label = providerLabels[provider] || provider;
      if (reason === "access_denied") {
        toast.error(t("toasts.declinedPermission", { provider: label }));
      } else {
        toast.error(t("toasts.connectionFailed", { provider: label }));
      }
      window.history.replaceState({}, "", "/products");
    }

    if (result === "success" && productId) {
      // The card is highlighted from first render; fade it after a beat
      timers.push(setTimeout(() => setHighlightId(null), 2500));
      if (provider === "meta" && needsPageSelect) {
        timers.push(
          setTimeout(() => {
            toast.info(t("toasts.almostDone"));
          }, 300),
        );
      }
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
            className="rounded-xl h-9 text-xs font-semibold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
          >
            <Plus className="h-4 w-4" /> {t("addBrand")}
          </Button>
        }
      />

      {ungrantedPages.length > 0 && (
        <div className="mb-6 flex gap-3 rounded-2xl border p-4 bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-900/50">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {t("ungrantedPages.title", { count: ungrantedPages.length })}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              {t("ungrantedPages.body", { pages: ungrantedPages.join(", ") })}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-4">
              <Link href="/guides/channels" className="text-xs font-medium text-amber-800 dark:text-amber-300 underline underline-offset-2">
                {t("ungrantedPages.howItWorks")}
              </Link>
              <button
                type="button"
                onClick={() => setUngrantedPages([])}
                className="text-xs text-amber-600 dark:text-amber-400 underline underline-offset-2"
              >
                {t("ungrantedPages.dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
        {(["all", "active", "development"] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={cn(
                "relative px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2",
                active
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
              )}
            >
              <span>{filterLabels[tab]}</span>
              <span
                className={cn(
                  "tabular-nums text-[10.5px] px-1.5 py-0.5 rounded-md",
                  active
                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold"
                    : "bg-slate-200/60 dark:bg-slate-700/60 text-slate-500",
                )}
              >
                {counts[tab]}
              </span>
            </button>
          );
        })}
      </div>

      {loading && !productsData ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-56 rounded-2xl animate-pulse bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} filter={filter} />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {visible.map((p, i) => (
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
    <div className="rounded-2xl py-16 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400 shadow-2xs">
        <Plus className="h-5 w-5" />
      </div>
      <p className="text-base font-bold text-slate-900 dark:text-slate-100">
        {labels[filter]}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
        {t("emptyState.body")}
      </p>
      <Button
        onClick={onCreate}
        className="rounded-xl mt-5 h-9 text-xs font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
      >
        <Plus className="h-4 w-4" /> {t("addBrand")}
      </Button>
    </div>
  );
}
