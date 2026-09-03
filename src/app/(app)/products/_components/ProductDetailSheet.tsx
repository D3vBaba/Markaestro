"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import {
  Upload, X, Loader2, Check, Dot, Globe, Palette, Link2, Pencil,
  Package, Trash2, Image as ImageIcon, Target, BookOpen, RefreshCw,
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
import CategorySelect from "./CategorySelect";
import { categoryLabel, categoryColor } from "./categories";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ConnectChannelDialog, { type ConnectDialogRequest } from "@/components/app/ConnectChannelDialog";
import ConnectionOutcomeCard, { type ConnectOutcome } from "@/components/app/ConnectionOutcomeCard";
import HintButton from "@/components/app/HintButton";
import { CHANNEL_BRAND } from "@/components/app/ChannelGlyph";
import { catalogProviderFor, grantedPermissions } from "@/lib/oauth/permission-catalog";
import { apiGet, apiPut, apiPost, apiDelete, apiUpload, getApiWorkspaceId } from "@/lib/api-client";
import { startOAuthAuthorize } from "@/lib/in-app-browser";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pillStyle } from "@/components/mk/pills";
import { resolveChannelStatus } from "@/lib/integrations/channel-status";
import { getValidationIssueFields, userFacingError } from "@/lib/user-facing-errors";
import AudienceProfileEditor from "@/components/intelligence/AudienceProfileEditor";
import { useIntelligencePreviewAccess } from "@/hooks/useIntelligencePreviewAccess";

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

export type ProductKnowledge = {
  features?: Array<{ title: string; description?: string; benefit?: string }>;
  usps?: string[];
  painPoints?: string[];
  proofPoints?: Array<{ type: string; content: string; source?: string }>;
  competitors?: string[];
  differentiators?: string[];
  positioning?: string;
  targetAudienceDemographics?: string;
  targetAudiencePsychographics?: string;
  targetAudiencePainStatement?: string;
  targetAudienceDesiredOutcome?: string;
  contentAngles?: string[];
  lastEnrichedAt?: string;
  enrichmentSource?: "manual" | "url_import";
};

export type Product = {
  id: string;
  name: string;
  description: string;
  url: string;
  categories?: string[];
  category?: string;
  status: string;
  brandVoice?: BrandVoice;
  brandIdentity?: BrandIdentity;
  createdAt?: string;
  knowledge?: ProductKnowledge | null;
};

/**
 * One account/Page/board linked for a channel. A brand can link as many as the
 * platform grant exposes — ten Facebook Pages are ten linked accounts, each
 * publishable and unlinkable on its own.
 */
export type LinkedAccount = {
  connectionId: string;
  provider: string;
  destinationId: string | null;
  label: string | null;
  status: string;
  enabled: boolean;
  lastRefreshError?: string | null;
  /** Scopes the platform reported on the grant, when it reported any. */
  grantedScopes?: string[] | null;
  pageName?: string | null;
  boardName?: string | null;
  username?: string | null;
  linkedinDestinationName?: string | null;
};

export type IntegrationInfo = {
  provider: string;
  accounts?: LinkedAccount[];
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
  /** Scopes the platform reported on the grant, when it reported any. */
  grantedScopes?: string[] | null;
  boardId?: string | null;
  boardName?: string | null;
  boardSelectionRequired?: boolean | null;
  linkedinProfileId?: string | null;
  linkedinProfileName?: string | null;
  linkedinProfileConnected?: boolean | null;
  linkedinCommunityConnected?: boolean | null;
  linkedinProfileStatus?: string | null;
  linkedinCommunityStatus?: string | null;
  linkedinPages?: Array<{ id: string; urn: string; name: string; type: "page"; role?: string | null }>;
  linkedinDestinationUrn?: string | null;
  linkedinDestinationName?: string | null;
  linkedinDestinationType?: "profile" | "page" | null;
  linkedinDestinationSelectionRequired?: boolean | null;
  linkedinPageDiscoveryError?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  channelSelectionRequired?: boolean | null;
};

type MetaPage = {
  id: string;
  name: string;
  hasInstagram: boolean;
  igAccountId: string | null;
  /** Which connected Facebook account owns this Page. */
  accountId?: string | null;
  accountLabel?: string | null;
};

// ---------- constants ----------

const SOCIAL_PROVIDERS = [
  "meta",
  "instagram",
  "tiktok",
  "threads",
  "pinterest",
  "linkedin",
  "x",
] as const;
// Channel names are platform brand names — proper nouns that stay in English
// across every locale, same as elsewhere in the app.
const providerLabels: Record<string, string> = {
  meta: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  threads: "Threads",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  linkedin_profile: "LinkedIn Profile",
  linkedin_community: "LinkedIn Pages",
  x: "X",
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
  // Every channel is linked per product now — only product-scoped connections
  // count (any leftover workspace-level Meta from the old shared model is ignored).
  return integrations.filter(
    (integration) =>
      SOCIAL_PROVIDERS.includes(integration.provider as typeof SOCIAL_PROVIDERS[number]) &&
      integration.scope === "product",
  );
}

// ---------- form shape + dirty tracking ----------

type Form = {
  name: string;
  description: string;
  url: string;
  categories: string[];
  status: string;
  identity: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
};

