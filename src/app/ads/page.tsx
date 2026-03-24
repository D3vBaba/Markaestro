"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader,
  SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import type { AdCampaignMetrics } from "@/lib/ads/types";
import { FacebookAdPreview, GoogleAdPreview } from "@/components/app/PlatformPreview";

// ── Types ────────────────────────────────────────────────────────────

type AdCampaign = {
  id: string;
  name: string;
  platform: "meta" | "google" | "tiktok";
  objective: string;
  status: string;
  dailyBudgetCents: number;
  startDate: string;
  endDate?: string | null;
  targeting?: {
    ageMin?: number;
    ageMax?: number;
    gender?: string;
    locations?: string[];
    interests?: string[];
  };
  creative: {
    headline: string;
    primaryText: string;
    description?: string;
    imageUrl?: string;
    videoUrl?: string;
    linkUrl?: string;
    ctaType?: string;
  };
  productId?: string;
  adAccountId?: string;
  customerId?: string;
  metrics?: AdCampaignMetrics;
  externalCampaignId?: string;
  errorMessage?: string;
  createdAt?: string;
  launchedAt?: string;
};

type Product = { id: string; name: string };
type IntegrationStatus = { provider: string; status: string; pageId?: string | null };

type CampaignInsights = {
  overallScore: number;
  scoreLabel: string;
  summary: string;
  strengths: string[];
  improvements: Array<{ area: string; issue: string; suggestion: string; impact: string }>;
  benchmarks?: { ctrBenchmark: string; cpcBenchmark: string; verdict: string };
  creativeScore: number;
  targetingScore: number;
  budgetScore: number;
  quickWins: string[];
};

type AggregateInsights = {
  summary: string;
  healthScore: number;
  recommendations: Array<{ priority: string; category: string; title: string; description: string }>;
  topPerformer?: { name: string; reason: string } | null;
  underperformer?: { name: string; reason: string; fix: string } | null;
  budgetAdvice?: string;
  platformInsights?: Array<{ platform: string; verdict: string; tip: string }>;
  contentTips?: string[];
  nextSteps?: string[];
};

// ── Constants ────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  draft: "text-muted-foreground",
  pending: "text-amber-600",
  active: "text-emerald-600",
  paused: "text-amber-600",
  completed: "text-muted-foreground",
  failed: "text-destructive",
};
const platformLabels: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok" };
const objectiveLabels: Record<string, string> = {
  awareness: "Awareness", traffic: "Traffic", engagement: "Engagement",
  leads: "Leads", conversions: "Conversions", app_installs: "App Installs",
};
const metaObjectiveOptions = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
] as const;
const googleObjectiveOptions = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
  { value: "leads", label: "Lead Generation" },
  { value: "conversions", label: "Conversions" },
  { value: "app_installs", label: "App Installs" },
] as const;
const tiktokObjectiveOptions = [
  { value: "awareness", label: "Reach" },
  { value: "traffic", label: "Traffic" },
  { value: "engagement", label: "Engagement" },
  { value: "leads", label: "Lead Generation" },
  { value: "conversions", label: "Conversions" },
  { value: "app_installs", label: "App Promotion" },
] as const;

function getObjectiveOptions(platform: "meta" | "google" | "tiktok") {
  if (platform === "meta") return metaObjectiveOptions;
  if (platform === "tiktok") return tiktokObjectiveOptions;
  return googleObjectiveOptions;
}

function normalizeObjectiveForPlatform(platform: "meta" | "google" | "tiktok", objective: string) {
  if (platform === "meta" && !metaObjectiveOptions.some((option) => option.value === objective)) {
    return "traffic";
  }
  return objective;
}

function formatCurrency(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Subcomponents ────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 sm:p-4 rounded-lg border border-border/40 bg-card">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-lg sm:text-xl font-light tabular-nums">{value}</p>
    </div>
  );
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2} className="text-muted/30" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={2}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} className="transition-all duration-700"
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fill={color} fontSize={size * 0.28} fontWeight={600}>
        {score}
      </text>
    </svg>
  );
}

function MediaUploadZone({
  type,
  url,
  uploading,
  onUpload,
  onRemove,
  accept,
  platform,
}: {
  type: "image" | "video";
  url: string;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  accept: string;
  platform: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const specs: Record<string, Record<string, string>> = {
    meta: { image: "1200x628px recommended, JPG/PNG, max 10MB", video: "MP4, 1:1 or 4:5, max 500MB, 1-241s" },
    google: { image: "1200x628px, JPG/PNG/GIF, max 10MB", video: "MP4/MOV, 16:9, max 500MB" },
    tiktok: { image: "1080x1080px recommended, JPG/PNG, max 10MB", video: "MP4, 9:16 vertical, max 500MB, 5-60s" },
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const maxSize = type === "video" ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File must be under ${Math.round(maxSize / (1024 * 1024))} MB`);
      return;
    }
    onUpload(file);
  };

  if (url) {
    return (
      <div className="relative group rounded-lg overflow-hidden border border-border/40">
        {type === "image" ? (
          <img src={url} alt="Ad creative" className="w-full aspect-video object-cover" />
        ) : (
          <video src={url} controls className="w-full aspect-video object-cover" />
        )}
        <button
          onClick={onRemove}
          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative border border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
        dragOver ? "border-foreground bg-foreground/5" : "border-border/60 hover:border-foreground/40"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Uploading...</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {dragOver ? "Drop file here" : `Upload ${type === "video" ? "Video" : "Image"}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Drag & drop or click to browse
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {specs[platform]?.[type] || `Max ${type === "video" ? "500MB" : "10MB"}`}
          </p>
        </div>
      )}
    </div>
  );
}

