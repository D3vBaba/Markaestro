"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ProductCard, { type ConnectionChip, type ProductCardData } from "./_components/ProductCard";
import ProductDetailSheet, { type IntegrationInfo } from "./_components/ProductDetailSheet";
import ProductCreateWizard from "./_components/ProductCreateWizard";
import { apiGet, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Product = ProductCardData;

const SOCIAL_PROVIDERS = ["meta", "instagram", "tiktok", "linkedin"] as const;

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
  linkedin: "LinkedIn",
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionCache, setConnectionCache] = useState<Record<string, ConnectionChip[]>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  const fetchProducts = async () => {
    try {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (res.ok) setProducts(res.data.products || []);
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  const fetchConnectionStatuses = useCallback(async (list: Product[]) => {
    const cache: Record<string, ConnectionChip[]> = {};
    for (const p of list) {
      const res = await apiGet<{ integrations: IntegrationInfo[] }>(
        `/api/integrations?productId=${p.id}`,
      );
      if (res.ok) {
        const scoped = getScopedSocialIntegrations(res.data.integrations || []);
        cache[p.id] = scoped.map((integ) => ({
          provider: integ.provider,
          status: integ.status,
          lastRefreshError: integ.lastRefreshError,
          pageName: integ.pageName,
          username: integ.username,
        }));
      }
    }
    setConnectionCache(cache);
  }, []);

  useEffect(() => {
    fetchProducts();

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    const provider = params.get("provider");
    const productId = params.get("productId");
    const needsPageSelect = params.get("needsPageSelect");

    if (oauthResult === "success" && provider) {
      toast.success(`${providerLabels[provider] || provider} connected`);
      window.history.replaceState({}, "", "/products");
      fetchProducts();
    } else if (oauthResult === "error" && provider) {
      const message = params.get("message");
      toast.error(`${provider} OAuth failed: ${message || "Unknown error"}`);
      window.history.replaceState({}, "", "/products");
    }

    if (oauthResult === "success" && productId) {
      setDetailId(productId);
      if (provider === "meta" && needsPageSelect === "1") {
        setTimeout(() => {
          toast.error("Select a Facebook page to finish Meta setup");
        }, 300);
      }
    }
  }, []);

  useEffect(() => {
    if (products.length > 0) {
      fetchConnectionStatuses(products);
    }
  }, [products, fetchConnectionStatuses]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await apiDelete(`/api/products/${deleteTarget.id}`);
    if (res.ok) {
      toast.success("Product deleted");
      fetchProducts();
    } else {
      toast.error("Failed to delete product");
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
        title="Products"
        subtitle="Register and track the applications you market."
        action={
          <Button onClick={() => setCreateOpen(true)} className="rounded-lg h-9 text-[13px] gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add product
          </Button>
        }
      />

      <div
        className="flex items-center gap-6 mb-5 border-b"
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

      {loading ? (
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
          fetchProducts();
          setDetailId(id);
        }}
      />

      <ProductDetailSheet
        productId={detailId}
        open={!!detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onSaved={fetchProducts}
        onDeleted={fetchProducts}
      />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        entity="product"
        name={deleteTarget?.name}
        warning="All brand voice settings for this product will also be removed."
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
    all: "No products yet",
    active: "No active products",
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
        Register your first application to start crafting brand-accurate marketing.
      </p>
      <Button onClick={onCreate} className="rounded-lg mt-4 h-9 text-[13px] gap-1.5">
        <Plus className="h-3.5 w-3.5" /> Add product
      </Button>
    </div>
  );
}
