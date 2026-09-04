"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/app/PageHeader";
import BrandSwitcher from "@/components/app/BrandSwitcher";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, getApiWorkspaceId, subscribeApiWorkspaceId } from "@/lib/api-client";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";
import PlatformPostsTab from "./_components/PlatformPostsTab";

const STORAGE_KEY = "markaestro_default_product";

type Product = { id: string; name: string };

const TAB_IDS = ["create", "drafts", "scheduled", "published", "on-platform"] as const;

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PostsPage() {
  const t = useTranslations("content.page");
  const tBar = useTranslations("content.page.productBar");
  const tabs = TAB_IDS.map((value) => ({
    value,
    label: t(`tabs.${value === "on-platform" ? "onPlatform" : value}`),
  }));
  const router = useRouter();
  // Evergreen moved to its own page; keep the old tab link working.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "evergreen") router.replace("/evergreen");
  }, [router]);
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
        action={
          <BrandSwitcher
            label={tBar("brand")}
            emptyLabel={tBar("noBrandSelected")}
            products={products}
            value={productId}
            onChange={handleProductChange}
          />
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0 gap-6">
        {/* One scrollable underline row on every width; the active tab stays in view. */}
        <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <TabsList variant="line" className="scrollbar-hide w-full overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
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