function AdPreview({ form }: { form: { platform: string; headline: string; primaryText: string; description: string; imageUrl: string; videoUrl: string; linkUrl: string; ctaType: string } }) {
  const hasMedia = form.imageUrl || form.videoUrl;
  if (!form.headline && !form.primaryText && !hasMedia) return null;

  if (form.platform === "google") {
    return (
      <GoogleAdPreview
        platform="google"
        headline={form.headline}
        primaryText={form.primaryText}
        description={form.description}
        linkUrl={form.linkUrl}
        ctaType={form.ctaType}
      />
    );
  }

  return (
    <FacebookAdPreview
      platform="meta"
      headline={form.headline}
      primaryText={form.primaryText}
      description={form.description}
      imageUrl={form.imageUrl}
      videoUrl={form.videoUrl}
      linkUrl={form.linkUrl}
      ctaType={form.ctaType}
    />
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AdsPage() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("campaigns");

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestStep, setSuggestStep] = useState(0);
  const [suggestRationale, setSuggestRationale] = useState<{
    summary: string; painPoints: string[]; competitorInsights: string[]; whyThisAd: string;
  } | null>(null);

  const [aggregateInsights, setAggregateInsights] = useState<AggregateInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [campaignInsights, setCampaignInsights] = useState<Record<string, CampaignInsights>>({});
  const [insightLoadingId, setInsightLoadingId] = useState<string | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<AdCampaign | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormStep, setEditFormStep] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editUploadingImage, setEditUploadingImage] = useState(false);
  const [editUploadingVideo, setEditUploadingVideo] = useState(false);
  const [editAdAccounts, setEditAdAccounts] = useState<{ id: string; name: string }[]>([]);
  const [editLoadingAccounts, setEditLoadingAccounts] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", platform: "meta" as "meta" | "google" | "tiktok",
    objective: "traffic", dailyBudgetCents: 1000,
    startDate: "", endDate: "", productId: "",
    adAccountId: "", customerId: "",
    ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "",
    headline: "", primaryText: "", description: "",
    imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
  });

  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", platform: "meta" as "meta" | "google" | "tiktok",
    objective: "traffic", dailyBudgetCents: 1000,
    startDate: new Date().toISOString().split("T")[0], endDate: "", productId: "",
    ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "",
    headline: "", primaryText: "", description: "",
    imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
  });

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await apiGet<{ campaigns: AdCampaign[] }>("/api/ad-campaigns");
      if (res.ok) setCampaigns(res.data.campaigns || []);
    } catch { toast.error("Failed to load ad campaigns"); }
    finally { setLoading(false); }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (res.ok) setProducts(res.data.products || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchCampaigns(); fetchProducts(); }, [fetchCampaigns, fetchProducts]);

  const resetForm = () => {
    setForm({
      name: "", platform: "meta", objective: "traffic", dailyBudgetCents: 1000,
      startDate: new Date().toISOString().split("T")[0], endDate: "", productId: "",
      ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "",
      headline: "", primaryText: "", description: "",
      imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
    });
    setFormStep(0);
  };

  const handleMediaUpload = async (file: File, mediaType: "image" | "video") => {
    const setter = mediaType === "video" ? setUploadingVideo : setUploadingImage;
    setter(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiUpload<{ ok: boolean; url: string; type: string; fileName: string; fileSize: number }>(
        "/api/ad-campaigns/upload-media", formData,
      );
      if (res.ok && res.data.url) {
        if (mediaType === "video") {
          setForm((f) => ({ ...f, videoUrl: res.data.url }));
        } else {
          setForm((f) => ({ ...f, imageUrl: res.data.url }));
        }
        toast.success(`${file.name} uploaded (${formatBytes(res.data.fileSize)})`);
      } else {
        toast.error(`Upload failed: ${(res.data as unknown as { error?: string }).error || "Unknown error"}`);
      }
    } catch {
      toast.error("Failed to upload file");
    } finally {
      setter(false);
    }
  };

  const handleSmartSuggest = async () => {
    if (!form.productId) {
      toast.error("Select a product first so AI can research your app");
      return;
    }
    setSuggesting(true);
    setSuggestRationale(null);
    setSuggestStep(0);

    const stepTimer1 = setTimeout(() => setSuggestStep(1), 1800);
    const stepTimer2 = setTimeout(() => setSuggestStep(2), 4000);

    try {
      const res = await apiPost<{
        ok: boolean;
        suggestion: {
          name: string; objective: string; dailyBudgetCents: number;
          headline: string; primaryText: string; description: string;
          ctaType: string; linkUrl: string;
          targeting: { ageMin: number; ageMax: number; gender: string; locations: string[]; interests: string[] };
          rationale: { summary: string; painPoints: string[]; competitorInsights: string[]; whyThisAd: string };
        };
        error?: string;
      }>("/api/ad-campaigns/suggest", { productId: form.productId, platform: form.platform });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      if (!res.ok || !res.data.ok || !res.data.suggestion) {
        toast.error(res.data.error || "AI research failed -- try again");
        return;
      }

      const s = res.data.suggestion;
      setSuggestRationale(s.rationale);
      setForm((f) => ({
        ...f,
        name: s.name || f.name,
        objective: normalizeObjectiveForPlatform(f.platform, s.objective || f.objective),
        dailyBudgetCents: s.dailyBudgetCents || f.dailyBudgetCents,
        headline: s.headline || f.headline,
        primaryText: s.primaryText || f.primaryText,
        description: s.description || f.description,
        ctaType: s.ctaType || f.ctaType,
        linkUrl: s.linkUrl || f.linkUrl,
        ageMin: s.targeting?.ageMin || f.ageMin,
        ageMax: s.targeting?.ageMax || f.ageMax,
        gender: s.targeting?.gender || f.gender,
        locations: s.targeting?.locations?.join(", ") || f.locations,
        interests: s.targeting?.interests?.join(", ") || f.interests,
      }));
      setFormStep(3);
      toast.success("AI researched your market and crafted an ad -- review it below");
    } catch {
      toast.error("AI research failed -- try again");
    } finally {
      setSuggesting(false);
      setSuggestStep(0);
    }
  };

  const handleCreate = async () => {
    if (form.platform === "meta" && !form.productId) {
      toast.error("Meta ad campaigns must be tied to a product");
      return;
    }
    if (form.platform === "meta" && !metaObjectiveOptions.some((option) => option.value === form.objective)) {
      toast.error("Meta currently supports awareness, traffic, and engagement only");
      return;
    }

    setSaving(true);
    try {
      if (form.platform === "meta") {
        const integrationRes = await apiGet<{ integrations: IntegrationStatus[] }>(`/api/integrations?productId=${form.productId}`);
        const metaConnection = integrationRes.ok
          ? (integrationRes.data.integrations || []).find((integration) => integration.provider === "meta" && integration.status === "connected")
          : null;

        if (!metaConnection?.pageId) {
          toast.error("Select a Facebook page on the product's Meta integration before creating a Meta ad campaign");
          return;
        }
      }

      const res = await apiPost("/api/ad-campaigns", {
        name: form.name, platform: form.platform, objective: form.objective,
        dailyBudgetCents: form.dailyBudgetCents,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        productId: form.productId,
        targeting: {
          ageMin: form.ageMin, ageMax: form.ageMax, gender: form.gender,
          locations: form.locations ? form.locations.split(",").map((s) => s.trim()).filter(Boolean) : [],
          interests: form.interests ? form.interests.split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
        creative: {
          headline: form.headline, primaryText: form.primaryText, description: form.description,
          imageUrl: form.imageUrl, videoUrl: form.videoUrl, linkUrl: form.linkUrl, ctaType: form.ctaType,
        },
      });
      if (res.ok) { toast.success("Ad campaign created"); resetForm(); setFormOpen(false); fetchCampaigns(); }
      else {
        const d = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(d.issues?.[0]?.message || d.error || "Failed to create campaign");
      }
    } catch { toast.error("Failed to create campaign"); }
    finally { setSaving(false); }
  };

  const openEdit = async (c: AdCampaign) => {
    setEditingId(c.id);
    setEditFormStep(0);
    setEditAdAccounts([]);
    setEditForm({
      name: c.name,
      platform: c.platform,
      objective: normalizeObjectiveForPlatform(c.platform, c.objective),
      dailyBudgetCents: c.dailyBudgetCents,
      startDate: c.startDate ? c.startDate.split("T")[0] : "",
      endDate: c.endDate ? c.endDate.split("T")[0] : "",
      productId: c.productId || "",
      adAccountId: c.adAccountId || "",
      customerId: c.customerId || "",
      ageMin: c.targeting?.ageMin ?? 18,
      ageMax: c.targeting?.ageMax ?? 65,
      gender: c.targeting?.gender ?? "all",
      locations: (c.targeting?.locations || []).join(", "),
      interests: (c.targeting?.interests || []).join(", "),
      headline: c.creative?.headline ?? "",
      primaryText: c.creative?.primaryText ?? "",
      description: c.creative?.description ?? "",
      imageUrl: c.creative?.imageUrl ?? "",
      videoUrl: c.creative?.videoUrl ?? "",
      linkUrl: c.creative?.linkUrl ?? "",
      ctaType: c.creative?.ctaType ?? "",
    });
    setEditOpen(true);
    setEditLoadingAccounts(true);
    try {
      if (c.platform === "meta") {
        if (!c.productId) {
          setEditAdAccounts([]);
          toast.error("Meta campaigns must be tied to a product before selecting an ad account");
          return;
        }
        const qs = c.productId ? `?productId=${c.productId}` : "";
        const res = await apiGet<{ adAccounts: { id: string; name: string }[]; error?: string }>(`/api/integrations/meta/ad-accounts${qs}`);
        if (res.ok) {
          setEditAdAccounts(res.data.adAccounts || []);
          if (res.data.error) toast.error(`Meta: ${res.data.error}`);
        }
      } else {
        const res = await apiGet<{ customers: { id: string; name: string }[]; error?: string }>("/api/integrations/google/customers");
        if (res.ok) {
          setEditAdAccounts(res.data.customers || []);
          if (res.data.error) toast.error(`Google Ads: ${res.data.error}`);
        }
      }
    } catch { /* ignore */ }
    finally { setEditLoadingAccounts(false); }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (editForm.platform === "meta" && !editForm.productId) {
      toast.error("Meta ad campaigns must be tied to a product");
      return;
    }
    if (editForm.platform === "meta" && !metaObjectiveOptions.some((option) => option.value === editForm.objective)) {
      toast.error("Meta currently supports awareness, traffic, and engagement only");
      return;
    }
    setEditSaving(true);
    try {
      const res = await apiPut(`/api/ad-campaigns/${editingId}`, {
        name: editForm.name,
        objective: editForm.objective,
        dailyBudgetCents: editForm.dailyBudgetCents,
        startDate: new Date(editForm.startDate).toISOString(),
        endDate: editForm.endDate ? new Date(editForm.endDate).toISOString() : null,
        productId: editForm.productId,
        adAccountId: editForm.adAccountId || undefined,
        customerId: editForm.customerId || undefined,
        targeting: {
          ageMin: editForm.ageMin, ageMax: editForm.ageMax, gender: editForm.gender,
          locations: editForm.locations ? editForm.locations.split(",").map((s) => s.trim()).filter(Boolean) : [],
          interests: editForm.interests ? editForm.interests.split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
        creative: {
          headline: editForm.headline, primaryText: editForm.primaryText, description: editForm.description,
          imageUrl: editForm.imageUrl, videoUrl: editForm.videoUrl, linkUrl: editForm.linkUrl, ctaType: editForm.ctaType,
        },
      });
      if (res.ok) {
        toast.success("Campaign updated");
        setEditOpen(false);
        fetchCampaigns();
      } else {
        const d = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(d.issues?.[0]?.message || d.error || "Failed to update campaign");
      }
    } catch { toast.error("Failed to update campaign"); }
    finally { setEditSaving(false); }
  };

  const handleEditMediaUpload = async (file: File, mediaType: "image" | "video") => {
    const setter = mediaType === "video" ? setEditUploadingVideo : setEditUploadingImage;
    setter(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiUpload<{ ok: boolean; url: string; fileSize: number }>(
        "/api/ad-campaigns/upload-media", formData,
      );
      if (res.ok && res.data.url) {
        if (mediaType === "video") setEditForm((f) => ({ ...f, videoUrl: res.data.url }));
        else setEditForm((f) => ({ ...f, imageUrl: res.data.url }));
        toast.success(`${file.name} uploaded (${formatBytes(res.data.fileSize)})`);
      } else {
        toast.error("Upload failed");
      }
    } catch { toast.error("Failed to upload file"); }
    finally { setter(false); }
  };

  const handleAction = async (id: string, action: "launch" | "pause" | "resume" | "sync" | "delete") => {
    setActionLoading(id);
    try {
      if (action === "delete") {
        const res = await apiDelete(`/api/ad-campaigns/${id}`);
        if (res.ok) { toast.success("Campaign deleted"); fetchCampaigns(); }
        else toast.error((res.data as { error?: string }).error || "Delete failed");
        return;
      }
      const res = await apiPost(`/api/ad-campaigns/${id}/${action}`, {});
      const data = res.data as { ok?: boolean; error?: string };
      if (data.ok) {
        toast.success(action === "launch" ? "Campaign launched" : action === "pause" ? "Campaign paused" : action === "resume" ? "Campaign resumed" : "Metrics synced");
        fetchCampaigns();
      } else toast.error(data.error || `Failed to ${action} campaign`);
    } catch { toast.error(`Failed to ${action} campaign`); }
    finally { setActionLoading(null); }
  };

  const fetchAggregateInsights = async () => {
    setInsightsLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; insights: AggregateInsights }>("/api/ad-campaigns/insights");
      if (res.ok && res.data.insights) setAggregateInsights(res.data.insights);
      else toast.error("Failed to load insights");
    } catch { toast.error("Failed to load insights"); }
    finally { setInsightsLoading(false); }
  };

  const fetchCampaignInsights = async (id: string) => {
    setInsightLoadingId(id);
    try {
      const res = await apiGet<{ ok: boolean; insights: CampaignInsights }>(`/api/ad-campaigns/${id}/insights`);
      if (res.ok && res.data.insights) {
        setCampaignInsights((prev) => ({ ...prev, [id]: res.data.insights }));
      } else toast.error("Failed to load campaign insights");
    } catch { toast.error("Failed to load insights"); }
    finally { setInsightLoadingId(null); }
  };

  useEffect(() => {
    if (activeTab === "insights" && !aggregateInsights && !insightsLoading) {
      fetchAggregateInsights();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = platformFilter === "all" ? campaigns : campaigns.filter((c) => c.platform === platformFilter);
  const totalSpend = campaigns.reduce((s, c) => s + (c.metrics?.spend || 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + (c.metrics?.impressions || 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + (c.metrics?.clicks || 0), 0);
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  return (
    <AppShell>
      <PageHeader
        title="Ads"
        subtitle="Create, launch, and manage paid ad campaigns across Google and Meta."
        action={
          <Sheet open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm(); }}>
            <SheetTrigger asChild>
              <Button className="rounded-lg h-10 text-sm">New Campaign</Button>
            </SheetTrigger>
            <SheetContent className="sm:max-w-xl overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Create Ad Campaign</SheetTitle>
                <SheetDescription>
                  {formStep === 0 ? "Set up campaign basics" : formStep === 1 ? "Define your target audience" :
                   formStep === 2 ? "Upload creative assets" : "Review your ad"}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Smart Suggest loading */}
                {suggesting && (
                  <div className="rounded-lg border border-border/40 p-5 space-y-4">
                    <div>
                      <p className="text-sm font-medium">AI Research in Progress</p>
                      <p className="text-xs text-muted-foreground mt-1">Analyzing your market to craft the perfect ad...</p>
                    </div>
                    <div className="space-y-2">
                      {[
                        "Researching your product & competitors",
                        "Identifying user pain points",
                        "Crafting your optimized ad copy",
                      ].map((label, i) => (
                        <div key={i} className={`flex items-center gap-2.5 text-xs transition-opacity duration-500 ${
                          suggestStep >= i ? "opacity-100" : "opacity-30"
                        }`}>
                          {suggestStep > i ? (
                            <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 shrink-0" />
                          ) : suggestStep === i ? (
                            <div className="h-3.5 w-3.5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin shrink-0" />
                          ) : (
                            <span className="h-3.5 w-3.5 rounded-full bg-muted shrink-0" />
                          )}
                          <span className={suggestStep >= i ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step indicators */}
                <div className="flex gap-1 mb-4">
                  {["Basics", "Targeting", "Creative", "Preview"].map((label, i) => (
                    <button key={label} onClick={() => setFormStep(i)}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                        formStep === i ? "bg-foreground text-background" :
                        i < formStep ? "bg-foreground/10 text-foreground" :
                        "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >{label}</button>
                  ))}
                </div>

                {/* Step 0: Basics */}
                {formStep === 0 && (
                  <>
                    <FormField label="Platform">
                      <Select value={form.platform} onChange={(e) => {
                        const platform = e.target.value as "meta" | "google" | "tiktok";
                        setForm({ ...form, platform, objective: normalizeObjectiveForPlatform(platform, form.objective) });
                      }}>
                        <option value="meta">Meta (Facebook / Instagram)</option>
                        <option value="google">Google Ads</option>
                        <option value="tiktok">TikTok Ads</option>
                      </Select>
                    </FormField>
                    <FormField label="Product" description="Select a product so AI can research your market.">
                      <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                        <option value="">None</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </FormField>

                    {/* Smart Suggest */}
                    <button
                      type="button"
                      onClick={handleSmartSuggest}
                      disabled={suggesting || !form.productId}
                      className={`w-full rounded-lg border border-dashed p-4 text-left transition-all ${
                        form.productId
                          ? "border-foreground/30 hover:border-foreground hover:bg-foreground/5 cursor-pointer"
                          : "border-border/40 opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <p className="text-sm font-medium">
                        {suggesting ? "Researching your market..." : "Smart Suggest -- Let AI build this ad"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {form.productId
                          ? "AI will research competitors & pain points, then fill every field"
                          : "Select a product above to unlock AI ad generation"}
                      </p>
                    </button>

                    <div className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-border/40" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">or fill manually</span>
                      <div className="flex-1 h-px bg-border/40" />
                    </div>

                    <FormField label="Campaign Name">
                      <Input placeholder="Summer Sale Campaign" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </FormField>
                    <FormField
                      label="Objective"
                      description={form.platform === "meta" ? "Meta currently supports awareness, traffic, and engagement in this integration." : form.platform === "tiktok" ? "TikTok supports all objective types." : undefined}
                    >
                      <Select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}>
                        {getObjectiveOptions(form.platform).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Daily Budget">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">$</span>
                        <Input type="number" min="1" step="0.01" value={(form.dailyBudgetCents / 100).toFixed(2)}
                          onChange={(e) => setForm({ ...form, dailyBudgetCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                        />
                        <span className="text-sm text-muted-foreground">/ day</span>
                      </div>
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Start Date">
                        <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                      </FormField>
                      <FormField label="End Date" description="Optional">
                        <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                      </FormField>
                    </div>
                  </>
                )}

                {/* Step 1: Targeting */}
                {formStep === 1 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Min Age">
                        <Input type="number" min="13" max="65" value={form.ageMin} onChange={(e) => setForm({ ...form, ageMin: parseInt(e.target.value) || 18 })} />
                      </FormField>
                      <FormField label="Max Age">
                        <Input type="number" min="13" max="65" value={form.ageMax} onChange={(e) => setForm({ ...form, ageMax: parseInt(e.target.value) || 65 })} />
                      </FormField>
                    </div>
                    <FormField label="Gender">
                      <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                        <option value="all">All</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </Select>
                    </FormField>
                    <FormField label="Locations" description="Comma-separated country codes (e.g. US, GB, CA)">
                      <Input placeholder="US, GB" value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} />
                    </FormField>
                    <FormField label="Interests" description="Comma-separated interests for targeting">
                      <Input placeholder="Technology, Marketing, SaaS" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
                    </FormField>
                  </>
                )}

                {/* Step 2: Creative */}
                {formStep === 2 && (
                  <>
                    <FormField label="Headline" description={form.platform === "google" ? "Max 30 characters for Google RSA" : undefined}>
                      <Input placeholder="Your attention-grabbing headline" value={form.headline}
                        onChange={(e) => setForm({ ...form, headline: e.target.value })}
                      />
                      {form.platform === "google" && (
                        <p className={`text-[10px] mt-0.5 ${form.headline.length > 30 ? "text-destructive" : "text-muted-foreground"}`}>
                          {form.headline.length}/30 characters
                        </p>
                      )}
                    </FormField>
                    <FormField label="Primary Text">
                      <Textarea placeholder="The main body of your ad..." rows={3} value={form.primaryText}
                        onChange={(e) => setForm({ ...form, primaryText: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Description" description="Supporting text (optional)">
                      <Input placeholder="Additional details about your offer" value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                      />
                    </FormField>

                    <FormField label="Ad Image" description="Required for display ads">
                      <MediaUploadZone
                        type="image" url={form.imageUrl} uploading={uploadingImage}
                        onUpload={(f) => handleMediaUpload(f, "image")}
                        onRemove={() => setForm({ ...form, imageUrl: "" })}
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        platform={form.platform}
                      />
                    </FormField>

                    {form.platform === "meta" && (
                      <FormField label="Ad Video"
                        description="Video ads typically outperform static ads on Meta"
                      >
                        <MediaUploadZone
                          type="video" url={form.videoUrl} uploading={uploadingVideo}
                          onUpload={(f) => handleMediaUpload(f, "video")}
                          onRemove={() => setForm({ ...form, videoUrl: "" })}
                          accept="video/mp4,video/quicktime,video/webm"
                          platform={form.platform}
                        />
                      </FormField>
                    )}

                    <FormField label="Landing Page URL">
                      <Input placeholder="https://yoursite.com/offer" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} />
                    </FormField>
                    <FormField label="Call to Action">
                      <Select value={form.ctaType} onChange={(e) => setForm({ ...form, ctaType: e.target.value })}>
                        <option value="">Default</option>
                        <option value="LEARN_MORE">Learn More</option>
                        <option value="SHOP_NOW">Shop Now</option>
                        <option value="SIGN_UP">Sign Up</option>
                        <option value="DOWNLOAD">Download</option>
                        <option value="GET_QUOTE">Get Quote</option>
                        <option value="CONTACT_US">Contact Us</option>
                      </Select>
                    </FormField>
                  </>
                )}

                {/* Step 3: Preview */}
                {formStep === 3 && (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">Review how your ad will appear:</p>
                    <AdPreview form={form} />

                    <div className="mt-6 space-y-3">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campaign Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {[
                          { label: "Platform", value: platformLabels[form.platform] },
                          { label: "Objective", value: objectiveLabels[form.objective] },
                          { label: "Daily Budget", value: formatCurrency(form.dailyBudgetCents) },
                          { label: "Start Date", value: form.startDate },
                        ].map((item) => (
                          <div key={item.label} className="rounded-lg border border-border/30 px-3 py-2.5">
                            <p className="text-[10px] text-muted-foreground">{item.label}</p>
                            <p className="font-medium mt-0.5">{item.value}</p>
                          </div>
                        ))}
                      </div>
                      {!form.imageUrl && !form.videoUrl && form.platform !== "google" && (
                        <p className="text-xs text-amber-600 p-3 rounded-lg border border-amber-200/50">
                          No media uploaded. Ads with images or video perform significantly better.
                        </p>
                      )}
                    </div>

                    {/* AI Rationale */}
                    {suggestRationale && (
                      <div className="mt-6 space-y-4 rounded-lg border border-border/40 p-5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI Research Rationale</p>
                          <button
                            type="button"
                            onClick={() => setSuggestRationale(null)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Dismiss
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{suggestRationale.summary}</p>
                        {suggestRationale.painPoints?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Pain Points Targeted</p>
                            <ul className="space-y-1.5">
                              {suggestRationale.painPoints.map((p, i) => (
                                <li key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-amber-400/50">{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {suggestRationale.competitorInsights?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Competitor Insights</p>
                            <ul className="space-y-1.5">
                              {suggestRationale.competitorInsights.map((c, i) => (
                                <li key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-blue-400/50">{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-xs font-medium p-3 rounded-lg bg-foreground/5">{suggestRationale.whyThisAd}</p>
                        <button
                          type="button"
                          onClick={() => setFormStep(2)}
                          className="text-xs font-medium text-foreground hover:underline"
                        >
                          Edit creative assets
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <SheetFooter className="gap-2">
                {formStep > 0 && <Button variant="outline" onClick={() => setFormStep(formStep - 1)}>Back</Button>}
                {formStep < 3 ? (
                  <Button onClick={() => setFormStep(formStep + 1)}>Next</Button>
                ) : (
                  <SheetClose asChild>
                    <Button onClick={handleCreate} disabled={saving || !form.name || !form.headline || !form.primaryText}>
                      {saving ? "Creating..." : "Create Campaign"}
                    </Button>
                  </SheetClose>
                )}
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      {/* Summary metrics */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
          <MetricCard label="Active Campaigns" value={String(activeCampaigns)} />
          <MetricCard label="Total Impressions" value={totalImpressions.toLocaleString()} />
          <MetricCard label="Total Clicks" value={totalClicks.toLocaleString()} />
          <MetricCard label="Total Spend" value={formatCurrency(totalSpend)} />
        </div>
      )}

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Mobile: dropdown */}
        <div className="sm:hidden mb-8">
          <Select value={activeTab} onChange={(e) => setActiveTab(e.target.value as typeof activeTab)}>
            <option value="campaigns">Campaigns</option>
            <option value="insights">Performance Insights</option>
          </Select>
        </div>

        {/* Desktop: tab bar */}
        <TabsList className="hidden sm:flex bg-transparent border-b border-border/40 rounded-none p-0 h-auto gap-0 mb-8 w-full">
          {[
            { value: "campaigns", label: "Campaigns" },
            { value: "insights", label: "Performance Insights" },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 text-sm font-medium tracking-wide uppercase text-muted-foreground data-[state=active]:text-foreground transition-colors whitespace-nowrap"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Campaigns Tab ── */}
        <TabsContent value="campaigns">
          {/* Platform filter */}
          <div className="flex gap-1 mb-6">
            {["all", "meta", "google", "tiktok"].map((v) => (
              <button key={v} onClick={() => setPlatformFilter(v)}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                  platformFilter === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >{v === "all" ? "All" : platformLabels[v]}</button>
            ))}
          </div>

          <div className="space-y-4">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="h-32 rounded-lg bg-muted/20 animate-pulse" />)
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 border border-border/40 rounded-lg">
                <p className="text-sm font-medium">No ad campaigns yet</p>
                <p className="text-xs text-muted-foreground mt-2">Create your first campaign to start advertising.</p>
              </div>
            ) : filtered.map((c) => (
              <div key={c.id} className="border border-border/40 rounded-lg p-5 sm:p-6 hover:border-border transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Creative thumbnail */}
                    {c.creative?.imageUrl && (
                      <div className="h-12 w-12 rounded-lg overflow-hidden border border-border/40 shrink-0 hidden sm:block">
                        <img src={c.creative.imageUrl} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-base font-medium truncate">{c.name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <span>{platformLabels[c.platform]}</span>
                        <span className="w-px h-3 bg-border hidden sm:block" />
                        <span>{objectiveLabels[c.objective]}</span>
                        <span className="w-px h-3 bg-border hidden sm:block" />
                        <span>{formatCurrency(c.dailyBudgetCents)}/day</span>
                      </div>
                    </div>
                  </div>
                  <span className={`text-[11px] uppercase tracking-wider font-medium shrink-0 ${statusColors[c.status] || "text-muted-foreground"}`}>
                    {c.status}
                  </span>
                </div>

                {c.errorMessage && c.status === "failed" && (
                  <p className="text-xs text-destructive mb-3 p-3 rounded-lg bg-destructive/5">{c.errorMessage}</p>
                )}

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground min-w-0">
                    {c.creative?.headline && (
                      <span className="text-foreground/80 truncate max-w-full sm:max-w-[250px]">&ldquo;{c.creative.headline}&rdquo;</span>
                    )}
                    {c.createdAt && <span className="text-[11px] shrink-0">Created {new Date(c.createdAt).toLocaleDateString()}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.status === "draft" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>
                        Launch
                      </Button>
                    )}
                    {c.status === "failed" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>
                        Retry
                      </Button>
                    )}
                    {c.status === "active" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "pause")} disabled={actionLoading === c.id}>
                        Pause
                      </Button>
                    )}
                    {c.status === "paused" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "resume")} disabled={actionLoading === c.id}>
                        Resume
                      </Button>
                    )}
                    {c.externalCampaignId && (
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "sync")} disabled={actionLoading === c.id}>
                        {actionLoading === c.id ? "Syncing..." : "Sync"}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setDetailCampaign(c); if (!campaignInsights[c.id]) fetchCampaignInsights(c.id); }}>
                      Insights
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => openEdit(c)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => handleAction(c.id, "delete")} disabled={actionLoading === c.id}>
                      Delete
                    </Button>
                  </div>
                </div>

                {c.metrics && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-border/30">
                    <MetricCard label="Impressions" value={c.metrics.impressions.toLocaleString()} />
                    <MetricCard label="Clicks" value={c.metrics.clicks.toLocaleString()} />
                    <MetricCard label="CTR" value={`${(c.metrics.ctr * 100).toFixed(2)}%`} />
                    <MetricCard label="Spend" value={formatCurrency(c.metrics.spend)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Insights Tab ── */}
        <TabsContent value="insights">
          {insightsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg bg-muted/20 animate-pulse" />)}
            </div>
          ) : !aggregateInsights ? (
            <div className="text-center py-20 border border-border/40 rounded-lg">
              <p className="text-sm font-medium">No insights available</p>
              <p className="text-xs text-muted-foreground mt-2">Create campaigns and posts to get AI-powered performance analysis.</p>
              <Button className="mt-4" variant="outline" onClick={fetchAggregateInsights}>Generate Insights</Button>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Health score */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-6 rounded-lg border border-border/40">
                <ScoreRing score={aggregateInsights.healthScore} size={72} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-medium">Marketing Health Score</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{aggregateInsights.summary}</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAggregateInsights} className="shrink-0 text-xs">
                  Refresh
                </Button>
              </div>

              {/* Top performer / Underperformer */}
              <div className="grid md:grid-cols-2 gap-4">
                {aggregateInsights.topPerformer && (
                  <div className="p-5 rounded-lg border border-emerald-200/50 bg-emerald-50/20 dark:bg-emerald-950/10 space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Top Performer</p>
                    <p className="text-sm font-medium">{aggregateInsights.topPerformer.name}</p>
                    <p className="text-xs text-muted-foreground">{aggregateInsights.topPerformer.reason}</p>
                  </div>
                )}
                {aggregateInsights.underperformer && (
                  <div className="p-5 rounded-lg border border-amber-200/50 bg-amber-50/20 dark:bg-amber-950/10 space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">Needs Attention</p>
                    <p className="text-sm font-medium">{aggregateInsights.underperformer.name}</p>
                    <p className="text-xs text-muted-foreground">{aggregateInsights.underperformer.reason}</p>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{aggregateInsights.underperformer.fix}</p>
                  </div>
                )}
              </div>

              {/* Recommendations */}
              {aggregateInsights.recommendations?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recommendations</h4>
                  {aggregateInsights.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-lg border border-border/40">
                      <span className={`text-[10px] uppercase tracking-wider font-medium shrink-0 mt-0.5 ${
                        rec.priority === "high" ? "text-destructive" : rec.priority === "medium" ? "text-amber-600" : "text-blue-600"
                      }`}>{rec.priority}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{rec.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rec.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Platform insights */}
              {aggregateInsights.platformInsights && aggregateInsights.platformInsights.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Platform Breakdown</h4>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {aggregateInsights.platformInsights.map((pi, i) => (
                      <div key={i} className="p-4 rounded-lg border border-border/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium capitalize">{pi.platform}</p>
                          <span className={`text-[10px] uppercase tracking-wider font-medium ${
                            pi.verdict === "strong" ? "text-emerald-600" : pi.verdict === "average" ? "text-amber-600" : pi.verdict === "weak" ? "text-destructive" : "text-muted-foreground"
                          }`}>{pi.verdict}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{pi.tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Budget advice + Next steps */}
              <div className="grid md:grid-cols-2 gap-4">
                {aggregateInsights.budgetAdvice && (
                  <div className="p-5 rounded-lg border border-border/40 space-y-2">
                    <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Budget Advice</h4>
                    <p className="text-sm text-muted-foreground">{aggregateInsights.budgetAdvice}</p>
                  </div>
                )}
                {aggregateInsights.nextSteps && aggregateInsights.nextSteps.length > 0 && (
                  <div className="p-5 rounded-lg border border-border/40 space-y-3">
                    <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next Steps</h4>
                    <ol className="space-y-2">
                      {aggregateInsights.nextSteps.map((step, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          <span className="text-xs font-medium text-muted-foreground tabular-nums mt-0.5">{i + 1}.</span>
                          <span className="text-muted-foreground">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              {aggregateInsights.contentTips && aggregateInsights.contentTips.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Content Tips</h4>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {aggregateInsights.contentTips.map((tip, i) => (
                      <div key={i} className="p-4 rounded-lg border border-border/40">
                        <p className="text-xs text-muted-foreground">{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Edit Campaign Sheet ── */}
      <Sheet open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditingId(null); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Campaign</SheetTitle>
            <SheetDescription>
              {editFormStep === 0 ? "Update campaign basics" : editFormStep === 1 ? "Adjust targeting" :
               editFormStep === 2 ? "Replace creative assets" : "Review your changes"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {campaigns.find((c) => c.id === editingId)?.status === "active" && (
              <p className="text-xs text-amber-600 p-3 rounded-lg border border-amber-200/50">
                This campaign is live. Changes saved here won&apos;t update the live ad until you pause and relaunch it.
              </p>
            )}

            {/* Step indicators */}
            <div className="flex gap-1 mb-4">
              {["Basics", "Targeting", "Creative", "Preview"].map((label, i) => (
                <button key={label} onClick={() => setEditFormStep(i)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    editFormStep === i ? "bg-foreground text-background" :
                    i < editFormStep ? "bg-foreground/10 text-foreground" :
                    "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* Step 0: Basics */}
            {editFormStep === 0 && (
              <>
                <FormField label="Platform">
                  <Select value={editForm.platform} onChange={(e) => {
                    const platform = e.target.value as "meta" | "google" | "tiktok";
                    setEditForm({ ...editForm, platform, objective: normalizeObjectiveForPlatform(platform, editForm.objective) });
                  }}>
                    <option value="meta">Meta (Facebook / Instagram)</option>
                    <option value="google">Google Ads</option>
                  </Select>
                </FormField>
                <FormField label="Product">
                  <Select value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })}>
                    <option value="">None</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </FormField>
                <FormField
                  label={editForm.platform === "meta" ? "Ad Account" : editForm.platform === "tiktok" ? "TikTok Advertiser ID" : "Google Ads Customer"}
                  description={editLoadingAccounts ? "Loading accounts..." : editAdAccounts.length === 0 ? "No accounts found -- connect integration first" : undefined}
                >
                  <Select
                    value={editForm.platform === "meta" ? editForm.adAccountId : editForm.customerId}
                    onChange={(e) => {
                      if (editForm.platform === "meta") setEditForm({ ...editForm, adAccountId: e.target.value });
                      else setEditForm({ ...editForm, customerId: e.target.value });
                    }}
                    disabled={editLoadingAccounts || editAdAccounts.length === 0}
                  >
                    <option value="">Use product default</option>
                    {editAdAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                  </Select>
                </FormField>
                <FormField label="Campaign Name">
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </FormField>
                <FormField
                  label="Objective"
                  description={editForm.platform === "meta" ? "Meta currently supports awareness, traffic, and engagement in this integration." : undefined}
                >
                  <Select value={editForm.objective} onChange={(e) => setEditForm({ ...editForm, objective: e.target.value })}>
                    {getObjectiveOptions(editForm.platform).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Daily Budget">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input type="number" min="1" step="0.01" value={(editForm.dailyBudgetCents / 100).toFixed(2)}
                      onChange={(e) => setEditForm({ ...editForm, dailyBudgetCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                    />
                    <span className="text-sm text-muted-foreground">/ day</span>
                  </div>
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Start Date">
                    <Input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                  </FormField>
                  <FormField label="End Date" description="Optional">
                    <Input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                  </FormField>
                </div>
              </>
            )}

            {/* Step 1: Targeting */}
            {editFormStep === 1 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Min Age">
                    <Input type="number" min="13" max="65" value={editForm.ageMin} onChange={(e) => setEditForm({ ...editForm, ageMin: parseInt(e.target.value) || 18 })} />
                  </FormField>
                  <FormField label="Max Age">
                    <Input type="number" min="13" max="65" value={editForm.ageMax} onChange={(e) => setEditForm({ ...editForm, ageMax: parseInt(e.target.value) || 65 })} />
                  </FormField>
                </div>
                <FormField label="Gender">
                  <Select value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                    <option value="all">All</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </Select>
                </FormField>
                <FormField label="Locations" description="Comma-separated country codes (e.g. US, GB, CA)">
                  <Input value={editForm.locations} onChange={(e) => setEditForm({ ...editForm, locations: e.target.value })} />
                </FormField>
                <FormField label="Interests" description="Comma-separated interests for targeting">
                  <Input value={editForm.interests} onChange={(e) => setEditForm({ ...editForm, interests: e.target.value })} />
                </FormField>
              </>
            )}

            {/* Step 2: Creative */}
            {editFormStep === 2 && (
              <>
                <FormField label="Headline" description={editForm.platform === "google" ? "Max 30 characters for Google RSA" : undefined}>
                  <Input value={editForm.headline} onChange={(e) => setEditForm({ ...editForm, headline: e.target.value })} />
                  {editForm.platform === "google" && (
                    <p className={`text-[10px] mt-0.5 ${editForm.headline.length > 30 ? "text-destructive" : "text-muted-foreground"}`}>
                      {editForm.headline.length}/30 characters
                    </p>
                  )}
                </FormField>
                <FormField label="Primary Text">
                  <Textarea rows={3} value={editForm.primaryText} onChange={(e) => setEditForm({ ...editForm, primaryText: e.target.value })} />
                </FormField>
                <FormField label="Description" description="Optional">
                  <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                </FormField>
                <FormField label="Ad Image">
                  <MediaUploadZone
                    type="image" url={editForm.imageUrl} uploading={editUploadingImage}
                    onUpload={(f) => handleEditMediaUpload(f, "image")}
                    onRemove={() => setEditForm({ ...editForm, imageUrl: "" })}
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    platform={editForm.platform}
                  />
                </FormField>
                {editForm.platform === "meta" && (
                  <FormField label="Ad Video">
                    <MediaUploadZone
                      type="video" url={editForm.videoUrl} uploading={editUploadingVideo}
                      onUpload={(f) => handleEditMediaUpload(f, "video")}
                      onRemove={() => setEditForm({ ...editForm, videoUrl: "" })}
                      accept="video/mp4,video/quicktime,video/webm"
                      platform={editForm.platform}
                    />
                  </FormField>
                )}
                <FormField label="Landing Page URL">
                  <Input value={editForm.linkUrl} onChange={(e) => setEditForm({ ...editForm, linkUrl: e.target.value })} />
                </FormField>
                <FormField label="Call to Action">
                  <Select value={editForm.ctaType} onChange={(e) => setEditForm({ ...editForm, ctaType: e.target.value })}>
                    <option value="">Default</option>
                    <option value="LEARN_MORE">Learn More</option>
                    <option value="SHOP_NOW">Shop Now</option>
                    <option value="SIGN_UP">Sign Up</option>
                    <option value="DOWNLOAD">Download</option>
                    <option value="GET_QUOTE">Get Quote</option>
                    <option value="CONTACT_US">Contact Us</option>
                  </Select>
                </FormField>
              </>
            )}

            {/* Step 3: Preview */}
            {editFormStep === 3 && (
              <>
                <p className="text-xs text-muted-foreground mb-3">Review how your updated ad will appear:</p>
                <AdPreview form={editForm} />
                <div className="mt-6 space-y-3">
                  <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Campaign Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      { label: "Platform", value: platformLabels[editForm.platform] },
                      { label: "Objective", value: objectiveLabels[editForm.objective] },
                      { label: "Daily Budget", value: formatCurrency(editForm.dailyBudgetCents) },
                      { label: "Start Date", value: editForm.startDate },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-border/30 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground">{item.label}</p>
                        <p className="font-medium mt-0.5">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <SheetFooter className="gap-2">
            {editFormStep > 0 && <Button variant="outline" onClick={() => setEditFormStep(editFormStep - 1)}>Back</Button>}
            {editFormStep < 3 ? (
              <Button onClick={() => setEditFormStep(editFormStep + 1)}>Next</Button>
            ) : (
              <Button onClick={handleUpdate} disabled={editSaving || !editForm.name || !editForm.headline}>
                {editSaving ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Campaign Detail / Insights Dialog ── */}
      <Dialog open={!!detailCampaign} onOpenChange={(open) => { if (!open) setDetailCampaign(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto w-[calc(100%-2rem)] rounded-lg">
          {detailCampaign && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  {detailCampaign.name}
                  <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">{platformLabels[detailCampaign.platform]}</span>
                </DialogTitle>
                <DialogDescription>Campaign performance analysis and improvement suggestions</DialogDescription>
              </DialogHeader>

              {/* Creative preview */}
              {(detailCampaign.creative.imageUrl || detailCampaign.creative.videoUrl) && (
                <div className="rounded-lg overflow-hidden border border-border/40">
                  {detailCampaign.creative.videoUrl ? (
                    <video src={detailCampaign.creative.videoUrl} controls className="w-full aspect-video object-cover" />
                  ) : (
                    <img src={detailCampaign.creative.imageUrl} alt="Ad creative" className="w-full aspect-video object-cover" />
                  )}
                </div>
              )}

              {/* Metrics */}
              {detailCampaign.metrics && (
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="Impressions" value={detailCampaign.metrics.impressions.toLocaleString()} />
                  <MetricCard label="Clicks" value={detailCampaign.metrics.clicks.toLocaleString()} />
                  <MetricCard label="CTR" value={`${(detailCampaign.metrics.ctr * 100).toFixed(2)}%`} />
                  <MetricCard label="Spend" value={formatCurrency(detailCampaign.metrics.spend)} />
                </div>
              )}

              {/* AI Insights */}
              {insightLoadingId === detailCampaign.id ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Analyzing campaign...</span>
                </div>
              ) : campaignInsights[detailCampaign.id] ? (
                <div className="space-y-5">
                  {/* Score */}
                  <div className="flex items-center gap-4 p-5 rounded-lg border border-border/40">
                    <ScoreRing score={campaignInsights[detailCampaign.id].overallScore} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{campaignInsights[detailCampaign.id].scoreLabel}</p>
                      <p className="text-xs text-muted-foreground mt-1">{campaignInsights[detailCampaign.id].summary}</p>
                    </div>
                  </div>

                  {/* Sub-scores */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Creative", score: campaignInsights[detailCampaign.id].creativeScore },
                      { label: "Targeting", score: campaignInsights[detailCampaign.id].targetingScore },
                      { label: "Budget", score: campaignInsights[detailCampaign.id].budgetScore },
                    ].map(({ label, score }) => (
                      <div key={label} className="flex items-center gap-3 p-3 rounded-lg border border-border/40">
                        <ScoreRing score={score} size={40} />
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                          <p className="text-xs font-medium">{score}/100</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Strengths */}
                  {campaignInsights[detailCampaign.id].strengths?.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 mb-2">Strengths</p>
                      <ul className="space-y-1.5">
                        {campaignInsights[detailCampaign.id].strengths.map((s, i) => (
                          <li key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-emerald-400/50">{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Improvements */}
                  {campaignInsights[detailCampaign.id].improvements?.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-amber-700 mb-2">Areas for Improvement</p>
                      <div className="space-y-2">
                        {campaignInsights[detailCampaign.id].improvements.map((imp, i) => (
                          <div key={i} className="p-3 rounded-lg border border-border/40">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
                              <span className={`text-[10px] uppercase tracking-wider font-medium shrink-0 ${
                                imp.impact === "high" ? "text-destructive" : imp.impact === "medium" ? "text-amber-600" : "text-blue-600"
                              }`}>{imp.impact}</span>
                              <p className="text-xs font-medium min-w-0">{imp.area}: {imp.issue}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{imp.suggestion}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Wins */}
                  {campaignInsights[detailCampaign.id].quickWins?.length > 0 && (
                    <div className="p-4 rounded-lg border border-border/40 bg-foreground/[0.02]">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">Quick Wins</p>
                      <ol className="space-y-2">
                        {campaignInsights[detailCampaign.id].quickWins.map((qw, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-3">
                            <span className="text-[10px] font-medium text-muted-foreground tabular-nums mt-0.5">{i + 1}.</span>
                            {qw}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Benchmarks */}
                  {campaignInsights[detailCampaign.id].benchmarks && (
                    <div className="p-4 rounded-lg border border-border/40 text-xs space-y-1">
                      <p className="font-medium">Industry Benchmarks</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                        <span>CTR: {campaignInsights[detailCampaign.id].benchmarks!.ctrBenchmark}</span>
                        <span>CPC: {campaignInsights[detailCampaign.id].benchmarks!.cpcBenchmark}</span>
                        <span>Verdict: <span className="font-medium text-foreground capitalize">{campaignInsights[detailCampaign.id].benchmarks!.verdict}</span></span>
                      </div>
                    </div>
                  )}

                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => fetchCampaignInsights(detailCampaign.id)}>
                    Re-analyze
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">Failed to load insights</p>
                  <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => fetchCampaignInsights(detailCampaign.id)}>
                    Try Again
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
