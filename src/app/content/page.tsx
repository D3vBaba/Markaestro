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
import PerformanceTab from "./_components/PerformanceTab";
import ApprovalsTab from "./_components/ApprovalsTab";
import { FeatureGate } from "@/components/app/FeatureGate";

const STORAGE_KEY = "markaestro_default_product";

type Product = { id: string; name: string };

const tabs = [
  { value: "create", label: "Create" },
  { value: "drafts", label: "Drafts" },
  { value: "approvals", label: "Approvals" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
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
    <div
      className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg mb-5"
      style={{
        background: "var(--mk-paper)",
        border: "1px solid var(--mk-rule)",
      }}
    >
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 6, height: 6, background: "var(--mk-accent)" }}
      />
      <span
        className="font-mono text-[9.5px] uppercase shrink-0"
        style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
      >
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
          className="flex-1 min-w-0 bg-transparent border-none outline-none cursor-pointer text-[13px] font-medium"
          style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <>
          <span
            className="flex-1 text-[13px] font-medium truncate min-w-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
          >
            {selected?.name ?? "No product selected"}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 text-[11px] px-2 py-1 rounded transition-colors"
            style={{ color: "var(--mk-ink-60)" }}
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
        title="Posts"
        subtitle="Create, schedule, and publish organic content across your social channels."
      />

      {/* Persistent product context — always visible above tabs */}
      <ProductContextBar
        products={products}
        productId={productId}
        onChange={handleProductChange}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5 sm:space-y-6 min-w-0 w-full">
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
        <TabsList
          className="hidden lg:flex bg-transparent rounded-none p-0 h-auto gap-6 w-full overflow-x-auto border-b"
          style={{ borderColor: "var(--mk-rule-soft)" }}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 py-2.5 text-[13px] font-normal data-[state=active]:font-semibold data-[state=active]:text-foreground transition-colors whitespace-nowrap"
              style={{
                color: "var(--mk-ink-60)",
                letterSpacing: "-0.005em",
              }}
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

        <TabsContent value="performance">
          <PerformanceTab refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
