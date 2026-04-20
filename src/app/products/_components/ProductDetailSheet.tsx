"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, X, Loader2, Check, Dot, Globe, Palette, Link2, Mic,
  Package, Trash2, Image as ImageIcon,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import TagInput from "@/components/app/TagInput";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiGet, apiPut, apiPost, apiDelete, apiUpload } from "@/lib/api-client";
import { getCurrentInAppBrowserName, isCurrentBrowserMobile } from "@/lib/in-app-browser";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------- types ----------

export type BrandVoice = {
  tone: string;
  style: string;
  keywords: string[];
  avoidWords: string[];
  cta: string;
  sampleVoice: string;
  targetAudience: string;
};

export type BrandIdentity = {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  url: string;
  categories?: string[];
  category?: string;
  status: string;
  pricingTier: string;
  tags: string[];
  brandVoice?: BrandVoice;
  brandIdentity?: BrandIdentity;
  createdAt?: string;
};

export type IntegrationInfo = {
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

// ---------- constants ----------

const categoryLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile App",
  web: "Web App",
  api: "API",
  marketplace: "Marketplace",
  other: "Other",
};

const SOCIAL_PROVIDERS = ["meta", "instagram", "tiktok", "linkedin"] as const;
const providerLabels: Record<string, string> = {
  meta: "Meta (Facebook + Instagram)",
  instagram: "Instagram (direct login)",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

const COLOR_PALETTE = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308",
  "#84CC16", "#22C55E", "#10B981", "#14B8A6",
  "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1",
  "#2563EB", "#1D4ED8", "#1E40AF", "#8B5CF6",
  "#F43F5E", "#000000", "#374151", "#6B7280",
  "#9CA3AF", "#D1D5DB", "#F3F4F6", "#FFFFFF",
];

function getScopedSocialIntegrations(integrations: IntegrationInfo[]) {
  return integrations.filter(
    (integration) =>
      SOCIAL_PROVIDERS.includes(integration.provider as typeof SOCIAL_PROVIDERS[number]) &&
      (integration.scope === "product" ||
        (integration.provider === "meta" && integration.scope === "workspace")),
  );
}

// ---------- form shape + dirty tracking ----------

type Form = {
  name: string;
  description: string;
  url: string;
  categories: string[];
  status: string;
  pricing: string[];
  tags: string[];
  voice: {
    tone: string;
    style: string;
    keywords: string;
    avoidWords: string;
    cta: string;
    sampleVoice: string;
    targetAudience: string;
  };
  identity: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
};

function buildForm(
  product: Product,
  voice: BrandVoice | null,
  identity: BrandIdentity | null,
): Form {
  return {
    name: product.name || "",
    description: product.description || "",
    url: product.url || "",
    categories: product.categories?.length
      ? [...product.categories]
      : product.category
      ? [product.category]
      : ["saas"],
    status: product.status || "active",
    pricing: (product.pricingTier || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    tags: [...(product.tags || [])],
    voice: {
      tone: voice?.tone || "",
      style: voice?.style || "",
      keywords: (voice?.keywords || []).join(", "),
      avoidWords: (voice?.avoidWords || []).join(", "),
      cta: voice?.cta || "",
      sampleVoice: voice?.sampleVoice || "",
      targetAudience: voice?.targetAudience || "",
    },
    identity: {
      logoUrl: identity?.logoUrl || "",
      primaryColor: identity?.primaryColor || "",
      secondaryColor: identity?.secondaryColor || "",
      accentColor: identity?.accentColor || "",
    },
  };
}

function hasChanges(a: Form, b: Form) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// ---------- section nav ----------

type SectionKey = "foundation" | "voice" | "identity" | "channels";

const sections: { key: SectionKey; label: string; icon: typeof Package }[] = [
  { key: "foundation", label: "Foundation", icon: Package },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "identity", label: "Identity", icon: Palette },
  { key: "channels", label: "Channels", icon: Link2 },
];