function buildForm(
  product: Product,
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

type SectionKey = "foundation" | "identity" | "audience" | "channels";

const SECTION_ICONS: Record<SectionKey, typeof Package> = {
  foundation: Package,
  identity: Palette,
  audience: Target,
  channels: Link2,
};
const SECTION_KEYS: SectionKey[] = ["foundation", "identity", "audience", "channels"];

// ---------- inline color picker ----------

function ColorField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("products.detailSheet.identity");
  const nativeRef = useRef<HTMLInputElement>(null);
  const isValid = value && /^#[0-9A-Fa-f]{6}$/i.test(value);
  return (
    <FormField label={label}>
      <div className="space-y-2">
        {description && (
          <p className="text-[11px] text-muted-foreground -mt-0.5">{description}</p>
        )}
        <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5 sm:gap-1">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={t("setColorTo", { label, color: c })}
              className={cn(
                "aspect-square sm:aspect-auto sm:h-6 w-full rounded-md border transition-[border-color,transform]",
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
            aria-label={t("openColorPicker")}
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
            placeholder="#2563EB"
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
              aria-label={t("clearColor")}
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
  connectOutcome = null,
  onConnectOutcomeDismiss,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
  initialSection?: SectionKey;
  /** What the OAuth callback reported, when the sheet opened from one. */
  connectOutcome?: ConnectOutcome | null;
  onConnectOutcomeDismiss?: () => void;
}) {
  const t = useTranslations("products.detailSheet");
  const tSections = useTranslations("products.detailSheet.sections");
  const canAccessIntelligence = useIntelligencePreviewAccess();
  const sectionKeys = canAccessIntelligence ? SECTION_KEYS : SECTION_KEYS.filter((key) => key !== "audience");
  const [loading, setLoading] = useState(false);
  const [baseline, setBaseline] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>(initialSection);
  // Adjust during render (no effect): the audience section is preview-only.
  if (!canAccessIntelligence && section === "audience") setSection("foundation");
  // The product opens read-only; "Edit" unlocks the form, saving re-locks it.
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Integrations state
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [knowledge, setKnowledge] = useState<ProductKnowledge | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ provider: string; label: string; linkedinMode?: "profile" | "community" } | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [metaLinkedPageIds, setMetaLinkedPageIds] = useState<string[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectingPage, setSelectingPage] = useState(false);
  const [connectRequest, setConnectRequest] = useState<ConnectDialogRequest | null>(null);

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
          const identity = bvRes.ok ? bvRes.data.brandIdentity : null;
          const f = buildForm(prod, identity);
          setBaseline(f);
          setForm(f);
          setKnowledge(prod.knowledge ?? null);
          setLastSavedAt(null);
          setEditing(false);
        }
        if (intRes.ok) {
          setIntegrations(getScopedSocialIntegrations(intRes.data.integrations || []));
        }
      } catch {
        toast.error(t("toasts.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId, initialSection]);

  const dirty = !!(baseline && form && hasChanges(baseline, form));
  const dominant = form?.identity.primaryColor && /^#[0-9A-Fa-f]{6}$/i.test(form.identity.primaryColor)
    ? form.identity.primaryColor
    : null;

  // ---------- save ----------
  const save = async () => {
    if (!productId || !form) return;
    if (!form.name.trim()) {
      toast.error(t("toasts.nameRequired"));
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
        }),
        apiPut(`/api/products/${productId}/brand-voice`, {
          brandIdentity: {
            logoUrl: form.identity.logoUrl,
            primaryColor: form.identity.primaryColor,
            secondaryColor: form.identity.secondaryColor,
            accentColor: form.identity.accentColor,
          },
        }),
      ]);

      if (!detailsRes.ok) {
        const fields = getValidationIssueFields(detailsRes.data);
        if (fields.includes("url")) {
          toast.error(t("toasts.invalidWebsite"));
        } else if (fields.includes("description")) {
          toast.error(t("toasts.descriptionTooLong"));
        } else {
          toast.error(userFacingError(detailsRes.data, t("toasts.saveDetailsFailed")));
        }
        return;
      }
      if (!voiceRes.ok) {
        const fields = getValidationIssueFields(voiceRes.data);
        const invalidColor = fields.some((field) => field.toLowerCase().includes("color"));
        toast.error(invalidColor ? t("toasts.invalidColor") : t("toasts.saveIdentityFailed"));
        return;
      }

      const saved = new Date().toISOString();
      setBaseline(form);
      setLastSavedAt(saved);
      setEditing(false);
      toast.success(t("toasts.saved"));
      onSaved();
    } catch {
      toast.error(t("toasts.saveDetailsFailed"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!productId) return;
    const res = await apiDelete(`/api/products/${productId}`);
    if (res.ok) {
      toast.success(t("toasts.deleted"));
      onOpenChange(false);
      onDeleted();
    } else {
      toast.error(t("toasts.deleteFailed"));
    }
  };

  // ---------- logo upload ----------
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !productId || !form) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("toasts.logoTooLarge"));
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
        toast.success(t("toasts.logoUploaded"));
      } else {
        toast.error(t("toasts.logoUploadFailed"));
      }
    } catch {
      toast.error(t("toasts.logoUploadFailed"));
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

  // Every Connect / Reconnect opens the explainer dialog first. Only its
  // Continue button navigates, and it does so synchronously so the mobile
  // new-tab path in startOAuthAuthorize still runs inside the user gesture.
  function startOAuth(
    provider: string,
    linkedinMode?: "profile" | "community",
    mode: "connect" | "reconnect" = "connect",
  ) {
    if (!productId) return;
    setConnectRequest({ provider, linkedinMode, mode });
  }

  function launchOAuth(provider: string, linkedinMode?: "profile" | "community") {
    if (!productId) return;
    const qs = new URLSearchParams({
      workspaceId: getApiWorkspaceId(),
      productId,
      returnTo: "/products",
    });
    if (provider === "linkedin" && linkedinMode) {
      qs.set("linkedinMode", linkedinMode);
    }
    startOAuthAuthorize(`/api/oauth/authorize/${provider}?${qs.toString()}`);
  }

  async function confirmDisconnect() {
    if (!disconnectTarget || !productId) return;
    const { provider, label, linkedinMode } = disconnectTarget;
    const busyKey = linkedinMode ? `${provider}:${linkedinMode}` : provider;
    setDisconnecting(busyKey);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, {
        productId,
        ...(linkedinMode ? { linkedinMode } : {}),
      });
      if (res.ok) {
        toast.success(t("toasts.disconnected", { label: label || providerLabels[provider] || provider }));
        await refreshIntegrations();
      } else {
        toast.error(t("toasts.disconnectFailed", { provider }));
      }
    } catch {
      toast.error(t("toasts.disconnectFailed", { provider }));
    } finally {
      setDisconnecting(null);
      setDisconnectTarget(null);
    }
  }

  async function loadMetaPages() {
    if (!productId) return;
    setLoadingPages(true);
    try {
      const res = await apiGet<{ pages: MetaPage[]; linkedIds?: string[] }>(
        `/api/oauth/pages/meta?productId=${productId}`,
      );
      if (res.ok) {
        setMetaPages(res.data.pages || []);
        setMetaLinkedPageIds(res.data.linkedIds || []);
        if (res.data.pages?.length === 0) toast.error(t("toasts.noFacebookPages"));
      }
    } catch {
      toast.error(t("toasts.loadPagesFailed"));
    } finally {
      setLoadingPages(false);
    }
  }

  // Linking is additive — a brand can post to as many Facebook Pages as the
  // Meta grant covers, so choosing Pages never displaces the ones already set.
  async function selectMetaPages(pageIds: string[]) {
    if (pageIds.length === 0 || !productId) return;
    setSelectingPage(true);
    const pageNames = Object.fromEntries(
      pageIds.map((id) => [id, metaPages.find((page) => page.id === id)?.name || ""]),
    );
    try {
      const res = await apiPost<{ ok: boolean; linked?: Array<{ name: string }> }>(
        "/api/oauth/pages/meta/select",
        { pageIds, pageNames, productId },
      );
      if (res.ok && res.data.ok) {
        const count = res.data.linked?.length ?? pageIds.length;
        toast.success(t("toasts.pagesLinked", { count }));
        setMetaPages([]);
        setMetaLinkedPageIds([]);
        await refreshIntegrations();
      } else {
        toast.error(t("toasts.linkPagesFailed"));
      }
    } catch {
      toast.error(t("toasts.linkPagesFailed"));
    } finally {
      setSelectingPage(false);
    }
  }

  // ---------- handle close with dirty check ----------
  const handleOpenChange = (next: boolean) => {
    if (!next && dirty) {
      const ok = window.confirm(t("unsavedConfirm"));
      if (!ok) return;
    }
    onOpenChange(next);
  };

  // ---------- render helpers ----------
  const patch = <K extends keyof Form>(k: K, v: Form[K]) => {
    if (!form) return;
    setForm({ ...form, [k]: v });
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
          <SheetHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-border/40">
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
                    {form?.name || t("brandFallback")}
                  </SheetTitle>
                  <SheetDescription className="text-xs mt-0.5">
                    <SaveIndicator dirty={dirty} saving={saving} lastSavedAt={lastSavedAt} />
                  </SheetDescription>
                </div>
              </div>
            </div>

            {/* Section nav + edit controls (same row) */}
            <div className="mt-4 -mb-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide max-w-full">
              {sectionKeys.map((key) => {
                const active = section === key;
                const Icon = SECTION_ICONS[key];
                return (
                  <button
                    key={key}
                    onClick={() => setSection(key)}
                    className={cn(
                      "relative flex items-center gap-1.5 px-2.5 py-2 sm:py-1.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0",
                      active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tSections(key)}
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
              <div className="flex items-center gap-2 shrink-0">
                {section !== "audience" && (editing ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (baseline) setForm(baseline);
                        setEditing(false);
                      }}
                      disabled={saving}
                      className="rounded-lg text-muted-foreground"
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={save}
                      disabled={!dirty || saving || loading}
                      className="rounded-lg gap-1.5"
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {saving ? t("saveIndicator.saving") : t("save")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                    disabled={loading}
                    className="rounded-lg gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("edit")}
                  </Button>
                ))}
              </div>
            </div>
          </SheetHeader>

          {/* Content — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
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
                    <>
                      <FoundationSection
                        form={form}
                        patch={patch}
                        readOnly={!editing}
                      />
                      {productId && (
                        <KnowledgeCard
                          productId={productId}
                          websiteUrl={form.url}
                          knowledge={knowledge}
                          onImported={setKnowledge}
                        />
                      )}
                    </>
                  )}
                  {section === "identity" && (
                    <IdentitySection
                      form={form}
                      patchIdentity={patchIdentity}
                      logoUploading={logoUploading}
                      logoInputRef={logoInputRef}
                      onLogoUpload={handleLogoUpload}
                      readOnly={!editing}
                    />
                  )}
                  {section === "audience" && productId && (
                    <AudienceProfileEditor productId={productId} variant="advanced" />
                  )}
                  {section === "channels" && (
                    <ChannelsSection
                      integrations={integrations}
                      disconnecting={disconnecting}
                      loadingPages={loadingPages}
                      metaPages={metaPages}
                      metaLinkedPageIds={metaLinkedPageIds}
                      selectingPage={selectingPage}
                      onLoadPages={loadMetaPages}
                      onSelectPages={selectMetaPages}
                      onStartOAuth={startOAuth}
                      connectOutcome={connectOutcome}
                      onDismissOutcome={onConnectOutcomeDismiss}
                      brandName={form?.name ?? null}
                      onDisconnect={(provider, label) =>
                        setDisconnectTarget({ provider, label })
                      }
                      getIntegration={getIntegration}
                      onRefreshIntegrations={refreshIntegrations}
                      productId={productId}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Footer — delete + status recap */}
          {!loading && form && (
            <div className="px-4 sm:px-6 py-3 border-t border-border/40 bg-muted/20 flex items-center justify-between gap-2">
              <button
                onClick={() => setDeleteOpen(true)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1 py-2 -my-2 px-1 -mx-1"
              >
                <Trash2 className="h-3 w-3" /> {t("deleteBrand")}
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

      <ConnectChannelDialog
        request={connectRequest}
        brandName={form?.name}
        onOpenChange={(next) => {
          if (!next) setConnectRequest(null);
        }}
        onContinue={(request) => launchOAuth(request.provider, request.linkedinMode)}
      />

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entity="brand"
        name={form?.name}
        warning={t("deleteWarning")}
        onConfirm={confirmDelete}
      />

      <ConfirmDeleteDialog
        open={!!disconnectTarget}
        onOpenChange={(o) => {
          if (!o) setDisconnectTarget(null);
        }}
        entity="integration"
        name={disconnectTarget?.label}
        confirmLabel={t("disconnect")}
        warning={
          disconnectTarget
            ? t("disconnectWarning", { label: disconnectTarget.label })
            : undefined
        }
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
  const t = useTranslations("products.detailSheet.saveIndicator");
  const locale = useLocale();
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("saving")}
      </span>
    );
  }
  if (dirty) {
    return (
      <span
        className="inline-flex items-center gap-1"
        style={{ color: "var(--mk-warn)" }}
      >
        <Dot className="h-3.5 w-3.5 -mx-1" strokeWidth={6} />
        {t("unsavedChanges")}
      </span>
    );
  }
  if (lastSavedAt) {
    const time = new Date(lastSavedAt).toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <span
        className="inline-flex items-center gap-1"
        style={{ color: "var(--mk-pos)" }}
      >
        <Check className="h-3 w-3" />
        {t("savedAt", { time })}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-muted-foreground", compact && "text-[11px]")}>
      <Check className="h-3 w-3" />
      {t("allSaved")}
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

// A labeled read-only row used in the locked (view) state.
function ReadRow({
  label,
  value,
  children,
  multiline,
  emphasis,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  multiline?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </p>
      {children ?? (
        <p
          className={cn(
            "text-sm text-foreground",
            emphasis && "text-[15px] font-semibold",
            multiline && "whitespace-pre-wrap leading-relaxed text-[13px] text-muted-foreground",
            !value && "text-muted-foreground",
          )}
        >
          {value || "n/a"}
        </p>
      )}
    </div>
  );
}


function FoundationSection({
  form,
  patch,
  readOnly,
}: {
  form: Form;
  patch: <K extends keyof Form>(k: K, v: Form[K]) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("products.detailSheet.foundation");
  const tCategories = useTranslations("products.categories");
  const tStatus = useTranslations("products.productStatus");
  if (readOnly) {
    return (
      <>
        <SectionCard title={t("basicsTitle")}>
          <ReadRow label={t("brandName")} value={form.name} emphasis />
          <ReadRow label={t("description")} value={form.description} multiline />
          <ReadRow label={t("website")}>
            {form.url ? (
              <a
                href={form.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {form.url.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">n/a</p>
            )}
          </ReadRow>
        </SectionCard>

        <SectionCard title={t("positioningTitle")}>
          <ReadRow label={t("category")}>
            {form.categories.length ? (
              <div className="flex flex-wrap gap-1.5">
                {form.categories.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-foreground"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: categoryColor(c) }} />
                    {categoryLabel(c, tCategories)}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">n/a</span>
            )}
          </ReadRow>
          <ReadRow label={t("status")}>
            <Badge className="border-0" style={pillStyle(form.status === "active" ? "pos" : "neutral")}>
              {tStatus.has(form.status) ? tStatus(form.status) : form.status}
            </Badge>
          </ReadRow>
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <SectionCard title={t("basicsTitle")} description={t("basicsDescription")}>
        <FormField label={t("brandName")}>
          <Input value={form.name} maxLength={200} onChange={(e) => patch("name", e.target.value)} />
        </FormField>
        <FormField label={t("description")}>
          <Textarea
            value={form.description}
            onChange={(e) => patch("description", e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </FormField>
        <FormField label={t("website")}>
          <div className="relative">
            <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder="https://yourbrand.com"
              value={form.url}
              onChange={(e) => patch("url", e.target.value)}
            />
          </div>
        </FormField>
      </SectionCard>

      <SectionCard title={t("positioningTitle")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={t("category")}>
            <CategorySelect
              value={form.categories[0] || ""}
              onChange={(v) => patch("categories", [v])}
            />
          </FormField>
          <FormField label={t("status")}>
            <Select value={form.status} onChange={(e) => patch("status", e.target.value)}>
              <option value="active">{tStatus("active")}</option>
              <option value="beta">{tStatus("beta")}</option>
              <option value="development">{tStatus("development")}</option>
              <option value="sunset">{tStatus("sunset")}</option>
              <option value="archived">{tStatus("archived")}</option>
            </Select>
          </FormField>
        </div>
      </SectionCard>
    </>
  );
}

// ---------- brand knowledge ----------

function KnowledgeCard({
  productId,
  websiteUrl,
  knowledge,
  onImported,
}: {
  productId: string;
  websiteUrl: string;
  knowledge: ProductKnowledge | null;
  onImported: (knowledge: ProductKnowledge) => void;
}) {
  const t = useTranslations("products.detailSheet.knowledge");
  const locale = useLocale();
  const [importing, setImporting] = useState(false);

  const lists: Array<{ key: string; items: string[] }> = [
    { key: "features", items: (knowledge?.features ?? []).map((f) => f.title) },
    { key: "usps", items: knowledge?.usps ?? [] },
    { key: "painPoints", items: knowledge?.painPoints ?? [] },
    { key: "proofPoints", items: (knowledge?.proofPoints ?? []).map((p) => p.content) },
    { key: "differentiators", items: knowledge?.differentiators ?? [] },
    { key: "competitors", items: knowledge?.competitors ?? [] },
    { key: "contentAngles", items: knowledge?.contentAngles ?? [] },
  ].filter((l) => l.items.length > 0);
  const audience = [
    knowledge?.targetAudienceDemographics,
    knowledge?.targetAudiencePsychographics,
    knowledge?.targetAudiencePainStatement,
    knowledge?.targetAudienceDesiredOutcome,
  ].filter((v): v is string => !!v && v.trim() !== "");
  const hasContent = lists.length > 0 || audience.length > 0 || !!knowledge?.positioning;

  const runImport = async () => {
    if (!websiteUrl) {
      toast.error(t("noUrl"));
      return;
    }
    setImporting(true);
    try {
      const res = await apiPost<{ knowledge: ProductKnowledge }>(
        `/api/products/${productId}/knowledge/import`,
        { overwrite: hasContent },
      );
      if (!res.ok) {
        toast.error(userFacingError(res.data, t("toasts.importFailed")));
        return;
      }
      onImported(res.data.knowledge);
      toast.success(t("toasts.imported"));
    } catch {
      toast.error(t("toasts.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  const stamp = knowledge?.lastEnrichedAt
    ? t(knowledge.enrichmentSource === "url_import" ? "importedOn" : "editedOn", {
        date: new Date(knowledge.lastEnrichedAt).toLocaleDateString(locale),
      })
    : null;

  return (
    <SectionCard title={t("title")} description={t("description")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {stamp ?? (websiteUrl ? t("empty") : t("noUrl"))}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runImport}
          disabled={importing || !websiteUrl}
          className="h-8"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : hasContent ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <BookOpen className="h-3.5 w-3.5" />
          )}
          <span className="ms-1.5">
            {importing ? t("importing") : hasContent ? t("reimportButton") : t("importButton")}
          </span>
        </Button>
      </div>

      {knowledge?.positioning && (
        <ReadRow label={t("positioning")} value={knowledge.positioning} multiline />
      )}
      {audience.length > 0 && (
        <ReadRow label={t("audience")} value={audience.join(" ")} multiline />
      )}
      {lists.map((list) => (
        <ReadRow key={list.key} label={t(list.key)}>
          <ul className="space-y-1">
            {list.items.map((item, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </ReadRow>
      ))}
    </SectionCard>
  );
}

function IdentitySection({
  form,
  patchIdentity,
  logoUploading,
  logoInputRef,
  onLogoUpload,
  readOnly,
}: {
  form: Form;
  patchIdentity: <K extends keyof Form["identity"]>(k: K, v: Form["identity"][K]) => void;
  logoUploading: boolean;
  logoInputRef: React.RefObject<HTMLInputElement | null>;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("products.detailSheet.identity");
  if (readOnly) {
    const swatches: { label: string; color: string }[] = [
      { label: t("primary"), color: form.identity.primaryColor },
      { label: t("secondary"), color: form.identity.secondaryColor },
      { label: t("accent"), color: form.identity.accentColor },
    ];
    return (
      <>
        <SectionCard title={t("logoTitle")}>
          {form.identity.logoUrl ? (
            <img
              src={form.identity.logoUrl}
              alt="Logo"
              className="h-20 w-20 rounded-2xl object-contain border border-border/50 bg-white"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20">
              <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
            </div>
          )}
        </SectionCard>

        <SectionCard title={t("colorsTitle")}>
          <div className="flex flex-wrap gap-4">
            {swatches.map((s) => (
              <div key={s.label} className="flex items-center gap-2.5">
                <span
                  className="h-9 w-9 rounded-xl border border-border/50 shadow-sm"
                  style={{
                    background: /^#[0-9A-Fa-f]{6}$/i.test(s.color) ? s.color : "transparent",
                  }}
                />
                <div className="leading-tight">
                  <p className="text-[11px] font-medium text-foreground">{s.label}</p>
                  <p className="font-mono text-[11px] uppercase text-muted-foreground">
                    {s.color || "n/a"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <SectionCard title={t("logoTitle")} description={t("logoDescription")}>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
              >
                {logoUploading ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="me-1.5 h-3.5 w-3.5" />
                )}
                {logoUploading ? t("uploading") : form.identity.logoUrl ? t("replace") : t("upload")}
              </Button>
              {form.identity.logoUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => patchIdentity("logoUrl", "")}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("fileHint")}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("colorsTitle")} description={t("colorsDescription")}>
        <ColorField
          label={t("primary")}
          description={t("primaryDescription")}
          value={form.identity.primaryColor}
          onChange={(v) => patchIdentity("primaryColor", v)}
        />
        <ColorField
          label={t("secondary")}
          description={t("secondaryDescription")}
          value={form.identity.secondaryColor}
          onChange={(v) => patchIdentity("secondaryColor", v)}
        />
        <ColorField
          label={t("accent")}
          description={t("accentDescription")}
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
  metaLinkedPageIds,
  selectingPage,
  onLoadPages,
  onSelectPages,
  onStartOAuth,
  onDisconnect,
  getIntegration,
  onRefreshIntegrations,
  productId,
  connectOutcome,
  onDismissOutcome,
  brandName,
}: {
  integrations: IntegrationInfo[];
  disconnecting: string | null;
  loadingPages: boolean;
  metaPages: MetaPage[];
  metaLinkedPageIds: string[];
  selectingPage: boolean;
  onLoadPages: () => void;
  onSelectPages: (pageIds: string[]) => void | Promise<void>;
  onStartOAuth: (provider: string, linkedinMode?: "profile" | "community", mode?: "connect" | "reconnect") => void;
  onDisconnect: (provider: string, label: string, linkedinMode?: "profile" | "community") => void;
  getIntegration: (provider: string) => IntegrationInfo | undefined;
  onRefreshIntegrations: () => void | Promise<void>;
  productId: string | null;
  connectOutcome?: ConnectOutcome | null;
  onDismissOutcome?: () => void;
  brandName?: string | null;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const tHints = useTranslations("appCommon.connectChannel.hints");
  const locale = useLocale();
  void integrations; // used via getIntegration
  // The account the outcome panel names, as the user knows it.
  const outcomeIntegration = connectOutcome ? getIntegration(connectOutcome.provider) : undefined;
  const outcomeAccount = outcomeIntegration ? linkedAccountLabel(outcomeIntegration) : null;
  const meta = getIntegration("meta");
  const metaAccounts = (meta?.accounts ?? []).filter((account) => account.destinationId);
  // Use the shared resolver so this sheet and the Settings page can never
  // disagree (a workspace-scoped Meta leftover must not read as connected here).
  const metaState = resolveChannelStatus("meta", meta);
  const metaHasPage = metaState.state === "connected";
  const metaConnected = metaState.state === "connected" || metaState.state === "needs-page";
  const instagram = getIntegration("instagram");
  const instagramConnected = resolveChannelStatus("instagram", instagram).state === "connected";
  const tiktok = getIntegration("tiktok");
  return (
    <>
      <SectionCard
        title={t("title")}
        description={t("description")}
      >
        {connectOutcome && (
          <ConnectionOutcomeCard
            outcome={connectOutcome}
            brandName={brandName}
            account={outcomeAccount}
            grantedScopes={outcomeIntegration?.grantedScopes}
            onDismiss={() => onDismissOutcome?.()}
            onTryAgain={() => onStartOAuth(connectOutcome.provider, connectOutcome.linkedinMode ?? undefined)}
            onChoosePages={onLoadPages}
          />
        )}

        {/* Facebook (Meta) — its own per-product Facebook login */}
        <ChannelCard
          provider="meta"
          label={providerLabels.meta}
          connected={!!metaHasPage}
          testChannel="facebook"
          testProductId={productId}
          warn={!!metaConnected && !metaHasPage}
          warnLabel={t("pickAPage")}
          detail={
            metaHasPage
              ? metaAccounts.length > 1
                ? t("metaPagesLinkedCount", { count: metaAccounts.length })
                : meta?.pageName || t("facebookPageLinked")
              : metaConnected
              ? t("chooseWhichPages")
              : t("linkPages")
          }
        >
          {metaConnected ? (
            <>
              <HintButton hint={tHints("choosePages")} variant="outline" size="sm" onClick={onLoadPages} disabled={loadingPages}>
                {loadingPages ? t("loading") : metaHasPage ? t("addPages") : t("choosePages")}
              </HintButton>
              {/* Re-running Facebook login adds a credential rather than
                  replacing one, so this both refreshes the current account and
                  connects an additional one. Unlinking first is never needed. */}
              <HintButton
                hint={tHints("reconnect", { provider: providerLabels.meta })}
                variant="outline"
                size="sm"
                onClick={() => onStartOAuth("meta", undefined, "reconnect")}
              >
                {t("reconnectAddAccount")}
              </HintButton>
              <HintButton
                hint={tHints("disconnect")}
                variant="destructive"
                size="sm"
                onClick={() => onDisconnect("meta", providerLabels.meta)}
                disabled={disconnecting === "meta"}
              >
                {disconnecting === "meta"
                  ? "…"
                  : metaAccounts.length > 1
                  ? t("unlinkAllCount", { count: metaAccounts.length })
                  : t("unlink")}
              </HintButton>
              <LinkedAccountsList
                accounts={metaAccounts}
                provider="meta"
                productId={productId}
                onChanged={onRefreshIntegrations}
              />
              <DestinationPicker
                destinations={metaPages}
                linkedIds={metaLinkedPageIds}
                destinationLabel={t("pickAPage")}
                busy={selectingPage}
                onLink={onSelectPages}
              />
            </>
          ) : (
            <HintButton hint={tHints("connect", { provider: providerLabels.meta })} size="sm" onClick={() => onStartOAuth("meta")}>
              {t("connect")}
            </HintButton>
          )}
        </ChannelCard>

        {/* Instagram — its own Instagram Login, separate from Facebook */}
        <ChannelCard
          provider="instagram"
          label={providerLabels.instagram}
          connected={instagramConnected}
          testChannel="instagram"
          testProductId={productId}
          warn={!!instagram?.lastRefreshError}
          warnLabel={t("reconnectBadge")}
          grantedScopes={instagram?.grantedScopes}
          detail={
            instagramConnected
              ? [
                  instagram?.username ? `@${instagram.username}` : null,
                  instagram?.tokenExpiresAt
                    ? t("expires", { date: new Date(instagram.tokenExpiresAt).toLocaleDateString(locale) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : t("instagramNote")
          }
        >
          {instagram?.status === "connected" ? (
            <>
              <HintButton
                hint={tHints("reconnect", { provider: providerLabels.instagram })}
                variant="outline"
                size="sm"
                onClick={() => onStartOAuth("instagram", undefined, "reconnect")}
              >
                {t("reconnect")}
              </HintButton>
              <HintButton
                hint={tHints("disconnect")}
                variant="destructive"
                size="sm"
                onClick={() => onDisconnect("instagram", providerLabels.instagram)}
                disabled={disconnecting === "instagram"}
              >
                {disconnecting === "instagram" ? "…" : t("disconnect")}
              </HintButton>
            </>
          ) : (
            <HintButton hint={tHints("connect", { provider: providerLabels.instagram })} size="sm" onClick={() => onStartOAuth("instagram")}>
              {t("connect")}
            </HintButton>
          )}
        </ChannelCard>

        {/* TikTok */}
        <ChannelCard
          provider="tiktok"
          label={providerLabels.tiktok}
          connected={tiktok?.status === "connected"}
          testChannel="tiktok"
          testProductId={productId}
          warn={!!tiktok?.lastRefreshError}
          warnLabel={t("reconnectBadge")}
          grantedScopes={tiktok?.grantedScopes}
          detail={
            [
              tiktok?.username ? `@${tiktok.username}` : null,
              tiktok?.lastRefreshError && tiktok?.tokenExpiresAt
                ? t("expires", { date: new Date(tiktok.tokenExpiresAt).toLocaleDateString(locale) })
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        >
          {tiktok?.status === "connected" ? (
            <>
              <HintButton
                hint={tHints("reconnect", { provider: providerLabels.tiktok })}
                variant="outline"
                size="sm"
                onClick={() => onStartOAuth("tiktok", undefined, "reconnect")}
              >
                {t("reconnect")}
              </HintButton>
              <HintButton
                hint={tHints("disconnect")}
                variant="destructive"
                size="sm"
                onClick={() => onDisconnect("tiktok", providerLabels.tiktok)}
                disabled={disconnecting === "tiktok"}
              >
                {disconnecting === "tiktok" ? "…" : t("disconnect")}
              </HintButton>
            </>
          ) : (
            <HintButton hint={tHints("connect", { provider: providerLabels.tiktok })} size="sm" onClick={() => onStartOAuth("tiktok")}>
              {t("connect")}
            </HintButton>
          )}
        </ChannelCard>

        {/* Threads */}
        <SimpleConnectCard
          label={providerLabels.threads}
          integration={getIntegration("threads")}
          disconnecting={disconnecting}
          onStartOAuth={onStartOAuth}
          onDisconnect={onDisconnect}
          detail={(integ) => (integ?.username ? `@${integ.username}` : undefined)}
        />

        {/* X */}
        <SimpleConnectCard
          label={providerLabels.x}
          integration={getIntegration("x")}
          disconnecting={disconnecting}
          onStartOAuth={onStartOAuth}
          onDisconnect={onDisconnect}
          detail={(integ) => (integ?.username ? `@${integ.username}` : undefined)}
        />

        {/* Pinterest */}
        <SimpleConnectCard
          label={providerLabels.pinterest}
          integration={getIntegration("pinterest")}
          disconnecting={disconnecting}
          onStartOAuth={onStartOAuth}
          onDisconnect={onDisconnect}
          detail={(integ) =>
            integ?.boardName
              ? t("pinningTo", { board: integ.boardName })
              : integ?.status === "connected"
              ? t("selectBoardToEnable")
              : undefined
          }
          warnWhen={(integ) => !!integ && integ.status === "connected" && !integ.boardId}
          warnLabel={t("selectBoard")}
          pickerWhen={(integ) => !!integ && integ.status === "connected"}
          pickerLabel={(integ) => (integ?.boardId ? t("changeBoard") : t("selectBoard"))}
          pickerProvider="pinterest"
          pickerDestinationLabel={t("selectBoard")}
          onPickerSelected={onRefreshIntegrations}
          productId={productId}
        />

        {/* LinkedIn */}
        <LinkedInConnectCard
          integration={getIntegration("linkedin")}
          disconnecting={disconnecting}
          onStartOAuth={onStartOAuth}
          onDisconnect={onDisconnect}
          onPickerSelected={onRefreshIntegrations}
          productId={productId}
        />

      </SectionCard>
    </>
  );
}

type PickerDestination = { id: string; name: string; type?: string; accountId?: string | null; accountLabel?: string | null; urn?: string };

function LinkedInConnectCard({
  integration,
  disconnecting,
  onStartOAuth,
  onDisconnect,
  onPickerSelected,
  productId,
}: {
  integration: IntegrationInfo | undefined;
  disconnecting: string | null;
  onStartOAuth: (provider: string, linkedinMode?: "profile" | "community", mode?: "connect" | "reconnect") => void;
  onDisconnect: (provider: string, label: string, linkedinMode?: "profile" | "community") => void;
  onPickerSelected?: () => void | Promise<void>;
  productId?: string | null;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const tHints = useTranslations("appCommon.connectChannel.hints");
  const tToasts = useTranslations("products.detailSheet.channels.toasts");
  const profileConnected =
    integration?.linkedinProfileConnected === true ||
    (integration?.status === "connected" && integration.linkedinDestinationType === "profile");
  const communityConnected =
    integration?.linkedinCommunityConnected === true ||
    (Array.isArray(integration?.linkedinPages) && integration.linkedinPages.length > 0);
  const connected = profileConnected || communityConnected;
  const needsReconnect =
    integration?.status === "expired" ||
    !!integration?.lastRefreshError ||
    integration?.linkedinProfileStatus === "expired" ||
    integration?.linkedinCommunityStatus === "expired";
  const needsTarget = connected && !integration?.linkedinDestinationUrn;
  const [destinations, setDestinations] = useState<PickerDestination[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [selectedDestinationId, setSelectedDestinationId] = useState("");
  const [selecting, setSelecting] = useState(false);

  async function loadDestinations() {
    if (!productId) return;
    setLoadingDestinations(true);
    try {
      const res = await apiGet<{ pages: PickerDestination[] }>(
        `/api/oauth/pages/linkedin?productId=${productId}`,
      );
      if (res.ok) {
        setDestinations(res.data.pages || []);
        if ((res.data.pages || []).length === 0) {
          toast.error(tToasts("noLinkedInTargets"));
        }
      } else {
        toast.error(tToasts("loadLinkedInFailed"));
      }
    } catch {
      toast.error(tToasts("loadLinkedInFailed"));
    } finally {
      setLoadingDestinations(false);
    }
  }

  async function selectDestination() {
    if (!selectedDestinationId || !productId) return;
    const picked = destinations.find((d) => d.id === selectedDestinationId);
    setSelecting(true);
    try {
      const res = await apiPost<{ ok: boolean; name?: string }>(
        "/api/oauth/pages/linkedin/select",
        {
          pageId: selectedDestinationId,
          pageName: picked?.name,
          productId,
        },
      );
      if (res.ok && res.data.ok) {
        toast.success(tToasts("linkedInSelected", { name: picked?.name || "" }));
        setDestinations([]);
        setSelectedDestinationId("");
        if (onPickerSelected) await onPickerSelected();
      } else {
        toast.error(tToasts("selectLinkedInFailed"));
      }
    } catch {
      toast.error(tToasts("selectLinkedInFailed"));
    } finally {
      setSelecting(false);
    }
  }

  return (
    <ChannelCard
      provider="linkedin"
      label={providerLabels.linkedin}
      connected={connected && !needsTarget && !needsReconnect}
      testChannel="linkedin"
      testProductId={productId}
      warn={needsReconnect || needsTarget}
      warnLabel={needsReconnect ? t("reconnectBadge") : t("selectTarget")}
      grantedScopes={integration?.grantedScopes}
      detail={
        integration?.linkedinDestinationName
          ? t("postingTo", { target: integration.linkedinDestinationName })
          : connected
          ? t("selectProfileOrPage")
          : undefined
      }
    >
      <div className="flex flex-wrap gap-2 justify-end">
        {profileConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDisconnect("linkedin", providerLabels.linkedin_profile, "profile")}
            disabled={disconnecting === "linkedin:profile"}
          >
            {disconnecting === "linkedin:profile" ? "…" : t("unlinkProfile")}
          </Button>
        ) : (
          <HintButton hint={tHints("connect", { provider: providerLabels.linkedin })} size="sm" onClick={() => onStartOAuth("linkedin", "profile")}>
            {t("linkProfile")}
          </HintButton>
        )}
        {communityConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDisconnect("linkedin", providerLabels.linkedin_community, "community")}
            disabled={disconnecting === "linkedin:community"}
          >
            {disconnecting === "linkedin:community" ? "…" : t("unlinkPagesBtn")}
          </Button>
        ) : (
          <HintButton hint={tHints("connect", { provider: providerLabels.linkedin })} size="sm" onClick={() => onStartOAuth("linkedin", "community")}>
            {t("linkPagesBtn")}
          </HintButton>
        )}
        {connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={loadDestinations}
            disabled={loadingDestinations}
          >
            {loadingDestinations ? t("loading") : integration?.linkedinDestinationUrn ? t("changeTarget") : t("selectTarget")}
          </Button>
        )}
      </div>
      {connected && destinations.length > 0 && (
        <div className="flex gap-2 pt-2 w-full">
          <Select
            value={selectedDestinationId}
            onChange={(e) => setSelectedDestinationId(e.target.value)}
            className="flex-1"
          >
            <option value="">{t("selectTargetPlaceholder")}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={selectDestination}
            disabled={selecting || !selectedDestinationId}
          >
            {selecting ? "…" : t("select")}
          </Button>
        </div>
      )}
    </ChannelCard>
  );
}

function SimpleConnectCard({
  label,
  integration,
  disconnecting,
  onStartOAuth,
  onDisconnect,
  detail,
  warnWhen,
  warnLabel,
  pickerWhen,
  pickerLabel,
  pickerProvider,
  pickerDestinationLabel,
  onPickerSelected,
  productId,
}: {
  label: string;
  integration: IntegrationInfo | undefined;
  disconnecting: string | null;
  onStartOAuth: (provider: string, linkedinMode?: "profile" | "community", mode?: "connect" | "reconnect") => void;
  onDisconnect: (provider: string, label: string) => void;
  detail?: (integ: IntegrationInfo | undefined) => string | undefined;
  warnWhen?: (integ: IntegrationInfo | undefined) => boolean;
  warnLabel?: string;
  pickerWhen?: (integ: IntegrationInfo | undefined) => boolean;
  pickerLabel?: (integ: IntegrationInfo | undefined) => string;
  pickerProvider?: string;
  pickerDestinationLabel?: string;
  onPickerSelected?: () => void | Promise<void>;
  productId?: string | null;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const tToasts = useTranslations("products.detailSheet.channels.toasts");
  const tHints = useTranslations("appCommon.connectChannel.hints");
  const provider = (() => {
    const entry = Object.entries(providerLabels).find(([, l]) => l === label);
    return entry ? entry[0] : "";
  })();
  const connected =
    integration?.status === "connected" && !integration?.lastRefreshError;
  const needsReconnect =
    integration?.status === "expired" || !!integration?.lastRefreshError;

  const pickerActive = !!(pickerWhen && pickerProvider && pickerWhen(integration));
  const [destinations, setDestinations] = useState<PickerDestination[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const destinationLabel = pickerDestinationLabel || t("warning");
  const accounts = integration?.accounts ?? [];

  async function loadDestinations() {
    if (!pickerProvider || !productId) return;
    setLoadingDestinations(true);
    try {
      const res = await apiGet<{ pages: PickerDestination[]; linkedIds?: string[] }>(
        `/api/oauth/pages/${pickerProvider}?productId=${productId}`,
      );
      if (res.ok) {
        setDestinations(res.data.pages || []);
        setLinkedIds(res.data.linkedIds || []);
        if ((res.data.pages || []).length === 0) {
          toast.error(tToasts("noDestinationsFound", { destination: destinationLabel }));
        }
      } else {
        toast.error(tToasts("loadDestinationsFailed", { destination: destinationLabel }));
      }
    } catch {
      toast.error(tToasts("loadDestinationsFailed", { destination: destinationLabel }));
    } finally {
      setLoadingDestinations(false);
    }
  }

  async function linkDestinations(ids: string[]) {
    if (ids.length === 0 || !pickerProvider || !productId) return;
    const names = Object.fromEntries(
      ids.map((id) => [id, destinations.find((d) => d.id === id)?.name || ""]),
    );
    setSelecting(true);
    try {
      const res = await apiPost<{ ok: boolean; linked?: Array<{ name: string }> }>(
        `/api/oauth/pages/${pickerProvider}/select`,
        { pageIds: ids, pageNames: names, productId },
      );
      if (res.ok && res.data.ok) {
        const count = res.data.linked?.length ?? ids.length;
        toast.success(t("linkedCount", { count, destination: destinationLabel }));
        setDestinations([]);
        setLinkedIds([]);
        if (onPickerSelected) await onPickerSelected();
      } else {
        toast.error(tToasts("linkDestinationsFailed", { destination: destinationLabel }));
      }
    } catch {
      toast.error(tToasts("linkDestinationsFailed", { destination: destinationLabel }));
    } finally {
      setSelecting(false);
    }
  }

  return (
    <ChannelCard
      provider={provider}
      label={label}
      connected={!!connected}
      testChannel={provider}
      testProductId={productId}
      warn={needsReconnect || (warnWhen ? warnWhen(integration) : false)}
      warnLabel={needsReconnect ? t("reconnectBadge") : warnLabel || t("warning")}
      detail={detail ? detail(integration) : undefined}
      grantedScopes={integration?.grantedScopes}
    >
      {connected ? (
        <>
          {pickerActive && pickerLabel && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadDestinations}
              disabled={loadingDestinations}
            >
              {loadingDestinations ? t("loading") : pickerLabel(integration)}
            </Button>
          )}
          <HintButton
            hint={tHints("reconnect", { provider: label })}
            variant="outline"
            size="sm"
            onClick={() => onStartOAuth(provider, undefined, "reconnect")}
          >
            {t("reconnect")}
          </HintButton>
          <HintButton
            hint={tHints("disconnect")}
            variant="destructive"
            size="sm"
            onClick={() => onDisconnect(provider, label)}
            disabled={disconnecting === provider}
          >
            {disconnecting === provider
              ? "…"
              : accounts.length > 1
              ? t("disconnectAllCount", { count: accounts.length })
              : t("disconnect")}
          </HintButton>
          <LinkedAccountsList
            accounts={accounts}
            provider={provider}
            productId={productId}
            onChanged={() => onPickerSelected?.()}
          />
          {pickerActive && (
            <DestinationPicker
              destinations={destinations}
              linkedIds={linkedIds}
              destinationLabel={destinationLabel}
              busy={selecting}
              onLink={linkDestinations}
            />
          )}
        </>
      ) : (
        <HintButton
          hint={needsReconnect ? tHints("reconnect", { provider: label }) : tHints("connect", { provider: label })}
          size="sm"
          onClick={() => onStartOAuth(provider, undefined, needsReconnect ? "reconnect" : "connect")}
        >
          {needsReconnect ? t("reconnect") : t("connect")}
        </HintButton>
      )}
    </ChannelCard>
  );
}

/** The linked account as the user knows it, for the post-connect panel. */
function linkedAccountLabel(integration: IntegrationInfo): string | null {
  if (integration.username) return `@${integration.username}`;
  return (
    integration.pageName ||
    integration.boardName ||
    integration.linkedinDestinationName ||
    integration.linkedinProfileName ||
    null
  );
}

function accountName(account: LinkedAccount, fallback: string): string {
  return (
    account.label ||
    account.pageName ||
    account.boardName ||
    account.linkedinDestinationName ||
    (account.username ? `@${account.username}` : null) ||
    account.destinationId ||
    fallback
  );
}

/**
 * The accounts already linked for a channel, each with its own unlink control.
 * Unlinking one leaves the rest of the brand's accounts on that platform alone.
 */
function LinkedAccountsList({
  accounts,
  provider,
  productId,
  linkedinMode,
  onChanged,
}: {
  accounts: LinkedAccount[];
  provider: string;
  productId?: string | null;
  linkedinMode?: "profile" | "community";
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const tToasts = useTranslations("products.detailSheet.channels.toasts");
  const [unlinking, setUnlinking] = useState<string | null>(null);

  if (accounts.length === 0) return null;

  async function unlink(account: LinkedAccount) {
    if (!productId || !account.destinationId) return;
    const name = accountName(account, t("linkedAccountFallback"));
    setUnlinking(account.destinationId);
    try {
      const res = await apiPost(`/api/oauth/disconnect/${provider}`, {
        productId,
        destinationId: account.destinationId,
        ...(linkedinMode ? { linkedinMode } : {}),
      });
      if (res.ok) {
        toast.success(tToasts("accountUnlinked", { account: name }));
        await onChanged();
      } else {
        toast.error(tToasts("unlinkFailed", { account: name }));
      }
    } catch {
      toast.error(tToasts("unlinkFailed", { account: name }));
    } finally {
      setUnlinking(null);
    }
  }

  return (
    <div className="w-full space-y-1.5 pt-1">
      {accounts.map((account) => (
        <div
          key={account.connectionId}
          className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
            {accountName(account, t("linkedAccountFallback"))}
          </span>
          {!account.enabled && (
            <Badge className="border-0 text-[10px] shrink-0" style={pillStyle("warn")}>
              {account.status === "revoked" ? t("reconnectBadge") : account.status}
            </Badge>
          )}
          {account.destinationId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => unlink(account)}
              disabled={unlinking === account.destinationId}
            >
              {unlinking === account.destinationId ? "…" : t("unlink")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Multi-select picker for a provider's available destinations. Linking is
 * additive: choosing a Page never displaces one already linked.
 */
function DestinationPicker({
  destinations,
  linkedIds,
  destinationLabel,
  busy,
  onLink,
}: {
  destinations: PickerDestination[];
  linkedIds: string[];
  destinationLabel: string;
  busy: boolean;
  onLink: (ids: string[]) => void | Promise<void>;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const [selected, setSelected] = useState<string[]>([]);
  const linked = new Set(linkedIds);
  const selectable = destinations.filter((item) => !linked.has(item.id));

  if (destinations.length === 0) return null;

  if (selectable.length === 0) {
    return (
      <p className="w-full pt-1 text-[11.5px] text-muted-foreground">
        {t("everyDestinationLinked", { destination: destinationLabel })}
      </p>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  // With two accounts connected, show whose Pages these are.
  const groups = new Map<string, { label: string; items: PickerDestination[] }>();
  for (const item of selectable) {
    const key = item.accountId || "";
    const group = groups.get(key) || { label: item.accountLabel || "", items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const showAccountHeadings = groups.size > 1;

  return (
    <div className="w-full space-y-2 pt-1">
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/40 p-1.5">
        {[...groups.entries()].map(([key, group]) => (
          <div key={key || "default"} className="space-y-1">
            {showAccountHeadings && (
              <p className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label || t("connectedAccount")}
              </p>
            )}
            {group.items.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-mk-pos"
                  checked={selected.includes(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button
        size="sm"
        onClick={() => onLink(selected)}
        disabled={busy || selected.length === 0}
      >
        {busy
          ? "…"
          : t("linkedCount", { count: selected.length || 0, destination: destinationLabel }).replace(/\s+/g, " ")}
      </Button>
    </div>
  );
}

/**
 * "Test connection" on a channel row (3.9). Calls the unified
 * `/api/integrations/[channel]/test`, which runs the adapter's own
 * `testConnection()` against every linked account and, on failure, writes the
 * same status annotation a failed publish does, so testing also repairs what
 * the rest of the UI reports. The success toast names the platform's own
 * account label: the question is never just "is something connected" but
 * "WHICH account is connected".
 */
function TestConnectionButton({ channel, productId }: { channel: string; productId?: string | null }) {
  const t = useTranslations("products.detailSheet.channels");
  const tHints = useTranslations("appCommon.connectChannel.hints");
  const [testing, setTesting] = useState(false);
  const providerName = channel === "facebook" ? providerLabels.meta : providerLabels[channel] ?? channel;

  if (!productId) return null;

  async function run() {
    setTesting(true);
    try {
      const res = await apiPost<{ ok: boolean; label?: string; error?: string }>(
        `/api/integrations/${channel}/test`,
        { productId },
      );
      if (res.ok && res.data.ok) {
        toast.success(res.data.label ? t("testOk", { label: res.data.label }) : t("testOkPlain"));
      } else {
        // Never the raw error field: adapter test failures can carry provider
        // text. `userFacingError` renders only application-authored copy.
        toast.error(userFacingError(res.data, t("testFailed")));
      }
    } catch {
      toast.error(t("testFailed"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <HintButton hint={tHints("test", { provider: providerName })} variant="outline" size="sm" onClick={run} disabled={testing}>
      {testing ? t("testing") : t("testConnection")}
    </HintButton>
  );
}

function ChannelCard({
  provider,
  label,
  connected,
  warn,
  warnLabel,
  detail,
  children,
  testChannel,
  testProductId,
  grantedScopes,
}: {
  provider?: string;
  label: string;
  connected: boolean;
  warn?: boolean;
  warnLabel?: string;
  detail?: string;
  /** Scopes the platform reported on the grant; rendered as what the link can do. */
  grantedScopes?: string[] | null;
  children: React.ReactNode;
  /** Social channel to test when connected; renders the test button. */
  testChannel?: string;
  testProductId?: string | null;
}) {
  const t = useTranslations("products.detailSheet.channels");
  const tCommon = useTranslations("appCommon.connectChannel");
  const brand = provider ? CHANNEL_BRAND[provider] : undefined;
  const catalogProvider = provider ? catalogProviderFor(provider) : null;
  const grantedTitles = connected && catalogProvider && grantedScopes?.length
    ? grantedPermissions(catalogProvider, grantedScopes).map((item) => tCommon(`permissions.${item.key}.title`))
    : [];
  return (
    <div
      className="group rounded-xl border border-border/50 p-3.5 transition-colors hover:border-border data-[on=true]:border-[color:var(--mk-pos)]/30"
      data-on={connected ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        {brand && (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] shadow-sm"
            style={{ background: brand.bg }}
          >
            {brand.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{label}</p>
            {connected && (
              <Badge className="border-0 text-[10px] shrink-0" style={pillStyle("pos")}>
                {t("linked")}
              </Badge>
            )}
            {warn && (
              <Badge className="border-0 text-[10px] shrink-0" style={pillStyle("warn")}>
                {warnLabel || t("warning")}
              </Badge>
            )}
          </div>
          {detail && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{detail}</p>}
          {grantedTitles.length > 0 && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground/80">{tCommon("outcome.grantedTitle")}:</span>{" "}
              {grantedTitles.join(" · ")}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 ps-0 sm:ps-12">
        {connected && testChannel && (
          <TestConnectionButton channel={testChannel} productId={testProductId} />
        )}
        {children}
      </div>
    </div>
  );
}
