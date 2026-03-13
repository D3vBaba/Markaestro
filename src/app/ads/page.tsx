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
import {
  Megaphone, Trash2, Play, Pause, RefreshCw, Plus,
  TrendingUp, Eye, MousePointerClick, DollarSign,
  Upload, Image as ImageIcon, Video, X, Loader2,
  Lightbulb, Target, Palette, Sparkles, ArrowUpRight,
  AlertTriangle, CheckCircle2, ChevronRight, Wand2,
  Search, BarChart2, Pencil,
} from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import type { AdCampaignMetrics } from "@/lib/ads/types";

// ── Types ────────────────────────────────────────────────────────────

type AdCampaign = {
  id: string;
  name: string;
  platform: "meta" | "google";
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
  draft: "bg-gray-100 text-gray-700",
  pending: "bg-yellow-50 text-yellow-700",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  failed: "bg-rose-50 text-rose-700",
};
const platformLabels: Record<string, string> = { meta: "Meta", google: "Google" };
const platformColors: Record<string, string> = {
  meta: "bg-blue-50 text-blue-700", google: "bg-red-50 text-red-700",
};
const objectiveLabels: Record<string, string> = {
  awareness: "Awareness", traffic: "Traffic", engagement: "Engagement",
  leads: "Leads", conversions: "Conversions", app_installs: "App Installs",
};

