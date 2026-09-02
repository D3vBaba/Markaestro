"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import BrandSwitcher from "@/components/app/BrandSwitcher";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import Select from "@/components/app/Select";
import { apiGet, getApiWorkspaceId, subscribeApiWorkspaceId } from "@/lib/api-client";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";
import PlatformPostsTab from "./_components/PlatformPostsTab";

const STORAGE_KEY = "markaestro_default_product";

type Product = { id: string; name: string };

const TAB_IDS = ["create", "drafts", "scheduled", "published", "on-platform"] as const;

// ── Persistent product context bar ───────────────────────────────────────────

function ProductContextBar({
  products,
  productId,
  onChange,
}: {
  products: Array<{ id: string; name: string }>;
  productId: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("content.page.productBar");
  return (
    <BrandSwitcher
      label={t("brand")}
      emptyLabel={t("noBrandSelected")}
      products={products}
      value={productId}
      onChange={onChange}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PostsPage() {
  const t = useTranslations("content.page");
  const tabs = TAB_IDS.map((value) => ({
    value,
    label: t(`tabs.${value === "on-platform" ? "onPlatform" : value}`),
  }));
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "create";
    const requested = new URLSearchParams(window.location.search).get("tab");
    return TAB_IDS.includes(requested as (typeof TAB_IDS)[number]) ? requested! : "create";
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const workspaceId = useSyncExternalStore(
    subscribeApiWorkspaceId,
    getApiWorkspaceId,
    () => "default",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ products: Product[] }>("/api/products", workspaceId);
      if (cancelled || !res.ok) return;
      const list: Product[] = res.data.products || [];
      setProducts(list);
      if (list.length === 0) {
        setProductId("");
        return;
      }

      const saved = typeof window !== "undefined"
        ? localStorage.getItem(`${STORAGE_KEY}:${workspaceId}`)
        : null;
      const savedExists = saved && list.some((p) => p.id === saved);
      setProductId(savedExists ? saved! : list[0].id);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const handleProductChange = (id: string) => {
    setProductId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(`${STORAGE_KEY}:${workspaceId}`, id);
    }
  };

  const handlePostCreated = () => setRefreshKey((k) => k + 1);
  const goToCreate = () => setActiveTab("create");
  const goToDraftsAndRefresh = () => {
    setActiveTab("drafts");
    setRefreshKey((k) => k + 1);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {/* Persistent product context */}
      <ProductContextBar
        products={products}
        productId={productId}
        onChange={handleProductChange}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6 min-w-0 w-full">
        {/* Mobile + Tablet: dropdown select */}
        <div className="lg:hidden">
          <Select value={activeTab} onChange={(e) => setActiveTab(e.target.value)}>
            {tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>
                {tab.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Desktop: tab bar */}
        <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
          {tabs.map((tab) => {
            const active = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <TabsContent value="create" className="mt-0">
          <CreateTab
            key={workspaceId}
            productId={productId}
            onProductChange={handleProductChange}
            onPostCreated={handlePostCreated}
          />
        </TabsContent>

        <TabsContent value="drafts" className="mt-0">
          <DraftsTab key={workspaceId} refreshKey={refreshKey} productId={productId} onCreatePost={goToCreate} />
        </TabsContent>

        <TabsContent value="scheduled" className="mt-0">
          <ScheduledTab
            key={workspaceId}
            refreshKey={refreshKey}
            productId={productId}
            onCreatePost={goToCreate}
            onPlatformActionRequired={goToDraftsAndRefresh}
          />
        </TabsContent>

        <TabsContent value="published" className="mt-0">
          <PublishedTab key={workspaceId} refreshKey={refreshKey} productId={productId} onCreatePost={goToCreate} />
        </TabsContent>

        <TabsContent value="on-platform" className="mt-0">
          <PlatformPostsTab key={workspaceId} productId={productId} />
        </TabsContent>
      </Tabs>
    </>
  );
}

