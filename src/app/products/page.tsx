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
import { cn } from "@/lib/utils";

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
          <Button onClick={() => setCreateOpen(true)} className="rounded-xl gap-1.5">
            <Plus className="h-4 w-4" /> Add product
          </Button>
        }
      />

      <div className="flex items-center gap-1 mb-6 border-b border-border/40">
        {(["all", "active", "development"] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={cn(
                "relative px-3 py-2 text-sm transition-colors",
                active
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1.5">
                {filterLabels[tab]}
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  {counts[tab]}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId="products-filter-underline"
                  className="absolute left-0 right-0 -bottom-px h-0.5 bg-foreground"
                />
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-2xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} filter={filter} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
    <div className="rounded-3xl border border-dashed border-border/50 bg-muted/10 py-16 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-foreground/5 flex items-center justify-center mb-4">
        <Plus className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-base font-medium text-foreground">{labels[filter]}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        Register your first application to start crafting brand-accurate marketing.
      </p>
      <Button onClick={onCreate} className="rounded-xl mt-5 gap-1.5">
        <Plus className="h-4 w-4" /> Add product
      </Button>
    </div>
  );
}
