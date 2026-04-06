"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import { Trash2, Upload, X, Loader2 } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import TagInput from "@/components/app/TagInput";
import ScanProgressStepper from "@/components/app/ScanProgressStepper";
import { useProductScan } from "@/hooks/useProductScan";
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";

type BrandVoice = {
  tone: string;
  style: string;
  keywords: string[];
  avoidWords: string[];
  cta: string;
  sampleVoice: string;
  targetAudience: string;
};

type BrandIdentity = {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
};

type Product = {
  id: string;
  name: string;
  description: string;
  url: string;
  categories?: string[];
  category?: string; // legacy field — coalesced in UI
  status: string;
  pricingTier: string;
  tags: string[];
  brandVoice?: BrandVoice;
  brandIdentity?: BrandIdentity;
  createdAt?: string;
};

type IntegrationInfo = {
  provider: string;
  scope?: "workspace" | "product";
  productId?: string | null;
  enabled: boolean;
  status: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  fromEmail?: string;
  tokenExpiresAt?: string | null;
  pageId?: string | null;
  pageName?: string | null;
  pageSelectionRequired?: boolean | null;
  igAccountId?: string | null;
  adAccountId?: string | null;
  advertiserId?: string | null;
  advertiserAccessRequired?: boolean | null;
  lastRefreshError?: string | null;
  username?: string | null;
  needsPageSelection?: boolean;
};

type MetaPage = {
  id: string;
  name: string;
  hasInstagram: boolean;
  igAccountId: string | null;
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  beta: "bg-blue-50 text-blue-700",
  development: "bg-amber-50 text-amber-700",
  sunset: "bg-rose-50 text-rose-700",
  archived: "bg-gray-100 text-gray-600",
};

const categoryLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile App",
  web: "Web App",
  api: "API",
  marketplace: "Marketplace",
  other: "Other",
};

const SOCIAL_PROVIDERS = ["meta", "tiktok", "tiktok_ads"] as const;
const providerLabels: Record<string, string> = {
  meta: "Meta (Facebook + Instagram)",
  tiktok: "TikTok",
  tiktok_ads: "TikTok Ads",
};

function getScopedSocialIntegrations(integrations: IntegrationInfo[]) {
  return integrations.filter(
    (integration) =>
      SOCIAL_PROVIDERS.includes(integration.provider as typeof SOCIAL_PROVIDERS[number]) &&
      (integration.scope === "product" ||
        // Include workspace-level Meta that needs page selection for this product
        (integration.provider === "meta" && integration.scope === "workspace")),
  );
}