function formatCurrency(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Subcomponents ────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </div>
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
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={3} className="text-muted/30" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} className="transition-all duration-700"
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fill={color} fontSize={size * 0.28} fontWeight={700}>
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
      <div className="relative group rounded-xl overflow-hidden border border-border/50 bg-black/5 dark:bg-white/5">
        {type === "image" ? (
          <img src={url} alt="Ad creative" className="w-full aspect-video object-cover" />
        ) : (
          <video src={url} controls className="w-full aspect-video object-cover" />
        )}
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-medium uppercase opacity-0 group-hover:opacity-100 transition-opacity">
          {type}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
        dragOver ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/50 hover:bg-muted/20"
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
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Uploading...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
            {type === "video" ? <Video className="h-5 w-5 text-muted-foreground" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div>
            <p className="text-sm font-medium">
              {dragOver ? "Drop file here" : `Upload ${type === "video" ? "Video" : "Image"}`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Drag & drop or click to browse
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
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

  const ctaLabels: Record<string, string> = {
    LEARN_MORE: "Learn More", SHOP_NOW: "Shop Now", SIGN_UP: "Sign Up",
    DOWNLOAD: "Download", GET_QUOTE: "Get Quote", CONTACT_US: "Contact Us",
  };

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-card">
      <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
        <div className="h-5 w-5 rounded-full bg-muted" />
        <span className="text-[11px] font-medium text-muted-foreground">Ad Preview - {platformLabels[form.platform]}</span>
        <Badge variant="outline" className="ml-auto text-[9px] h-4 border-border/50">Sponsored</Badge>
      </div>

      {form.primaryText && form.platform !== "google" && (
        <div className="px-3 py-2">
          <p className="text-xs leading-relaxed line-clamp-3">{form.primaryText}</p>
        </div>
      )}

      {form.videoUrl ? (
        <video src={form.videoUrl} className="w-full aspect-video object-cover bg-black/5" controls />
      ) : form.imageUrl ? (
        <img src={form.imageUrl} alt="Ad" className="w-full aspect-video object-cover bg-black/5" />
      ) : (
        <div className="w-full aspect-video bg-muted/30 flex items-center justify-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
        </div>
      )}

      <div className="px-3 py-2 space-y-1">
        {form.linkUrl && (
          <p className="text-[10px] text-muted-foreground uppercase truncate">{form.linkUrl.replace(/^https?:\/\//, "")}</p>
        )}
        {form.headline && (
          <p className="text-sm font-semibold leading-snug line-clamp-2">{form.headline}</p>
        )}
        {form.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">{form.description}</p>
        )}
        {form.ctaType && (
          <div className="pt-1">
            <span className="inline-block px-3 py-1 text-[11px] font-medium rounded-md bg-primary/10 text-primary">
              {ctaLabels[form.ctaType] || form.ctaType}
            </span>
          </div>
        )}
      </div>
    </div>
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

  // Media upload state
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // Smart Suggest state
  const [suggesting, setSuggesting] = useState(false);
  const [suggestStep, setSuggestStep] = useState(0);
  const [suggestRationale, setSuggestRationale] = useState<{
    summary: string; painPoints: string[]; competitorInsights: string[]; whyThisAd: string;
  } | null>(null);

  // Insights state
  const [aggregateInsights, setAggregateInsights] = useState<AggregateInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [campaignInsights, setCampaignInsights] = useState<Record<string, CampaignInsights>>({});
  const [insightLoadingId, setInsightLoadingId] = useState<string | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<AdCampaign | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormStep, setEditFormStep] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editUploadingImage, setEditUploadingImage] = useState(false);
  const [editUploadingVideo, setEditUploadingVideo] = useState(false);
  const [editAdAccounts, setEditAdAccounts] = useState<{ id: string; name: string }[]>([]);
  const [editLoadingAccounts, setEditLoadingAccounts] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", platform: "meta" as "meta" | "google",
    objective: "traffic", dailyBudgetCents: 1000,
    startDate: "", endDate: "", productId: "",
    adAccountId: "", customerId: "",
    ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "",
    headline: "", primaryText: "", description: "",
    imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
  });

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", platform: "meta" as "meta" | "google",
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

  // ── Media upload handlers ──

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

  // ── Smart Suggest ──

  const handleSmartSuggest = async () => {
    if (!form.productId) {
      toast.error("Select a product first so AI can research your app");
      return;
    }
    setSuggesting(true);
    setSuggestRationale(null);
    setSuggestStep(0);

    // Animate steps while waiting
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
        toast.error(res.data.error || "AI research failed — try again");
        return;
      }

      const s = res.data.suggestion;
      setSuggestRationale(s.rationale);
      setForm((f) => ({
        ...f,
        name: s.name || f.name,
        objective: s.objective || f.objective,
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
      setFormStep(3); // Jump to preview
      toast.success("AI researched your market and crafted an ad — review it below");
    } catch {
      toast.error("AI research failed — try again");
    } finally {
      setSuggesting(false);
      setSuggestStep(0);
    }
  };

  // ── Campaign CRUD ──

  const handleCreate = async () => {
    setSaving(true);
    try {
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
      objective: c.objective,
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
    // Fetch ad accounts for this platform
    setEditLoadingAccounts(true);
    try {
      if (c.platform === "meta") {
        const qs = c.productId ? `?productId=${c.productId}` : "";
        const res = await apiGet<{ adAccounts: { id: string; name: string }[] }>(`/api/integrations/meta/ad-accounts${qs}`);
        if (res.ok) setEditAdAccounts(res.data.adAccounts || []);
      } else {
        const res = await apiGet<{ customers: { id: string; name: string }[] }>("/api/integrations/google/customers");
        if (res.ok) setEditAdAccounts(res.data.customers || []);
      }
    } catch { /* ignore */ }
    finally { setEditLoadingAccounts(false); }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
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

  // ── Insights ──

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

  // ── Render ──

  return (
    <AppShell>
      <PageHeader
        title="Ads"
        subtitle="Create, launch, and manage paid ad campaigns across Google and Meta."
        action={
          <Sheet open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm(); }}>
            <SheetTrigger asChild>
              <Button className="rounded-xl"><Plus className="h-4 w-4 mr-2" />New Ad Campaign</Button>
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
                {/* Smart Suggest loading overlay */}
                {suggesting && (
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Wand2 className="h-4.5 w-4.5 text-primary animate-pulse" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">AI Research in Progress</p>
                        <p className="text-xs text-muted-foreground">Analyzing your market to craft the perfect ad...</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {[
                        { icon: Search, label: "Researching your product & competitors" },
                        { icon: BarChart2, label: "Identifying user pain points" },
                        { icon: Wand2, label: "Crafting your optimized ad copy" },
                      ].map(({ icon: Icon, label }, i) => (
                        <div key={i} className={`flex items-center gap-2.5 text-xs transition-opacity duration-500 ${
                          suggestStep >= i ? "opacity-100" : "opacity-30"
                        }`}>
                          {suggestStep > i ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          ) : suggestStep === i ? (
                            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                          ) : (
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className={suggestStep >= i ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step indicators */}
                <div className="flex gap-1.5 mb-4">
                  {["Basics", "Targeting", "Creative", "Preview"].map((label, i) => (
                    <button key={label} onClick={() => setFormStep(i)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        formStep === i ? "bg-primary text-primary-foreground" :
                        i < formStep ? "bg-primary/15 text-primary" :
                        "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >{label}</button>
                  ))}
                </div>

                {/* Step 0: Basics */}
                {formStep === 0 && (
                  <>
                    <FormField label="Platform">
                      <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as "meta" | "google" })}>
                        <option value="meta">Meta (Facebook / Instagram)</option>
                        <option value="google">Google Ads</option>
                      </Select>
                    </FormField>
                    <FormField label="Product" description="Select a product so AI can research your market.">
                      <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                        <option value="">None</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </FormField>

                    {/* Smart Suggest CTA */}
                    <button
                      type="button"
                      onClick={handleSmartSuggest}
                      disabled={suggesting || !form.productId}
                      className={`w-full rounded-xl border-2 border-dashed p-4 text-left transition-all group ${
                        form.productId
                          ? "border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary cursor-pointer"
                          : "border-border/40 bg-muted/20 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center shrink-0 transition-colors">
                          <Wand2 className={`h-5 w-5 text-primary ${suggesting ? "animate-pulse" : ""}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">
                            {suggesting ? "Researching your market..." : "Smart Suggest — Let AI build this ad"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {form.productId
                              ? "AI will research competitors & pain points, then fill every field"
                              : "Select a product above to unlock AI ad generation"}
                          </p>
                        </div>
                        {form.productId && !suggesting && (
                          <Sparkles className="h-4 w-4 text-primary shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-border/40" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">or fill manually</span>
                      <div className="flex-1 h-px bg-border/40" />
                    </div>

                    <FormField label="Campaign Name">
                      <Input placeholder="Summer Sale Campaign" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </FormField>
                    <FormField label="Objective">
                      <Select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}>
                        <option value="awareness">Awareness</option>
                        <option value="traffic">Traffic</option>
                        <option value="engagement">Engagement</option>
                        <option value="leads">Lead Generation</option>
                        <option value="conversions">Conversions</option>
                        <option value="app_installs">App Installs</option>
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

                {/* Step 2: Creative (with uploads) */}
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

                    {/* Image Upload */}
                    <FormField label="Ad Image" description="Required for display ads">
                      <MediaUploadZone
                        type="image" url={form.imageUrl} uploading={uploadingImage}
                        onUpload={(f) => handleMediaUpload(f, "image")}
                        onRemove={() => setForm({ ...form, imageUrl: "" })}
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        platform={form.platform}
                      />
                    </FormField>

                    {/* Video Upload (Meta) */}
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
                    <p className="text-sm text-muted-foreground mb-2">Review how your ad will appear:</p>
                    <AdPreview form={form} />

                    <div className="mt-4 space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-muted/30 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground">Platform</p>
                          <p className="font-medium">{platformLabels[form.platform]}</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground">Objective</p>
                          <p className="font-medium">{objectiveLabels[form.objective]}</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground">Daily Budget</p>
                          <p className="font-medium">{formatCurrency(form.dailyBudgetCents)}</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground">Start Date</p>
                          <p className="font-medium">{form.startDate}</p>
                        </div>
                      </div>
                      {!form.imageUrl && !form.videoUrl && form.platform !== "google" && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>No media uploaded. Ads with images or video perform significantly better.</span>
                        </div>
                      )}
                    </div>

                    {/* AI Rationale */}
                    {suggestRationale && (
                      <div className="mt-4 space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-center gap-2">
                          <Wand2 className="h-4 w-4 text-primary shrink-0" />
                          <p className="text-xs font-semibold text-primary">AI Research Rationale</p>
                          <button
                            type="button"
                            onClick={() => setSuggestRationale(null)}
                            className="ml-auto text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{suggestRationale.summary}</p>
                        {suggestRationale.painPoints?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Pain Points Targeted</p>
                            <ul className="space-y-1">
                              {suggestRationale.painPoints.map((p, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />{p}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {suggestRationale.competitorInsights?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Competitor Insights</p>
                            <ul className="space-y-1">
                              {suggestRationale.competitorInsights.map((c, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <BarChart2 className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />{c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-primary/10">
                          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                          <p className="text-xs text-primary font-medium">{suggestRationale.whyThisAd}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormStep(2)}
                          className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                        >
                          <Pencil className="h-3 w-3" />Edit creative assets
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <MetricCard icon={Megaphone} label="Active Campaigns" value={String(activeCampaigns)} />
          <MetricCard icon={Eye} label="Total Impressions" value={totalImpressions.toLocaleString()} />
          <MetricCard icon={MousePointerClick} label="Total Clicks" value={totalClicks.toLocaleString()} />
          <MetricCard icon={DollarSign} label="Total Spend" value={formatCurrency(totalSpend)} />
        </div>
      )}

      {/* Main tabs: Campaigns | Insights */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="insights">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Performance Insights
          </TabsTrigger>
        </TabsList>

        {/* ── Campaigns Tab ── */}
        <TabsContent value="campaigns">
          {/* Platform sub-filter */}
          <div className="flex gap-1.5 mb-4">
            {["all", "meta", "google"].map((v) => (
              <button key={v} onClick={() => setPlatformFilter(v)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                  platformFilter === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >{v === "all" ? "All" : platformLabels[v]}</button>
            ))}
          </div>

          <div className="grid gap-4">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="h-36 rounded-2xl bg-muted/30 animate-pulse" />)
            ) : filtered.length === 0 ? (
              <Card className="border-border/30">
                <CardContent className="py-16 text-center">
                  <div className="h-12 w-12 rounded-xl bg-primary mx-auto mb-4 flex items-center justify-center">
                    <Megaphone className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-base font-medium">No ad campaigns yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create your first campaign to start advertising.</p>
                </CardContent>
              </Card>
            ) : filtered.map((c) => (
              <Card key={c.id} className="card-premium border-border/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Creative thumbnail */}
                      {c.creative?.imageUrl ? (
                        <div className="h-10 w-10 rounded-lg overflow-hidden border border-border/50 shrink-0">
                          <img src={c.creative.imageUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      ) : c.creative?.videoUrl ? (
                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Video className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <span className="text-base font-semibold block truncate">{c.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className={`capitalize border-0 text-[10px] ${platformColors[c.platform] || ""}`}>
                            {platformLabels[c.platform]}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{objectiveLabels[c.objective]}</span>
                          <span className="text-xs text-muted-foreground">{formatCurrency(c.dailyBudgetCents)}/day</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={`capitalize border-0 text-[11px] ${statusColors[c.status] || ""}`}>
                      {c.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {c.errorMessage && c.status === "failed" && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-rose-50 text-rose-700 text-xs mb-3">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{c.errorMessage}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {c.creative?.headline && (
                        <span className="text-foreground font-medium truncate max-w-[250px]">&ldquo;{c.creative.headline}&rdquo;</span>
                      )}
                      {c.createdAt && <span className="text-xs">Created {new Date(c.createdAt).toLocaleDateString()}</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {c.status === "draft" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>
                          <Play className="h-3 w-3 mr-1" />Launch
                        </Button>
                      )}
                      {c.status === "failed" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>
                          <Play className="h-3 w-3 mr-1" />Retry
                        </Button>
                      )}
                      {c.status === "active" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => handleAction(c.id, "pause")} disabled={actionLoading === c.id}>
                          <Pause className="h-3 w-3 mr-1" />Pause
                        </Button>
                      )}
                      {c.status === "paused" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => handleAction(c.id, "resume")} disabled={actionLoading === c.id}>
                          <Play className="h-3 w-3 mr-1" />Resume
                        </Button>
                      )}
                      {c.externalCampaignId && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleAction(c.id, "sync")} disabled={actionLoading === c.id}>
                          <RefreshCw className={`h-3.5 w-3.5 ${actionLoading === c.id ? "animate-spin" : ""}`} />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => { setDetailCampaign(c); if (!campaignInsights[c.id]) fetchCampaignInsights(c.id); }}>
                        <Lightbulb className="h-3 w-3 mr-1" />Insights
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => openEdit(c)} title="Edit campaign">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleAction(c.id, "delete")} disabled={actionLoading === c.id}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {c.metrics && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/30">
                      <MetricCard icon={Eye} label="Impressions" value={c.metrics.impressions.toLocaleString()} />
                      <MetricCard icon={MousePointerClick} label="Clicks" value={c.metrics.clicks.toLocaleString()} />
                      <MetricCard icon={TrendingUp} label="CTR" value={`${(c.metrics.ctr * 100).toFixed(2)}%`} />
                      <MetricCard icon={DollarSign} label="Spend" value={formatCurrency(c.metrics.spend)} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Insights Tab ── */}
        <TabsContent value="insights">
          {insightsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-2xl bg-muted/30 animate-pulse" />)}
            </div>
          ) : !aggregateInsights ? (
            <Card className="border-border/30">
              <CardContent className="py-16 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-base font-medium">No insights available</p>
                <p className="text-sm text-muted-foreground mt-1">Create campaigns and posts to get AI-powered performance analysis.</p>
                <Button className="mt-4" onClick={fetchAggregateInsights}><RefreshCw className="h-4 w-4 mr-2" />Generate Insights</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Health score + summary */}
              <Card className="border-border/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-4">
                    <ScoreRing score={aggregateInsights.healthScore} size={64} />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg">Marketing Health Score</CardTitle>
                      <CardDescription className="mt-1 line-clamp-3">{aggregateInsights.summary}</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchAggregateInsights} className="shrink-0">
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              {/* Top performer / Underperformer */}
              <div className="grid md:grid-cols-2 gap-4">
                {aggregateInsights.topPerformer && (
                  <Card className="border-emerald-200/50 bg-emerald-50/30 dark:bg-emerald-950/10">
                    <CardContent className="pt-5">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">Top Performer</p>
                          <p className="text-sm font-medium mt-0.5">{aggregateInsights.topPerformer.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">{aggregateInsights.topPerformer.reason}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {aggregateInsights.underperformer && (
                  <Card className="border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/10">
                    <CardContent className="pt-5">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Needs Attention</p>
                          <p className="text-sm font-medium mt-0.5">{aggregateInsights.underperformer.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">{aggregateInsights.underperformer.reason}</p>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 font-medium">{aggregateInsights.underperformer.fix}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Recommendations */}
              {aggregateInsights.recommendations?.length > 0 && (
                <Card className="border-border/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" />Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {aggregateInsights.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/20">
                        <Badge variant="outline" className={`text-[10px] capitalize border-0 shrink-0 mt-0.5 ${
                          rec.priority === "high" ? "bg-rose-50 text-rose-700" : rec.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                        }`}>{rec.priority}</Badge>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{rec.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{rec.description}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Platform insights */}
              {aggregateInsights.platformInsights && aggregateInsights.platformInsights.length > 0 && (
                <Card className="border-border/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Palette className="h-4 w-4" />Platform Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-3 gap-3">
                      {aggregateInsights.platformInsights.map((pi, i) => {
                        const verdictColors: Record<string, string> = { strong: "text-emerald-700 bg-emerald-50", average: "text-amber-700 bg-amber-50", weak: "text-rose-700 bg-rose-50", unused: "text-gray-500 bg-gray-100" };
                        return (
                          <div key={i} className="p-3 rounded-xl bg-muted/20 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium capitalize">{pi.platform}</p>
                              <Badge variant="outline" className={`text-[10px] capitalize border-0 ${verdictColors[pi.verdict] || ""}`}>{pi.verdict}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{pi.tip}</p>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Budget advice + Content tips + Next steps */}
              <div className="grid md:grid-cols-2 gap-4">
                {aggregateInsights.budgetAdvice && (
                  <Card className="border-border/30">
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Budget Advice</CardTitle></CardHeader>
                    <CardContent><p className="text-sm text-muted-foreground">{aggregateInsights.budgetAdvice}</p></CardContent>
                  </Card>
                )}
                {aggregateInsights.nextSteps && aggregateInsights.nextSteps.length > 0 && (
                  <Card className="border-border/30">
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowUpRight className="h-4 w-4" />Next Steps</CardTitle></CardHeader>
                    <CardContent>
                      <ol className="space-y-2">
                        {aggregateInsights.nextSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5 font-semibold">{i + 1}</span>
                            <span className="text-muted-foreground">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                )}
              </div>

              {aggregateInsights.contentTips && aggregateInsights.contentTips.length > 0 && (
                <Card className="border-border/30">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="h-4 w-4" />Content Tips</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-3 gap-3">
                      {aggregateInsights.contentTips.map((tip, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-muted/20">
                          <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground">{tip}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
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
            {/* Active campaign warning */}
            {campaigns.find((c) => c.id === editingId)?.status === "active" && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 text-amber-700 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>This campaign is live. Changes saved here won&apos;t update the live ad until you pause and relaunch it.</span>
              </div>
            )}

            {/* Step indicators */}
            <div className="flex gap-1.5 mb-4">
              {["Basics", "Targeting", "Creative", "Preview"].map((label, i) => (
                <button key={label} onClick={() => setEditFormStep(i)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    editFormStep === i ? "bg-primary text-primary-foreground" :
                    i < editFormStep ? "bg-primary/15 text-primary" :
                    "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* Step 0: Basics */}
            {editFormStep === 0 && (
              <>
                <FormField label="Platform">
                  <Select value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value as "meta" | "google" })}>
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
                  label={editForm.platform === "meta" ? "Ad Account" : "Google Ads Customer"}
                  description={editLoadingAccounts ? "Loading accounts…" : editAdAccounts.length === 0 ? "No accounts found — connect integration first" : undefined}
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
                <FormField label="Objective">
                  <Select value={editForm.objective} onChange={(e) => setEditForm({ ...editForm, objective: e.target.value })}>
                    <option value="awareness">Awareness</option>
                    <option value="traffic">Traffic</option>
                    <option value="engagement">Engagement</option>
                    <option value="leads">Lead Generation</option>
                    <option value="conversions">Conversions</option>
                    <option value="app_installs">App Installs</option>
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
                <p className="text-sm text-muted-foreground mb-2">Review how your updated ad will appear:</p>
                <AdPreview form={editForm} />
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Platform</p>
                      <p className="font-medium">{platformLabels[editForm.platform]}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Objective</p>
                      <p className="font-medium">{objectiveLabels[editForm.objective]}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Daily Budget</p>
                      <p className="font-medium">{formatCurrency(editForm.dailyBudgetCents)}</p>
                    </div>
                    <div className="bg-muted/30 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Start Date</p>
                      <p className="font-medium">{editForm.startDate}</p>
                    </div>
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
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailCampaign && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  {detailCampaign.name}
                  <Badge variant="outline" className={`capitalize border-0 text-[11px] ${platformColors[detailCampaign.platform] || ""}`}>
                    {platformLabels[detailCampaign.platform]}
                  </Badge>
                </DialogTitle>
                <DialogDescription>Campaign performance analysis and improvement suggestions</DialogDescription>
              </DialogHeader>

              {/* Creative preview inside detail */}
              {(detailCampaign.creative.imageUrl || detailCampaign.creative.videoUrl) && (
                <div className="rounded-xl overflow-hidden border border-border/50 bg-black/5">
                  {detailCampaign.creative.videoUrl ? (
                    <video src={detailCampaign.creative.videoUrl} controls className="w-full aspect-video object-cover" />
                  ) : (
                    <img src={detailCampaign.creative.imageUrl} alt="Ad creative" className="w-full aspect-video object-cover" />
                  )}
                </div>
              )}

              {/* Metrics grid */}
              {detailCampaign.metrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard icon={Eye} label="Impressions" value={detailCampaign.metrics.impressions.toLocaleString()} />
                  <MetricCard icon={MousePointerClick} label="Clicks" value={detailCampaign.metrics.clicks.toLocaleString()} />
                  <MetricCard icon={TrendingUp} label="CTR" value={`${(detailCampaign.metrics.ctr * 100).toFixed(2)}%`} />
                  <MetricCard icon={DollarSign} label="Spend" value={formatCurrency(detailCampaign.metrics.spend)} />
                </div>
              )}

              {/* AI Insights */}
              {insightLoadingId === detailCampaign.id ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Analyzing campaign...</span>
                </div>
              ) : campaignInsights[detailCampaign.id] ? (
                <div className="space-y-4">
                  {/* Score */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/20">
                    <ScoreRing score={campaignInsights[detailCampaign.id].overallScore} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{campaignInsights[detailCampaign.id].scoreLabel}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{campaignInsights[detailCampaign.id].summary}</p>
                    </div>
                  </div>

                  {/* Sub-scores */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Creative", score: campaignInsights[detailCampaign.id].creativeScore, icon: Palette },
                      { label: "Targeting", score: campaignInsights[detailCampaign.id].targetingScore, icon: Target },
                      { label: "Budget", score: campaignInsights[detailCampaign.id].budgetScore, icon: DollarSign },
                    ].map(({ label, score, icon: I }) => (
                      <div key={label} className="flex items-center gap-2 p-3 rounded-xl bg-muted/20">
                        <ScoreRing score={score} size={40} />
                        <div>
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="text-xs font-semibold">{score}/100</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Strengths */}
                  {campaignInsights[detailCampaign.id].strengths?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Strengths</p>
                      <ul className="space-y-1">
                        {campaignInsights[detailCampaign.id].strengths.map((s, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                            <span className="text-emerald-500 mt-1">+</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Improvements */}
                  {campaignInsights[detailCampaign.id].improvements?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Areas for Improvement</p>
                      <div className="space-y-2">
                        {campaignInsights[detailCampaign.id].improvements.map((imp, i) => (
                          <div key={i} className="p-3 rounded-xl bg-muted/20">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] capitalize border-0 ${
                                imp.impact === "high" ? "bg-rose-50 text-rose-700" : imp.impact === "medium" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                              }`}>{imp.impact}</Badge>
                              <p className="text-xs font-medium">{imp.area}: {imp.issue}</p>
                            </div>
                            <p className="text-xs text-primary mt-1.5 font-medium">{imp.suggestion}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Wins */}
                  {campaignInsights[detailCampaign.id].quickWins?.length > 0 && (
                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-primary" />Quick Wins</p>
                      <ol className="space-y-1.5">
                        {campaignInsights[detailCampaign.id].quickWins.map((qw, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                            <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-semibold">{i + 1}</span>
                            {qw}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Benchmarks */}
                  {campaignInsights[detailCampaign.id].benchmarks && (
                    <div className="p-3 rounded-xl bg-muted/20 text-xs">
                      <p className="font-semibold mb-1">Industry Benchmarks</p>
                      <p className="text-muted-foreground">CTR: {campaignInsights[detailCampaign.id].benchmarks!.ctrBenchmark} | CPC: {campaignInsights[detailCampaign.id].benchmarks!.cpcBenchmark} | Verdict: <span className="font-medium text-foreground capitalize">{campaignInsights[detailCampaign.id].benchmarks!.verdict}</span></p>
                    </div>
                  )}

                  <Button variant="outline" size="sm" className="w-full" onClick={() => fetchCampaignInsights(detailCampaign.id)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Re-analyze
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">Failed to load insights</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => fetchCampaignInsights(detailCampaign.id)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Try Again
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
