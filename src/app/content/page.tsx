"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import PageHeader from "@/components/app/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Select from "@/components/app/Select";
import { apiGet } from "@/lib/api-client";
import CreateTab from "./_components/CreateTab";
import DraftsTab from "./_components/DraftsTab";
import ScheduledTab from "./_components/ScheduledTab";
import PublishedTab from "./_components/PublishedTab";
import ImageGallery from "./_components/ImageGallery";
import PerformanceTab from "./_components/PerformanceTab";
import TikTokVideoTab from "./_components/TikTokVideoTab";
import ApprovalsTab from "./_components/ApprovalsTab";
import { FeatureGate } from "@/components/app/FeatureGate";

const STORAGE_KEY = "markaestro_default_product";

type Product = { id: string; name: string };

const tabs = [
  { value: "create", label: "Create" },
  { value: "tiktok video", label: "TikTok Video" },
  { value: "drafts", label: "Drafts" },
  { value: "approvals", label: "Approvals" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "gallery", label: "Gallery" },
  { value: "performance", label: "Performance" },
] as const;

// ── Persistent product context bar ───────────────────────────────────────────

function ProductContextBar({
  products,
  productId,
  onChange,
}: {
  products: Product[];
  productId: string;
  onChange: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const selected = products.find((p) => p.id === productId);

  if (products.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/50 bg-card mb-6 group">
      {/* Indicator dot */}
      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />

      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground shrink-0">
        Product
      </span>

      {editing ? (
        <select
          autoFocus
          value={productId}
          onChange={(e) => {
            onChange(e.target.value);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          className="flex-1 min-w-0 text-sm font-medium bg-transparent border-none outline-none focus:ring-0 cursor-pointer"
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <>
          <span className="flex-1 text-sm font-medium truncate min-w-0">
            {selected?.name ?? "No product selected"}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0 px-2.5 py-1 rounded-lg hover:bg-muted"
          >
            Change
          </button>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PostsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState("create");
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");

  // Load products and restore default product from localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (cancelled || !res.ok) return;
      const list: Product[] = res.data.products || [];
      setProducts(list);
      if (list.length === 0) return;

      const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const savedExists = saved && list.some((p) => p.id === saved);
      setProductId(savedExists ? saved! : list[0].id);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist product selection
  const handleProductChange = (id: string) => {
    setProductId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  const handlePostCreated = () => setRefreshKey((k) => k + 1);

  return (
    <AppShell>
      <PageHeader
        title="Posts Management"
        subtitle="Create, schedule, and publish organic content across your social channels."
      />

      {/* Persistent product context — always visible above tabs */}
      <ProductContextBar
        products={products}
        productId={productId}
        onChange={handleProductChange}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8 min-w-0 w-full">
        {/* Mobile: dropdown select */}
        <div className="sm:hidden">
          <Select value={activeTab} onChange={(e) => setActiveTab(e.target.value)}>
            {tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>
                {tab.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Desktop: tab bar */}
        <TabsList className="hidden sm:flex bg-transparent border-b border-border/40 rounded-none p-0 h-auto gap-0 w-full overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-5 py-3 text-xs font-medium tracking-widest uppercase text-muted-foreground data-[state=active]:text-foreground transition-colors whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="create">
          <CreateTab
            productId={productId}
            onProductChange={handleProductChange}
            onPostCreated={handlePostCreated}
          />
        </TabsContent>

        <TabsContent value="tiktok video">
          <TikTokVideoTab onPostCreated={handlePostCreated} />
        </TabsContent>

        <TabsContent value="drafts">
          <DraftsTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="approvals">
          <FeatureGate feature="approvalWorkflows">
            <ApprovalsTab refreshKey={refreshKey} />
          </FeatureGate>
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="published">
          <PublishedTab refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="gallery">
          <ImageGallery refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