// ---------- inline color picker ----------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const isValid = value && /^#[0-9A-Fa-f]{6}$/i.test(value);
  return (
    <FormField label={label}>
      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-1">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Set ${label} to ${c}`}
              className={cn(
                "h-6 w-full rounded-md border transition-all",
                value === c
                  ? "ring-2 ring-foreground ring-offset-1 ring-offset-background scale-105"
                  : "hover:scale-110",
                c === "#FFFFFF" ? "border-border" : "border-transparent",
              )}
              style={{ backgroundColor: c }}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Open color picker"
            className="h-9 w-9 shrink-0 rounded-md border border-border cursor-pointer"
            style={{ backgroundColor: isValid ? value : "#ffffff" }}
            onClick={() => nativeRef.current?.click()}
          />
          <input
            ref={nativeRef}
            type="color"
            value={isValid ? value : "#000000"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="sr-only"
          />
          <Input
            placeholder="#4F46E5"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 font-mono text-sm h-9"
          />
          {value && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => onChange("")}
              aria-label="Clear color"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </FormField>
  );
}

// ---------- main sheet ----------

export default function ProductDetailSheet({
  productId,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
  initialSection = "foundation",
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
  initialSection?: SectionKey;
}) {
  const [loading, setLoading] = useState(false);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>(initialSection);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Integrations state
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ provider: string; label: string } | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectingPage, setSelectingPage] = useState(false);

  // Logo upload
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ---------- data load ----------
  useEffect(() => {
    if (!open || !productId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSection(initialSection);
      try {
        const [pRes, bvRes, intRes] = await Promise.all([
          apiGet<Product>(`/api/products/${productId}`),
          apiGet<{ brandVoice: BrandVoice | null; brandIdentity: BrandIdentity | null }>(
            `/api/products/${productId}/brand-voice`,
          ),
          apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${productId}`),
        ]);
        if (cancelled) return;
        if (pRes.ok) {
          const prod = pRes.data;
          const voice = bvRes.ok ? bvRes.data.brandVoice : null;
          const identity = bvRes.ok ? bvRes.data.brandIdentity : null;
          const f = buildForm(prod, voice, identity);
          setBaseline(f);
          setForm(f);
          setLastSavedAt(null);
        }
        if (intRes.ok) {
          setIntegrations(getScopedSocialIntegrations(intRes.data.integrations || []));
        }
      } catch {
        toast.error("Failed to load product");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, productId, initialSection]);

  const dirty = !!(baseline && form && hasChanges(baseline, form));
  const dominant = form?.identity.primaryColor && /^#[0-9A-Fa-f]{6}$/i.test(form.identity.primaryColor)
    ? form.identity.primaryColor
    : null;

  // ---------- save ----------
  const save = async () => {
    if (!productId || !form) return;
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    setSaving(true);
    try {
      const [detailsRes, voiceRes] = await Promise.all([
        apiPut(`/api/products/${productId}`, {
          name: form.name,
          description: form.description,
          url: form.url || "",
          categories: form.categories,
          status: form.status,
          pricingTier: form.pricing.join(", "),
          tags: form.tags,
        }),
        apiPut(`/api/products/${productId}/brand-voice`, {
          tone: form.voice.tone,
          style: form.voice.style,
          keywords: form.voice.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          avoidWords: form.voice.avoidWords.split(",").map((k) => k.trim()).filter(Boolean),
          cta: form.voice.cta,
          sampleVoice: form.voice.sampleVoice,
          targetAudience: form.voice.targetAudience,
          brandIdentity: {
            logoUrl: form.identity.logoUrl,
            primaryColor: form.identity.primaryColor,
            secondaryColor: form.identity.secondaryColor,
            accentColor: form.identity.accentColor,
          },
        }),
      ]);

      if (!detailsRes.ok) {
        const err = detailsRes.data as { error?: string; issues?: { message: string }[] };
        toast.error(err.issues?.[0]?.message || err.error || "Failed to save product details");
        return;
      }
      if (!voiceRes.ok) {
        toast.error("Saved product details, but failed to save brand voice");
        return;
      }

      const saved = new Date().toISOString();
      setBaseline(form);
      setLastSavedAt(saved);
      toast.success("Saved");
      onSaved();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!productId) return;
    const res = await apiDelete(`/api/products/${productId}`);
    if (res.ok) {
      toast.success("Product deleted");
      onOpenChange(false);
      onDeleted();
    } else {
      toast.error("Failed to delete product");
    }
  };

  // ---------- logo upload ----------
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !productId || !form) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB");
      return;
    }
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await apiUpload<{ ok: boolean; logoUrl: string }>(
        `/api/products/${productId}/upload-logo`,
        fd,
      );
      if (res.ok && res.data.logoUrl) {
        setForm({ ...form, identity: { ...form.identity, logoUrl: res.data.logoUrl } });
        toast.success("Logo uploaded");
      } else {
        toast.error("Failed to upload logo");
      }
    } catch {
      toast.error("Failed to upload logo");
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // ---------- integrations helpers ----------
  const getIntegration = (provider: string) =>
    integrations.find((i) => i.provider === provider);

  const refreshIntegrations = async () => {
    if (!productId) return;
    const res = await apiGet<{ integrations: IntegrationInfo[] }>(
      `/api/integrations?productId=${productId}`,
    );
    if (res.ok) setIntegrations(getScopedSocialIntegrations(res.data.integrations || []));
  };

  function startOAuth(provider: string) {
    if (!productId) return;
    if (provider === "instagram") {
      const iab = getCurrentInAppBrowserName();
      if (iab) {
        toast.error(
          `Instagram linking does not complete inside the ${iab} in-app browser. Open Markaestro in Safari or Chrome and try again.`,
        );
        return;
      }
      if (isCurrentBrowserMobile()) {
        toast.error("Instagram direct login only works on desktop.");
        return;
      }
    }
    const qs = new URLSearchParams({ workspaceId: "default", productId });
    window.location.href = `/api/oauth/authorize/${provider}?${qs.toString()}`;
  }

  async function confirmDisconnect() {
    if (!disconnectTarget || !productId) return;
    const { provider } = disconnectTarget;
    setDisconnecting(provider);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, { productId });
      if (res.ok) {
        toast.success(`${providerLabels[provider] || provider} disconnected`);
        await refreshIntegrations();
      } else {
        toast.error(`Failed to disconnect ${provider}`);
      }
    } catch {
      toast.error(`Failed to disconnect ${provider}`);
    } finally {
      setDisconnecting(null);
    }
  }

  async function loadMetaPages() {
    setLoadingPages(true);
    try {
      const res = await apiGet<{ pages: MetaPage[] }>(`/api/oauth/pages/meta`);
      if (res.ok) {
        setMetaPages(res.data.pages || []);
        if (res.data.pages?.length === 0) toast.error("No Facebook pages found.");
      }
    } catch {
      toast.error("Failed to load pages");
    } finally {
      setLoadingPages(false);
    }
  }

  async function selectMetaPage() {
    if (!selectedPageId || !productId) return;
    setSelectingPage(true);
    const page = metaPages.find((p) => p.id === selectedPageId);
    try {
      const res = await apiPost<{ ok: boolean; pageName: string }>(
        "/api/oauth/pages/meta/select",
        { pageId: selectedPageId, pageName: page?.name, productId },
      );
      if (res.ok && res.data.ok) {
        toast.success(`Page "${res.data.pageName}" selected`);
        setMetaPages([]);
        setSelectedPageId("");
        await refreshIntegrations();
      } else {
        toast.error("Failed to select page");
      }
    } catch {
      toast.error("Failed to select page");
    } finally {
      setSelectingPage(false);
    }
  }

  // ---------- handle close with dirty check ----------
  const handleOpenChange = (next: boolean) => {
    if (!next && dirty) {
      const ok = window.confirm("You have unsaved changes. Close without saving?");
      if (!ok) return;
    }
    onOpenChange(next);
  };

  // ---------- render helpers ----------
  const patch = <K extends keyof Form>(k: K, v: Form[K]) => {
    if (!form) return;
    setForm({ ...form, [k]: v });
  };

  const patchVoice = <K extends keyof Form["voice"]>(k: K, v: Form["voice"][K]) => {
    if (!form) return;
    setForm({ ...form, voice: { ...form.voice, [k]: v } });
  };

  const patchIdentity = <K extends keyof Form["identity"]>(k: K, v: Form["identity"][K]) => {
    if (!form) return;
    setForm({ ...form, identity: { ...form.identity, [k]: v } });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="!max-w-2xl w-full p-0 flex flex-col overflow-hidden">
          {/* Brand accent strip */}
          {dominant && (
            <div
              aria-hidden
              className="absolute top-0 left-0 right-0 h-1 z-10"
              style={{
                background: `linear-gradient(90deg, ${dominant}, ${dominant}aa 40%, transparent 100%)`,
              }}
            />
          )}

          {/* Header — sticky */}
          <SheetHeader className="px-6 pt-5 pb-3 border-b border-border/40">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {form?.identity.logoUrl ? (
                  <img
                    src={form.identity.logoUrl}
                    alt="Logo"
                    className="h-10 w-10 rounded-xl object-contain border border-border/40 bg-white shrink-0"
                  />
                ) : (
                  <div
                    className="h-10 w-10 rounded-xl border border-border/40 flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: dominant ? `${dominant}12` : undefined,
                      color: dominant || undefined,
                    }}
                  >
                    <span className="text-sm font-semibold">
                      {form?.name?.charAt(0).toUpperCase() || "·"}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  <SheetTitle className="text-base truncate">
                    {form?.name || "Product"}
                  </SheetTitle>
                  <SheetDescription className="text-xs mt-0.5">
                    <SaveIndicator dirty={dirty} saving={saving} lastSavedAt={lastSavedAt} />
                  </SheetDescription>
                </div>
              </div>
              <Button
                size="sm"
                onClick={save}
                disabled={!dirty || saving || loading}
                className="rounded-lg gap-1.5 shrink-0"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : dirty ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </Button>
            </div>

            {/* Section nav */}
            <nav className="flex items-center gap-0.5 mt-4 -mb-0.5">
              {sections.map((s) => {
                const active = section === s.key;
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSection(s.key)}
                    className={cn(
                      "relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors",
                      active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                    {active && (
                      <motion.span
                        layoutId="product-section-underline"
                        className="absolute left-2.5 right-2.5 -bottom-[9px] h-0.5 bg-foreground"
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </SheetHeader>

          {/* Content — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading || !form ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={section}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="space-y-5"
                >
                  {section === "foundation" && (
                    <FoundationSection
                      form={form}
                      patch={patch}
                    />
                  )}
                  {section === "voice" && (
                    <VoiceSection form={form} patchVoice={patchVoice} />
                  )}
                  {section === "identity" && (
                    <IdentitySection
                      form={form}
                      patchIdentity={patchIdentity}
                      logoUploading={logoUploading}
                      logoInputRef={logoInputRef}
                      onLogoUpload={handleLogoUpload}
                    />
                  )}
                  {section === "channels" && (
                    <ChannelsSection
                      integrations={integrations}
                      disconnecting={disconnecting}
                      loadingPages={loadingPages}
                      metaPages={metaPages}
                      selectedPageId={selectedPageId}
                      selectingPage={selectingPage}
                      onLoadPages={loadMetaPages}
                      onSelectedPageIdChange={setSelectedPageId}
                      onSelectPage={selectMetaPage}
                      onStartOAuth={startOAuth}
                      onDisconnect={(provider, label) =>
                        setDisconnectTarget({ provider, label })
                      }
                      getIntegration={getIntegration}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Footer — delete + status recap */}
          {!loading && form && (
            <div className="px-6 py-3 border-t border-border/40 bg-muted/20 flex items-center justify-between gap-2">
              <button
                onClick={() => setDeleteOpen(true)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Delete product
              </button>
              <SaveIndicator
                dirty={dirty}
                saving={saving}
                lastSavedAt={lastSavedAt}
                compact
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entity="product"
        name={form?.name}
        warning="All brand voice settings and connections for this product will also be removed."
        onConfirm={confirmDelete}
      />

      <ConfirmDeleteDialog
        open={!!disconnectTarget}
        onOpenChange={(o) => {
          if (!o) setDisconnectTarget(null);
        }}
        entity="integration"
        name={disconnectTarget?.label}
        confirmLabel="Disconnect"
        warning="This will remove the connection for this product. You can reconnect later."
        onConfirm={confirmDisconnect}
      />
    </>
  );
}

// ---------- save indicator ----------

function SaveIndicator({
  dirty,
  saving,
  lastSavedAt,
  compact = false,
}: {
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  compact?: boolean;
}) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600">
        <Dot className="h-3.5 w-3.5 -mx-1" strokeWidth={6} />
        Unsaved changes
      </span>
    );
  }
  if (lastSavedAt) {
    const time = new Date(lastSavedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <Check className="h-3 w-3" />
        Saved · {time}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-muted-foreground", compact && "text-[11px]")}>
      <Check className="h-3 w-3" />
      All changes saved
    </span>
  );
}

// ---------- section components ----------

function SectionCard({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4 space-y-4">
      {(title || description) && (
        <div>
          {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function FoundationSection({
  form,
  patch,
}: {
  form: Form;
  patch: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  return (
    <>
      <SectionCard title="Basics" description="How your product is identified across Markaestro.">
        <FormField label="Product name">
          <Input value={form.name} onChange={(e) => patch("name", e.target.value)} />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => patch("description", e.target.value)}
            rows={3}
          />
        </FormField>
        <FormField label="Website">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="https://yourproduct.com"
              value={form.url}
              onChange={(e) => patch("url", e.target.value)}
            />
          </div>
        </FormField>
      </SectionCard>

      <SectionCard title="Positioning">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category">
            <div className="flex flex-wrap gap-1">
              {Object.entries(categoryLabels).map(([val, label]) => {
                const active = form.categories.includes(val);
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      patch(
                        "categories",
                        active
                          ? form.categories.length > 1
                            ? form.categories.filter((c) => c !== val)
                            : form.categories
                          : [...form.categories, val],
                      )
                    }
                    className={cn(
                      "px-2 py-1 rounded-md border text-[11px] transition-all",
                      active
                        ? "border-foreground bg-foreground text-background font-medium"
                        : "border-border/60 text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </FormField>
          <FormField label="Status">
            <Select value={form.status} onChange={(e) => patch("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="beta">Beta</option>
              <option value="development">Development</option>
              <option value="sunset">Sunset</option>
              <option value="archived">Archived</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Pricing tier">
          <TagInput
            tags={form.pricing}
            onChange={(v) => patch("pricing", v)}
            placeholder="Free, Pro $29/mo…"
          />
        </FormField>
        <FormField label="Tags">
          <TagInput
            tags={form.tags}
            onChange={(v) => patch("tags", v)}
            placeholder="analytics, ai, b2b…"
          />
        </FormField>
      </SectionCard>
    </>
  );
}

function VoiceSection({
  form,
  patchVoice,
}: {
  form: Form;
  patchVoice: <K extends keyof Form["voice"]>(k: K, v: Form["voice"][K]) => void;
}) {
  return (
    <>
      <SectionCard
        title="Voice"
        description="Instructs AI-generated copy so it sounds consistent with your brand."
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tone">
            <Input
              placeholder="Professional, bold…"
              value={form.voice.tone}
              onChange={(e) => patchVoice("tone", e.target.value)}
            />
          </FormField>
          <FormField label="Style">
            <Input
              placeholder="Concise, conversational…"
              value={form.voice.style}
              onChange={(e) => patchVoice("style", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Target audience">
          <Input
            placeholder="SaaS founders, indie hackers…"
            value={form.voice.targetAudience}
            onChange={(e) => patchVoice("targetAudience", e.target.value)}
          />
        </FormField>
        <FormField label="Default CTA">
          <Input
            placeholder="Start your free trial"
            value={form.voice.cta}
            onChange={(e) => patchVoice("cta", e.target.value)}
          />
        </FormField>
      </SectionCard>

      <SectionCard title="Vocabulary" description="Comma-separated lists.">
        <FormField label="Signature words">
          <Input
            placeholder="innovate, automate, scale…"
            value={form.voice.keywords}
            onChange={(e) => patchVoice("keywords", e.target.value)}
          />
        </FormField>
        <FormField label="Words to avoid">
          <Input
            placeholder="synergy, leverage, disrupt…"
            value={form.voice.avoidWords}
            onChange={(e) => patchVoice("avoidWords", e.target.value)}
          />
        </FormField>
      </SectionCard>

      <SectionCard
        title="Sample writing"
        description="Paste a paragraph that sounds exactly like your brand."
      >
        <Textarea
          rows={5}
          placeholder="Paste an example of your ideal brand writing here…"
          value={form.voice.sampleVoice}
          onChange={(e) => patchVoice("sampleVoice", e.target.value)}
        />
      </SectionCard>
    </>
  );
}

function IdentitySection({
  form,
  patchIdentity,
  logoUploading,
  logoInputRef,
  onLogoUpload,
}: {
  form: Form;
  patchIdentity: <K extends keyof Form["identity"]>(k: K, v: Form["identity"][K]) => void;
  logoUploading: boolean;
  logoInputRef: React.RefObject<HTMLInputElement | null>;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <SectionCard title="Logo" description="Used on cards, generated media, and previews.">
        <div className="flex items-center gap-4">
          <div className="relative">
            {form.identity.logoUrl ? (
              <img
                src={form.identity.logoUrl}
                alt="Logo"
                className="h-20 w-20 rounded-2xl object-contain border border-border/50 bg-white"
              />
            ) : (
              <div className="h-20 w-20 rounded-2xl border border-dashed border-border/60 bg-muted/20 flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={onLogoUpload}
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
              >
                {logoUploading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                )}
                {logoUploading ? "Uploading…" : form.identity.logoUrl ? "Replace" : "Upload"}
              </Button>
              {form.identity.logoUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => patchIdentity("logoUrl", "")}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPG, WebP, or SVG. Max 2 MB.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Brand colors" description="Set once, reflected across cards and generated media.">
        <ColorField
          label="Primary"
          value={form.identity.primaryColor}
          onChange={(v) => patchIdentity("primaryColor", v)}
        />
        <ColorField
          label="Secondary"
          value={form.identity.secondaryColor}
          onChange={(v) => patchIdentity("secondaryColor", v)}
        />
        <ColorField
          label="Accent"
          value={form.identity.accentColor}
          onChange={(v) => patchIdentity("accentColor", v)}
        />
      </SectionCard>
    </>
  );
}

function ChannelsSection({
  integrations,
  disconnecting,
  loadingPages,
  metaPages,
  selectedPageId,
  selectingPage,
  onLoadPages,
  onSelectedPageIdChange,
  onSelectPage,
  onStartOAuth,
  onDisconnect,
  getIntegration,
}: {
  integrations: IntegrationInfo[];
  disconnecting: string | null;
  loadingPages: boolean;
  metaPages: MetaPage[];
  selectedPageId: string;
  selectingPage: boolean;
  onLoadPages: () => void;
  onSelectedPageIdChange: (v: string) => void;
  onSelectPage: () => void;
  onStartOAuth: (provider: string) => void;
  onDisconnect: (provider: string, label: string) => void;
  getIntegration: (provider: string) => IntegrationInfo | undefined;
}) {
  void integrations; // used via getIntegration
  const meta = getIntegration("meta");
  const metaConnected =
    meta?.status === "connected" || (meta?.scope === "workspace" && meta?.needsPageSelection);
  const instagram = getIntegration("instagram");
  const tiktok = getIntegration("tiktok");
  const linkedin = getIntegration("linkedin");

  return (
    <>
      <SectionCard
        title="Connected channels"
        description="Connect social accounts so you can schedule from this product."
      >
        {/* Meta */}
        <ChannelCard
          label={providerLabels.meta}
          connected={!!metaConnected}
          warn={!!metaConnected && !meta?.pageId}
          warnLabel="Select page"
          detail={
            meta?.pageName
              ? `${meta.pageName}${meta.igAccountId ? " · Instagram linked" : ""}`
              : metaConnected
              ? "Select a Facebook page to enable publishing"
              : undefined
          }
        >
          {metaConnected ? (
            <>
              <Button variant="outline" size="sm" onClick={onLoadPages} disabled={loadingPages}>
                {loadingPages ? "Loading…" : meta?.pageId ? "Change page" : "Select page"}
              </Button>
              {metaPages.length > 0 && (
                <div className="flex gap-2 pt-2">
                  <Select
                    value={selectedPageId}
                    onChange={(e) => onSelectedPageIdChange(e.target.value)}
                    className="flex-1"
                  >
                    <option value="">Select a page…</option>
                    {metaPages.map((pg) => (
                      <option key={pg.id} value={pg.id}>
                        {pg.name} {pg.hasInstagram ? "(IG linked)" : ""}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    onClick={onSelectPage}
                    disabled={selectingPage || !selectedPageId}
                  >
                    {selectingPage ? "…" : "Select"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Connect Meta in{" "}
              <a href="/settings" className="text-primary hover:underline">
                Settings
              </a>{" "}
              first, then pick a page here.
            </p>
          )}
        </ChannelCard>

        {/* Instagram */}
        <ChannelCard
          label={providerLabels.instagram}
          connected={instagram?.status === "connected"}
          warn={!!instagram?.lastRefreshError}
          warnLabel="Reconnect"
          detail={
            instagram?.status === "connected"
              ? [
                  instagram?.username ? `@${instagram.username}` : null,
                  instagram?.tokenExpiresAt
                    ? `Expires ${new Date(instagram.tokenExpiresAt).toLocaleDateString()}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : "For professional accounts not linked to a Facebook page."
          }
        >
          {instagram?.status === "connected" ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDisconnect("instagram", providerLabels.instagram)}
              disabled={disconnecting === "instagram"}
            >
              {disconnecting === "instagram" ? "…" : "Disconnect"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => onStartOAuth("instagram")}>
              Connect
            </Button>
          )}
        </ChannelCard>

        {/* TikTok */}
        <ChannelCard
          label={providerLabels.tiktok}
          connected={tiktok?.status === "connected"}
          warn={!!tiktok?.lastRefreshError}
          warnLabel="Reconnect"
          detail={
            tiktok?.tokenExpiresAt
              ? `Expires ${new Date(tiktok.tokenExpiresAt).toLocaleDateString()}`
              : undefined
          }
        >
          {tiktok?.status === "connected" ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDisconnect("tiktok", providerLabels.tiktok)}
              disabled={disconnecting === "tiktok"}
            >
              {disconnecting === "tiktok" ? "…" : "Disconnect"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => onStartOAuth("tiktok")}>
              Connect
            </Button>
          )}
        </ChannelCard>

        {/* LinkedIn */}
        <ChannelCard
          label={providerLabels.linkedin}
          connected={linkedin?.status === "connected" && !linkedin?.lastRefreshError}
          warn={linkedin?.status === "expired" || !!linkedin?.lastRefreshError}
          warnLabel="Reconnect"
          detail={
            linkedin?.tokenExpiresAt
              ? `Expires ${new Date(linkedin.tokenExpiresAt).toLocaleDateString()} · requires re-auth every 60 days`
              : undefined
          }
        >
          {linkedin?.status === "connected" && !linkedin?.lastRefreshError ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDisconnect("linkedin", providerLabels.linkedin)}
              disabled={disconnecting === "linkedin"}
            >
              {disconnecting === "linkedin" ? "…" : "Disconnect"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => onStartOAuth("linkedin")}>
              {linkedin?.status === "expired" || linkedin?.lastRefreshError
                ? "Reconnect"
                : "Connect"}
            </Button>
          )}
        </ChannelCard>
      </SectionCard>
    </>
  );
}

function ChannelCard({
  label,
  connected,
  warn,
  warnLabel,
  detail,
  children,
}: {
  label: string;
  connected: boolean;
  warn?: boolean;
  warnLabel?: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          {connected && (
            <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px] shrink-0">
              Connected
            </Badge>
          )}
          {warn && (
            <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px] shrink-0">
              {warnLabel || "Warning"}
            </Badge>
          )}
        </div>
      </div>
      {detail && <p className="text-[11px] text-muted-foreground">{detail}</p>}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