// Curated color palette for brand colors
const COLOR_PALETTE = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308",
  "#84CC16", "#22C55E", "#10B981", "#14B8A6",
  "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1",
  "#2563EB", "#1D4ED8", "#1E40AF", "#0EA5E9",
  "#F43F5E", "#000000", "#374151", "#6B7280",
  "#9CA3AF", "#D1D5DB", "#F3F4F6", "#FFFFFF",
];

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const nativeRef = useRef<HTMLInputElement>(null);

  return (
    <FormField label={label}>
      <div className="space-y-2">
        {/* Palette grid */}
        <div className="grid grid-cols-8 gap-1.5">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={`h-7 w-full rounded-md border transition-all ${value === color ? "ring-2 ring-primary ring-offset-1" : "hover:scale-110"} ${color === "#FFFFFF" ? "border-gray-300" : "border-transparent"}`}
              style={{ backgroundColor: color }}
              onClick={() => onChange(color)}
            />
          ))}
        </div>
        {/* Hex input + native picker */}
        <div className="flex items-center gap-2">
          <div
            className="h-9 w-9 shrink-0 rounded-md border cursor-pointer"
            style={{ backgroundColor: value && /^#[0-9A-Fa-f]{6}$/i.test(value) ? value : "#ffffff" }}
            onClick={() => nativeRef.current?.click()}
          />
          <input
            ref={nativeRef}
            type="color"
            value={value && /^#[0-9A-Fa-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="sr-only"
          />
          <Input
            placeholder="#4F46E5"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 font-mono text-sm"
          />
          {value && (
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => onChange("")}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </FormField>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newCategories, setNewCategories] = useState<string[]>(["saas"]);
  const [newPricing, setNewPricing] = useState<string[]>([]);
  const [newTags, setNewTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // URL scan
  const [scanUrl, setScanUrl] = useState("");
  const { phase: scanPhase, scanning, scanned, scan: runScan, reset: resetScan } = useProductScan();
  const [scanPrimaryColor, setScanPrimaryColor] = useState("#6366f1");
  const [scanSecondaryColor, setScanSecondaryColor] = useState("");
  const [scanAccentColor, setScanAccentColor] = useState("");
  const [scanLogoUrl, setScanLogoUrl] = useState("");
  const [scanTargetAudience, setScanTargetAudience] = useState("");
  const [scanTone, setScanTone] = useState("");

  // Edit sheet state — product details
  const [editOpen, setEditOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editCategories, setEditCategories] = useState<string[]>(["saas"]);
  const [editStatus, setEditStatus] = useState("active");
  const [editPricing, setEditPricing] = useState<string[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Brand voice state
  const [bvTone, setBvTone] = useState("");
  const [bvStyle, setBvStyle] = useState("");
  const [bvKeywords, setBvKeywords] = useState("");
  const [bvAvoidWords, setBvAvoidWords] = useState("");
  const [bvCta, setBvCta] = useState("");
  const [bvSampleVoice, setBvSampleVoice] = useState("");
  const [bvTargetAudience, setBvTargetAudience] = useState("");
  const [bvSaving, setBvSaving] = useState(false);

  // Brand identity state
  const [biLogoUrl, setBiLogoUrl] = useState("");
  const [biPrimaryColor, setBiPrimaryColor] = useState("");
  const [biSecondaryColor, setBiSecondaryColor] = useState("");
  const [biAccentColor, setBiAccentColor] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Per-product integrations state
  const [productIntegrations, setProductIntegrations] = useState<IntegrationInfo[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectingPage, setSelectingPage] = useState(false);
  const [metaAdAccountId, setMetaAdAccountId] = useState("");
  const [savingAdAccount, setSavingAdAccount] = useState(false);

  // Per-product connection status cache (productId -> IntegrationInfo[])
  const [connectionCache, setConnectionCache] = useState<Record<string, IntegrationInfo[]>>({});

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

  const fetchProductIntegrations = useCallback(async (productId: string) => {
    const res = await apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${productId}`);
    if (res.ok) {
      setProductIntegrations(getScopedSocialIntegrations(res.data.integrations || []));
    }
  }, []);

  const fetchConnectionStatuses = useCallback(async (productList: Product[]) => {
    const cache: Record<string, IntegrationInfo[]> = {};
    for (const p of productList) {
      const res = await apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${p.id}`);
      if (res.ok) {
        cache[p.id] = getScopedSocialIntegrations(res.data.integrations || []);
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
      toast.success(`${providerLabels[provider] || provider} connected successfully`);
      window.history.replaceState({}, "", "/products");
      fetchProducts();
    } else if (oauthResult === "error" && provider) {
      const message = params.get("message");
      toast.error(`${provider} OAuth failed: ${message || "Unknown error"}`);
      window.history.replaceState({}, "", "/products");
    }

    // If we just came back from OAuth for a specific product, open its edit sheet
    if (oauthResult === "success" && productId) {
      setTimeout(async () => {
        const res = await apiGet<{ products: Product[] }>("/api/products");
        if (res.ok) {
          const product = (res.data.products || []).find((p) => p.id === productId);
          if (product) {
            await openEditSheet(product);
            if (provider === "meta" && needsPageSelect === "1") {
              toast.error("Select a Facebook page to finish Meta setup");
            }
          }
        }
      }, 500);
    }
  }, []);

  useEffect(() => {
    if (products.length > 0) {
      fetchConnectionStatuses(products);
    }
  }, [products, fetchConnectionStatuses]);

  const handleScan = async () => {
    const url = scanUrl.trim();
    if (!url) { toast.error("Enter a URL first"); return; }
    let fullUrl = url;
    if (!/^https?:\/\//i.test(url)) fullUrl = `https://${url}`;

    const d = await runScan(fullUrl);
    if (d) {
      setNewName(d.name || "");
      setNewDescription(d.description || "");
      setNewUrl(fullUrl);
      setNewCategories(d.category ? [d.category] : ["saas"]);
      setNewPricing(d.pricingTier ? d.pricingTier.split(",").map((s: string) => s.trim()).filter(Boolean) : []);
      setNewTags(d.tags || []);
      setScanPrimaryColor(d.primaryColor || "#6366f1");
      setScanSecondaryColor(d.secondaryColor || "");
      setScanAccentColor(d.accentColor || "");
      setScanLogoUrl(d.logoUrl || "");
      setScanTargetAudience(d.targetAudience || "");
      setScanTone(d.tone || "");
    }
  };

  const resetCreateForm = () => {
    setScanUrl(""); resetScan();
    setNewName(""); setNewDescription(""); setNewUrl(""); setNewCategories(["saas"]); setNewPricing([]); setNewTags([]);
    setScanPrimaryColor("#6366f1"); setScanSecondaryColor(""); setScanAccentColor(""); setScanLogoUrl("");
    setScanTargetAudience(""); setScanTone("");
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await apiPost("/api/products", {
        name: newName,
        description: newDescription,
        url: newUrl || "",
        categories: newCategories,
        pricingTier: newPricing.join(", "),
        tags: newTags,
      });
      if (res.ok) {
        const newProduct = res.data as Product;
        // If scanned, save brand voice + identity in the background
        if (scanned && newProduct.id) {
          apiPut(`/api/products/${newProduct.id}/brand-voice`, {
            tone: scanTone,
            style: "",
            keywords: [],
            avoidWords: [],
            cta: "",
            sampleVoice: "",
            targetAudience: scanTargetAudience,
            brandIdentity: {
              logoUrl: scanLogoUrl,
              primaryColor: scanPrimaryColor,
              secondaryColor: scanSecondaryColor,
              accentColor: scanAccentColor,
            },
          }).catch(() => {}); // best-effort
        }
        toast.success("Product added");
        resetCreateForm();
        setProducts((prev) => [newProduct, ...prev]);
        fetchProducts();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create product");
      }
    } catch {
      toast.error("Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/products/${id}`);
    if (res.ok) {
      toast.success("Product deleted");
      fetchProducts();
    } else {
      toast.error("Failed to delete product");
    }
  };

  const openEditSheet = async (product: Product) => {
    setEditProductId(product.id);
    setEditName(product.name || "");
    setEditDescription(product.description || "");
    setEditUrl(product.url || "");
    setEditCategories(product.categories?.length ? product.categories : product.category ? [product.category] : ["saas"]);
    setEditStatus(product.status || "active");
    setEditPricing((product.pricingTier || "").split(",").map((s) => s.trim()).filter(Boolean));
    setEditTags(product.tags || []);

    // Load brand voice & identity
    const res = await apiGet<{ brandVoice: BrandVoice | null; brandIdentity: BrandIdentity | null }>(`/api/products/${product.id}/brand-voice`);
    if (res.ok && res.data.brandVoice) {
      const bv = res.data.brandVoice;
      setBvTone(bv.tone || ""); setBvStyle(bv.style || "");
      setBvKeywords((bv.keywords || []).join(", ")); setBvAvoidWords((bv.avoidWords || []).join(", "));
      setBvCta(bv.cta || ""); setBvSampleVoice(bv.sampleVoice || ""); setBvTargetAudience(bv.targetAudience || "");
    } else {
      setBvTone(""); setBvStyle(""); setBvKeywords(""); setBvAvoidWords("");
      setBvCta(""); setBvSampleVoice(""); setBvTargetAudience("");
    }
    if (res.ok && res.data.brandIdentity) {
      const bi = res.data.brandIdentity;
      setBiLogoUrl(bi.logoUrl || ""); setBiPrimaryColor(bi.primaryColor || "");
      setBiSecondaryColor(bi.secondaryColor || ""); setBiAccentColor(bi.accentColor || "");
    } else {
      setBiLogoUrl(""); setBiPrimaryColor(""); setBiSecondaryColor(""); setBiAccentColor("");
    }

    // Load integrations — reset first so stale data from a previous product never shows
    setProductIntegrations([]);
    setMetaPages([]); setSelectedPageId(""); setMetaAdAccountId("");
    const intRes = await apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${product.id}`);
    if (intRes.ok) {
      const scopedIntegrations = getScopedSocialIntegrations(intRes.data.integrations || []);
      setProductIntegrations(scopedIntegrations);
      const metaConn = scopedIntegrations.find((i) => i.provider === "meta");
      if (metaConn?.adAccountId) setMetaAdAccountId(metaConn.adAccountId as string);
      setEditOpen(true);
      // Auto-load pages if Meta is connected (workspace or product) but no page selected
      if (metaConn && !metaConn.pageId) {
        void loadMetaPages(product.id);
      }
      return;
    } else {
      toast.error("Failed to load integrations");
    }
    setEditOpen(true);
  };

  const saveProduct = async () => {
    if (!editProductId) return;
    setEditSaving(true);
    try {
      const res = await apiPut(`/api/products/${editProductId}`, {
        name: editName,
        description: editDescription,
        url: editUrl || "",
        categories: editCategories,
        status: editStatus,
        pricingTier: editPricing.join(", "),
        tags: editTags,
      });
      if (res.ok) {
        toast.success("Product updated");
        fetchProducts();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to update product");
      }
    } catch {
      toast.error("Failed to update product");
    } finally {
      setEditSaving(false);
    }
  };

  const saveBrandVoice = async () => {
    if (!editProductId) return;
    setBvSaving(true);
    try {
      const res = await apiPut(`/api/products/${editProductId}/brand-voice`, {
        tone: bvTone, style: bvStyle,
        keywords: bvKeywords.split(",").map((k) => k.trim()).filter(Boolean),
        avoidWords: bvAvoidWords.split(",").map((k) => k.trim()).filter(Boolean),
        cta: bvCta, sampleVoice: bvSampleVoice, targetAudience: bvTargetAudience,
        brandIdentity: { logoUrl: biLogoUrl, primaryColor: biPrimaryColor, secondaryColor: biSecondaryColor, accentColor: biAccentColor },
      });
      if (res.ok) toast.success("Brand voice saved");
      else toast.error("Failed to save brand voice");
    } catch { toast.error("Failed to save brand voice"); }
    finally { setBvSaving(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editProductId) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB");
      return;
    }

    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await apiUpload<{ ok: boolean; logoUrl: string }>(`/api/products/${editProductId}/upload-logo`, formData);
      if (res.ok && res.data.logoUrl) {
        setBiLogoUrl(res.data.logoUrl);
        toast.success("Logo uploaded");
        fetchProducts();
      } else {
        toast.error("Failed to upload logo");
      }
    } catch {
      toast.error("Failed to upload logo");
    } finally {
      setLogoUploading(false);
      // Reset file input
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // --- Integration helpers ---

  const getProviderIntegration = (provider: string) =>
    productIntegrations.find((i) => i.provider === provider);

  async function startOAuth(provider: string, productId: string) {
    try {
      // Meta: workspace-level OAuth (productId passed only for redirect-back)
      const body = provider === "meta" ? { productId } : { productId };
      const res = await apiPost<{ authUrl: string }>(`/api/oauth/authorize/${provider}`, body);
      if (res.ok && res.data.authUrl) window.location.href = res.data.authUrl;
      else toast.error(`Failed to start ${provider} OAuth`);
    } catch { toast.error(`Failed to start ${provider} OAuth`); }
  }

  async function disconnectProvider(provider: string, productId: string) {
    setDisconnecting(provider);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, { productId });
      if (res.ok) {
        toast.success(`${providerLabels[provider] || provider} disconnected`);
        await fetchProductIntegrations(productId);
        fetchProducts();
      } else toast.error(`Failed to disconnect ${provider}`);
    } catch { toast.error(`Failed to disconnect ${provider}`); }
    finally { setDisconnecting(null); }
  }

  async function loadMetaPages(_productId?: string) {
    setLoadingPages(true);
    try {
      // User token is workspace-level — no productId needed
      const res = await apiGet<{ pages: MetaPage[]; error?: string }>(`/api/oauth/pages/meta`);
      if (res.ok) {
        setMetaPages(res.data.pages || []);
        if (res.data.pages?.length === 0) toast.error("No Facebook pages found.");
      }
    } catch { toast.error("Failed to load pages"); }
    finally { setLoadingPages(false); }
  }

  async function selectMetaPage(productId: string) {
    if (!selectedPageId) { toast.error("Select a page first"); return; }
    setSelectingPage(true);
    const page = metaPages.find((p) => p.id === selectedPageId);
    try {
      const res = await apiPost<{ ok: boolean; pageName: string }>("/api/oauth/pages/meta/select", { pageId: selectedPageId, pageName: page?.name, productId });
      if (res.ok && res.data.ok) {
        toast.success(`Page "${res.data.pageName}" selected`);
        setMetaPages([]);
        setSelectedPageId("");
        await fetchProductIntegrations(productId);
        fetchProducts();
      }
      else toast.error("Failed to select page");
    } catch { toast.error("Failed to select page"); }
    finally { setSelectingPage(false); }
  }

  async function saveMetaAdAccount(productId: string) {
    if (!metaAdAccountId.trim()) { toast.error("Enter an ad account ID"); return; }
    setSavingAdAccount(true);
    try {
      const res = await apiPost("/api/integrations/meta/ad-account", { adAccountId: metaAdAccountId.trim(), productId });
      if (res.ok) { toast.success("Ad account ID saved"); }
      else toast.error("Failed to save ad account ID");
    } catch { toast.error("Failed to save ad account ID"); }
    finally { setSavingAdAccount(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Products"
        subtitle="Register and track the applications you market."
        action={
          <Sheet onOpenChange={(open) => { if (!open) resetCreateForm(); }}>
            <SheetTrigger asChild>
              <Button className="rounded-xl">Add Product</Button>
            </SheetTrigger>
            <SheetContent className="overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Add Product</SheetTitle>
                <SheetDescription>
                  {scanned ? "Review and confirm the details below." : "Enter your website URL and we'll fill in the details automatically."}
                </SheetDescription>
              </SheetHeader>
              <div className="px-6 py-4 space-y-4">

                {/* Step 1: URL + Scan */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Website URL</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://yourproduct.com"
                      value={scanUrl}
                      onChange={(e) => { setScanUrl(e.target.value); if (scanned) resetScan(); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
                      disabled={scanning}
                      className="flex-1"
                    />
                    <Button onClick={handleScan} disabled={scanning || !scanUrl.trim()} className="shrink-0">
                      {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      <span className={scanning ? "ml-1.5" : ""}>{scanning ? "Scanning…" : scanned ? "Re-scan" : "Scan"}</span>
                    </Button>
                  </div>
                  <ScanProgressStepper phase={scanPhase} url={scanUrl} compact />
                </div>

                {/* Step 2: Prefilled form — always visible but highlighted after scan */}
                <div className={`space-y-4 transition-opacity ${scanning ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
                  <FormField label="Product Name">
                    <Input placeholder="DripCheckr" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </FormField>
                  <FormField label="Description">
                    <Textarea placeholder="What does your product do?" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} />
                  </FormField>
                  <FormField label="URL">
                    <Input placeholder="https://yourproduct.com" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Category">
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(categoryLabels).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setNewCategories((prev) =>
                              prev.includes(val) ? (prev.length > 1 ? prev.filter((c) => c !== val) : prev) : [...prev, val]
                            )}
                            className={`px-2.5 py-1 rounded-md border text-xs transition-all ${
                              newCategories.includes(val)
                                ? "border-foreground bg-foreground text-background font-medium"
                                : "border-border/60 text-muted-foreground hover:border-foreground/30"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </FormField>
                    <FormField label="Pricing Tier">
                      <TagInput tags={newPricing} onChange={setNewPricing} placeholder="Free, Pro $29/mo…" />
                    </FormField>
                  </div>
                  <FormField label="Tags">
                    <TagInput tags={newTags} onChange={setNewTags} placeholder="analytics, ai, b2b…" />
                  </FormField>

                  {/* Brand colors — shown when scanned */}
                  {scanned && (
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
                      <p className="text-xs font-semibold">Brand Colors (detected)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField label="Primary Color">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={scanPrimaryColor}
                              onChange={(e) => setScanPrimaryColor(e.target.value)}
                              className="h-8 w-10 rounded cursor-pointer border border-border"
                            />
                            <Input
                              value={scanPrimaryColor}
                              onChange={(e) => setScanPrimaryColor(e.target.value)}
                              className="flex-1 font-mono text-xs"
                              placeholder="#6366f1"
                            />
                          </div>
                        </FormField>
                        <FormField label="Secondary Color">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={scanSecondaryColor || "#ffffff"}
                              onChange={(e) => setScanSecondaryColor(e.target.value)}
                              className="h-8 w-10 rounded cursor-pointer border border-border"
                            />
                            <Input
                              value={scanSecondaryColor}
                              onChange={(e) => setScanSecondaryColor(e.target.value)}
                              className="flex-1 font-mono text-xs"
                              placeholder="#ffffff"
                            />
                          </div>
                        </FormField>
                        <FormField label="Accent Color">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={scanAccentColor || "#ffffff"}
                              onChange={(e) => setScanAccentColor(e.target.value)}
                              className="h-8 w-10 rounded cursor-pointer border border-border"
                            />
                            <Input
                              value={scanAccentColor}
                              onChange={(e) => setScanAccentColor(e.target.value)}
                              className="flex-1 font-mono text-xs"
                              placeholder="#ffffff"
                            />
                          </div>
                        </FormField>
                      </div>
                      {scanTargetAudience && (
                        <FormField label="Target Audience">
                          <Input value={scanTargetAudience} onChange={(e) => setScanTargetAudience(e.target.value)} />
                        </FormField>
                      )}
                      {scanTone && (
                        <FormField label="Brand Tone">
                          <Input value={scanTone} onChange={(e) => setScanTone(e.target.value)} />
                        </FormField>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <SheetFooter className="px-6 pb-6">
                <SheetClose asChild>
                  <Button
                    onClick={handleCreate}
                    disabled={saving || !newName.trim()}
                    className="w-full"
                  >
                    {saving ? "Saving…" : scanned ? "Confirm & Save Product" : "Save Product"}
                  </Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 rounded-2xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <Card className="col-span-full border-border/30">
            <CardContent className="py-16 text-center">
              <p className="text-base font-medium text-foreground">No products registered yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first application to start tracking its marketing performance.</p>
            </CardContent>
          </Card>
        ) : (
          products.map((p) => (
            <Card key={p.id} className="card-premium border-border/30">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {p.brandIdentity?.logoUrl ? (
                      <img
                        src={p.brandIdentity.logoUrl}
                        alt={`${p.name} logo`}
                        className="h-10 w-10 rounded-lg object-contain border bg-white shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg border bg-muted/50 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-medium text-muted-foreground">{p.name.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <CardTitle className="text-lg">{p.name}</CardTitle>
                      <CardDescription className="mt-0.5">
                        {(p.categories?.length ? p.categories : p.category ? [p.category] : ["saas"]).map((c) => categoryLabels[c] || c).join(" · ")}
                        {p.pricingTier && ` \u2022 ${p.pricingTier}`}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge variant="outline" className={`capitalize border-0 text-xs ${statusColors[p.status] || ""}`}>
                      {p.status}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {p.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{p.description}</p>
                )}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline mb-3 block">
                    {p.url}
                  </a>
                )}
                {p.tags && p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium border border-border">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {connectionCache[p.id] && connectionCache[p.id].length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {connectionCache[p.id].map((integ) => {
                      const isConnected = integ.status === "connected";
                      const hasError = !!integ.lastRefreshError;
                      const label = integ.provider === "meta" ? "Meta" : integ.provider === "tiktok_ads" ? "TikTok Ads" : "TikTok";
                      const detail = integ.provider === "meta" && integ.pageName
                        ? integ.pageName
                        : null;
                      return (
                        <span
                          key={integ.provider}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            isConnected && !hasError
                              ? "bg-emerald-50 text-emerald-700"
                              : hasError
                              ? "bg-amber-50 text-amber-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                          title={hasError ? `Reconnect needed: ${integ.lastRefreshError}` : detail || label}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${isConnected && !hasError ? "bg-emerald-500" : "bg-amber-500"}`} />
                          {label}{detail ? `: ${detail}` : ""}
                          {hasError && " ⚠"}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between mt-3">
                  {p.createdAt && (
                    <p className="text-xs text-muted-foreground">Added {new Date(p.createdAt).toLocaleDateString()}</p>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openEditSheet(p)}>
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Product Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Product</SheetTitle>
            <SheetDescription>Update product details, brand voice, and connected accounts.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Product Details */}
            <FormField label="Product Name">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </FormField>
            <FormField label="Description">
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </FormField>
            <FormField label="URL">
              <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Category">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(categoryLabels).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setEditCategories((prev) =>
                        prev.includes(val) ? (prev.length > 1 ? prev.filter((c) => c !== val) : prev) : [...prev, val]
                      )}
                      className={`px-2.5 py-1 rounded-md border text-xs transition-all ${
                        editCategories.includes(val)
                          ? "border-foreground bg-foreground text-background font-medium"
                          : "border-border/60 text-muted-foreground hover:border-foreground/30"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </FormField>
              <FormField label="Status">
                <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="beta">Beta</option>
                  <option value="development">Development</option>
                  <option value="sunset">Sunset</option>
                  <option value="archived">Archived</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Pricing Tier">
              <TagInput tags={editPricing} onChange={setEditPricing} placeholder="Free, Pro $29/mo…" />
            </FormField>
            <FormField label="Tags">
              <TagInput tags={editTags} onChange={setEditTags} placeholder="analytics, ai, b2b…" />
            </FormField>
            <Button onClick={saveProduct} disabled={editSaving} className="w-full">
              {editSaving ? "Saving..." : "Save Product Details"}
            </Button>

            {/* Brand Voice Section */}
            <div className="border-t pt-4 mt-2">
              <p className="text-sm font-semibold mb-3">Brand Voice</p>
              <div className="space-y-4">
                <FormField label="Tone">
                  <Input placeholder="Professional, friendly, bold..." value={bvTone} onChange={(e) => setBvTone(e.target.value)} />
                </FormField>
                <FormField label="Style">
                  <Input placeholder="Concise, technical, conversational..." value={bvStyle} onChange={(e) => setBvStyle(e.target.value)} />
                </FormField>
                <FormField label="Keywords (comma separated)">
                  <Input placeholder="innovate, automate, scale..." value={bvKeywords} onChange={(e) => setBvKeywords(e.target.value)} />
                </FormField>
                <FormField label="Words to Avoid (comma separated)">
                  <Input placeholder="synergy, leverage, disrupt..." value={bvAvoidWords} onChange={(e) => setBvAvoidWords(e.target.value)} />
                </FormField>
                <FormField label="Default CTA">
                  <Input placeholder="Start your free trial" value={bvCta} onChange={(e) => setBvCta(e.target.value)} />
                </FormField>
                <FormField label="Target Audience">
                  <Input placeholder="SaaS founders, indie hackers..." value={bvTargetAudience} onChange={(e) => setBvTargetAudience(e.target.value)} />
                </FormField>
                <FormField label="Sample Voice">
                  <Textarea placeholder="Paste an example of your ideal brand writing here..." value={bvSampleVoice} onChange={(e) => setBvSampleVoice(e.target.value)} rows={4} />
                </FormField>
              </div>
            </div>

            {/* Brand Identity */}
            <div className="border-t pt-4 mt-2">
              <p className="text-sm font-semibold mb-3">Brand Identity</p>
              <div className="space-y-4">
                {/* Logo Upload */}
                <FormField label="Logo">
                  <div className="space-y-3">
                    {biLogoUrl && (
                      <div className="flex items-center gap-3">
                        <img
                          src={biLogoUrl}
                          alt="Product logo"
                          className="h-16 w-16 rounded-lg object-contain border bg-white"
                        />
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setBiLogoUrl("")}>
                          Remove
                        </Button>
                      </div>
                    )}
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      className="w-full"
                    >
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      {logoUploading ? "Uploading..." : biLogoUrl ? "Replace Logo" : "Upload Logo"}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">PNG, JPG, WebP, or SVG. Max 2 MB.</p>
                  </div>
                </FormField>

                <ColorPicker label="Primary Color" value={biPrimaryColor} onChange={setBiPrimaryColor} />
                <ColorPicker label="Secondary Color" value={biSecondaryColor} onChange={setBiSecondaryColor} />
                <ColorPicker label="Accent Color" value={biAccentColor} onChange={setBiAccentColor} />
              </div>
              <Button onClick={saveBrandVoice} disabled={bvSaving} variant="outline" className="w-full mt-4">
                {bvSaving ? "Saving..." : "Save Brand Voice & Identity"}
              </Button>
            </div>

            {/* Connected Accounts */}
            {editProductId && (
              <div className="border-t pt-4 mt-2">
                <p className="text-sm font-semibold mb-3">Connected Accounts</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Connect social accounts for this product.
                </p>
                <div className="space-y-3">
                  {/* Meta — page picker only (auth is in Settings) */}
                  {(() => {
                    const metaInteg = getProviderIntegration("meta");
                    const metaConnected = metaInteg?.status === "connected" || (metaInteg?.scope === "workspace" && metaInteg?.needsPageSelection);

                    return (
                      <div className="rounded-xl border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{providerLabels.meta}</p>
                            {metaConnected && (
                              <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px]">Connected</Badge>
                            )}
                            {metaConnected && !metaInteg?.pageId && (
                              <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px]">Select Page</Badge>
                            )}
                          </div>
                        </div>

                        {metaConnected ? (
                          <div className="space-y-2 pl-1">
                            {metaInteg?.pageName && (
                              <p className="text-xs text-muted-foreground">
                                Page: <span className="font-medium text-foreground">{metaInteg.pageName}</span>{metaInteg.igAccountId && " (Instagram linked)"}
                              </p>
                            )}
                            {!metaInteg?.pageId && (
                              <p className="text-xs text-amber-700">
                                Select a Facebook page for this product to enable publishing.
                              </p>
                            )}
                            <Button variant="outline" size="sm" onClick={() => { loadMetaPages(editProductId); setSelectedPageId(""); }} disabled={loadingPages}>
                              {loadingPages ? "Loading..." : metaInteg?.pageId ? "Change Page" : "Select Page"}
                            </Button>
                            {metaPages.length > 0 && (
                              <div className="flex gap-2">
                                <Select value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} className="flex-1">
                                  <option value="">Select a page...</option>
                                  {metaPages.map((pg) => (
                                    <option key={pg.id} value={pg.id}>{pg.name} {pg.hasInstagram ? "(IG linked)" : ""}</option>
                                  ))}
                                </Select>
                                <Button size="sm" onClick={() => selectMetaPage(editProductId)} disabled={selectingPage || !selectedPageId}>
                                  {selectingPage ? "..." : "Select"}
                                </Button>
                              </div>
                            )}
                            {/* Ad Account ID for running paid campaigns */}
                            <div className="pt-1">
                              <p className="text-xs font-medium text-foreground mb-1">Ad Account ID</p>
                              <p className="text-[11px] text-muted-foreground mb-1.5">
                                Required to run paid campaigns. Find it in Meta Business Manager (format: act_XXXXXXXXX).
                              </p>
                              <div className="flex gap-2">
                                <Input
                                  placeholder="act_123456789"
                                  value={metaAdAccountId}
                                  onChange={(e) => setMetaAdAccountId(e.target.value)}
                                  className="flex-1 h-8 text-xs font-mono"
                                />
                                <Button size="sm" className="h-8" onClick={() => saveMetaAdAccount(editProductId)} disabled={savingAdAccount || !metaAdAccountId.trim()}>
                                  {savingAdAccount ? "..." : "Save"}
                                </Button>
                              </div>
                              {metaInteg?.adAccountId && (
                                <p className="text-[11px] text-emerald-600 mt-1">Saved: {metaInteg.adAccountId}</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground pl-1">
                            Connect Meta in <a href="/settings" className="text-primary hover:underline">Settings</a> first, then select a page here.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* TikTok & TikTok Ads — per-product connect/disconnect */}
                  {(["tiktok", "tiktok_ads"] as const).map((provider) => {
                    const integ = getProviderIntegration(provider);
                    const connected = integ?.status === "connected";
                    const missingAdvertiserAccess =
                      provider === "tiktok_ads" &&
                      connected &&
                      (!integ?.advertiserId || integ?.advertiserAccessRequired);

                    return (
                      <div key={provider} className="rounded-xl border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{providerLabels[provider]}</p>
                            {connected && (
                              <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px]">Connected</Badge>
                            )}
                            {integ?.lastRefreshError && (
                              <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px]">Reconnect</Badge>
                            )}
                            {missingAdvertiserAccess && (
                              <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px]">No advertiser access</Badge>
                            )}
                          </div>
                          {connected ? (
                            <Button variant="destructive" size="sm" onClick={() => disconnectProvider(provider, editProductId)} disabled={disconnecting === provider}>
                              {disconnecting === provider ? "..." : "Disconnect"}
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => startOAuth(provider, editProductId)}>Connect</Button>
                          )}
                        </div>

                        {connected && integ?.tokenExpiresAt && (
                          <p className="text-xs text-muted-foreground pl-1">
                            Token expires: {new Date(integ.tokenExpiresAt).toLocaleDateString()}
                          </p>
                        )}

                        {missingAdvertiserAccess && (
                          <p className="text-xs text-amber-700 pl-1">
                            TikTok Ads linked successfully, but TikTok did not return any advertiser account access for this login. Add or authorize your sandbox advertiser in TikTok for Business, then reconnect.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
