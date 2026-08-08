"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Plus } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ProductCard, { type ConnectionChip, type ProductCardData } from "./_components/ProductCard";
import ProductDetailSheet, { type IntegrationInfo } from "./_components/ProductDetailSheet";
import ProductCreateWizard from "./_components/ProductCreateWizard";
import { apiDelete } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { toast } from "sonner";

type Product = ProductCardData;

const SOCIAL_PROVIDERS = ["meta", "instagram", "tiktok", "threads", "pinterest", "linkedin"] as const;

function getScopedSocialIntegrations(integrations: IntegrationInfo[]) {
  return integrations.filter(
    (integration) =>
      SOCIAL_PROVIDERS.includes(integration.provider as typeof SOCIAL_PROVIDERS[number]) &&
      (integration.scope === "product" ||
        (integration.provider === "meta" && integration.scope === "workspace")),
  );
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
  message: string | null;
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
    message: params.get("message"),
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
      cache[pid] = scoped.map((integ) => ({
        provider: integ.provider,
        status: integ.status,
        lastRefreshError: integ.lastRefreshError,
        pageName: integ.pageName,
        username: integ.username,
      }));
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
    const { result, provider, productId, needsPageSelect, message } = oauthCallback;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (result === "success" && provider) {
      toast.success(`${providerLabels[provider] || provider} connected`);
      window.history.replaceState({}, "", "/products");
      invalidateQueries("/api/products");
      invalidateQueries("/api/integrations");
    } else if (result === "error" && provider) {
      const label = providerLabels[provider] || provider;
      if (message && message.includes("access_denied")) {
        toast.error(
          `${label}: You declined the permission request — tap Connect to try again.`,
        );
      } else {
        toast.error(`${label} connection failed: ${message || "Unknown error"}`);
      }
      window.history.replaceState({}, "", "/products");
    }

    if (result === "success" && productId) {
      // The card is highlighted from first render; fade it after a beat
      timers.push(setTimeout(() => setHighlightId(null), 2500));
      if (provider === "meta" && needsPageSelect) {
        timers.push(
          setTimeout(() => {
            toast.info(
              "Almost done — choose a Facebook page in Channels to finish Meta setup",
            );
          }, 300),
        );
      }
    }

    return () => timers.forEach(clearTimeout);
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
      toast.error("Failed to delete brand");
    };
    try {
      const res = await apiDelete(`/api/products/${id}`);
      if (res.ok) {
        toast.success("Brand deleted");
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
    all: "All",
    active: "Active",
    development: "In dev",
  };

  return (
    <AppShell>
      <PageHeader
        title="Brands"
        subtitle="Everything you market — products, businesses, clients, or yourself."
        action={
          <Button onClick={() => setCreateOpen(true)} className="rounded-lg h-9 text-[13px] gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add brand
          </Button>
        }
      />

      {ungrantedPages.length > 0 && (
        <div
          className="mb-5 flex gap-3 rounded-xl border p-4"
          style={{
            borderColor: "var(--mk-warn)",
            background: "color-mix(in srgb, var(--mk-warn) 8%, transparent)",
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--mk-warn)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              {ungrantedPages.length} Facebook{" "}
              {ungrantedPages.length === 1 ? "Page is" : "Pages are"} no longer authorized
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              This login did not include {ungrantedPages.join(", ")}. Facebook replaces the whole permission
              set each time you connect, so those Pages cannot publish until you reconnect and tick them.
              Scheduled posts for them will fail.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <Link href="/guides/channels" className="text-[12.5px] underline underline-offset-2">
                How connecting works
              </Link>
              <button
                type="button"
                onClick={() => setUngrantedPages([])}
                className="text-[12.5px] text-muted-foreground underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="flex items-center gap-6 mb-5 border-b overflow-x-auto scrollbar-hide"
        style={{ borderColor: "var(--mk-rule-soft)" }}
      >
        {(["all", "active", "development"] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className="relative py-2.5 text-[13px] transition-colors whitespace-nowrap"
              style={{
                marginBottom: -1,
                color: active ? "var(--mk-ink)" : "var(--mk-ink-60)",
                fontWeight: active ? 600 : 400,
                letterSpacing: "-0.005em",
                borderBottom: `2px solid ${active ? "var(--mk-ink)" : "transparent"}`,
              }}
            >
              <span className="flex items-center gap-1.5">
                {filterLabels[tab]}
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--mk-ink-40)" }}
                >
                  {counts[tab]}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId="products-filter-underline"
                  className="absolute left-0 right-0 -bottom-px h-px"
                  style={{ background: "var(--mk-ink)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {loading && !productsData ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 rounded-xl animate-pulse"
              style={{ background: "var(--mk-panel)" }}
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} filter={filter} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
        warning="All brand voice settings for this brand will also be removed."
        onConfirm={confirmDelete}
      />
    </AppShell>
  );
}

function EmptyState({
  onCreate,
  filter,
}: {
  onCreate: () => void;
  filter: FilterTab;
}) {
  const labels = {
    all: "No brands yet",
    active: "No active brands",
    development: "Nothing in development",
  } as const;
  return (
    <div
      className="rounded-xl py-14 text-center"
      style={{
        background: "var(--mk-paper)",
        border: "1px dashed var(--mk-rule)",
      }}
    >
      <div
        className="mx-auto h-11 w-11 rounded-xl grid place-items-center mb-3.5"
        style={{ background: "var(--mk-panel)" }}
      >
        <Plus className="h-4 w-4" style={{ color: "var(--mk-ink-60)" }} />
      </div>
      <p
        className="text-[14px] font-medium"
        style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
      >
        {labels[filter]}
      </p>
      <p
        className="mt-1 text-[13px] max-w-sm mx-auto"
        style={{ color: "var(--mk-ink-60)" }}
      >
        Add your first brand to start crafting on-voice marketing.
      </p>
      <Button onClick={onCreate} className="rounded-lg mt-4 h-9 text-[13px] gap-1.5">
        <Plus className="h-3.5 w-3.5" /> Add brand
      </Button>
    </div>
  );
}
