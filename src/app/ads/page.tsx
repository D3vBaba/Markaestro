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
import { Loader2, Heart, MessageCircle, Share2 } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import type { AdCampaignMetrics } from "@/lib/ads/types";
import { FacebookAdPreview, GoogleAdPreview, TikTokAdPreview } from "@/components/app/PlatformPreview";
import { FeatureGate } from "@/components/app/FeatureGate";

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
    keywords?: string[];
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
const statusDotColors: Record<string, string> = {
  draft: "bg-zinc-300",
  pending: "bg-amber-400",
  active: "bg-emerald-500",
  paused: "bg-amber-400",
  completed: "bg-zinc-300",
  failed: "bg-red-500",
};
const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn More", SHOP_NOW: "Shop Now", SIGN_UP: "Sign Up",
  DOWNLOAD: "Download", GET_QUOTE: "Get Quote", CONTACT_US: "Contact Us",
};

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
    <div className="p-3 sm:p-4 rounded-xl border border-border/50 bg-card hover:border-border transition-colors">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-1.5 font-medium">{label}</p>
      <p className="text-xl sm:text-2xl font-light tabular-nums tracking-tight">{value}</p>
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

function CampaignCardPreview({ campaign }: { campaign: AdCampaign }) {
  const { platform, creative } = campaign;
  const { imageUrl, videoUrl, headline, primaryText, description, linkUrl, ctaType } = creative;
  const domain = linkUrl ? linkUrl.replace(/^https?:\/\//, "").split("/")[0] : null;
  const ctaLabel = ctaType ? (CTA_LABELS[ctaType] || ctaType) : null;

  if (platform === "google") {
    return (
      <div className="rounded-t-xl overflow-hidden border-b border-border/30 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 px-3 py-2">
          <div className="flex gap-1 shrink-0">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <div className="w-2 h-2 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-full px-2 py-0.5 flex items-center gap-1">
            <svg className="w-2.5 h-2.5 text-zinc-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <span className="text-[10px] text-zinc-400 truncate">{headline || "your search query"}</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-3.5 h-3.5 rounded-sm bg-blue-500 shrink-0" />
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{domain || "yoursite.com"}</span>
            <span className="ml-auto shrink-0 text-[9px] border border-zinc-300 dark:border-zinc-600 text-zinc-400 px-1 py-px rounded font-medium uppercase tracking-wide">Ad</span>
          </div>
          {headline ? (
            <p className="text-[14px] font-normal text-[#1a0dab] dark:text-[#8ab4f8] leading-snug mb-1">
              {headline.length > 55 ? headline.slice(0, 55) + "…" : headline}
            </p>
          ) : (
            <p className="text-[14px] text-zinc-300 dark:text-zinc-600 italic mb-1">Your headline here</p>
          )}
          {(primaryText || description) ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-2">
              {(primaryText || description || "").slice(0, 100)}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-300 dark:text-zinc-600 italic line-clamp-2">Ad description will appear here.</p>
          )}
          {ctaLabel && (
            <button className="mt-2 px-3 py-0.5 text-[10px] font-medium rounded-full bg-[#1a73e8] text-white">{ctaLabel}</button>
          )}
          <div className="mt-2.5 grid grid-cols-2 gap-1 opacity-25 pointer-events-none">
            {["Features", "Pricing", "About", "Contact"].map((l) => (
              <div key={l} className="border border-zinc-200 dark:border-zinc-700 rounded p-1.5">
                <p className="text-[9px] text-[#1a0dab] dark:text-[#8ab4f8]">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (platform === "tiktok") {
    return (
      <div className="flex justify-center items-center py-5 bg-zinc-950 rounded-t-xl">
        <div
          className="relative rounded-[18px] overflow-hidden bg-zinc-950 border-2 border-zinc-800 shadow-xl"
          style={{ width: 120, aspectRatio: "9/16" }}
        >
          {videoUrl ? (
            <video src={videoUrl} className="absolute inset-0 w-full h-full object-cover" playsInline preload="metadata" />
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#EE1D52 0%,#1a1a2e 60%,#69C9D0 100%)" }} />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 30%, transparent 60%, rgba(0,0,0,0.3) 100%)" }} />
          <div className="absolute top-2 left-0 right-0 flex justify-center gap-3 z-10">
            <span className="text-[6px] text-white/50">Following</span>
            <div className="flex flex-col items-center gap-px">
              <span className="text-[6px] text-white font-bold">For You</span>
              <div className="w-3 h-px bg-white" />
            </div>
          </div>
          <div className="absolute right-1.5 bottom-14 flex flex-col items-center gap-2.5 z-10">
            <div className="w-5 h-5 rounded-full border border-white overflow-hidden">
              <div className="w-full h-full" style={{ background: "linear-gradient(135deg,#EE1D52,#69C9D0)" }} />
            </div>
            {[Heart, MessageCircle, Share2].map((Icon, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <Icon className="w-3.5 h-3.5 text-white" />
                <span className="text-[5px] text-white/70">0</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-0 left-0 right-8 p-2 z-10">
            <p className="text-[7px] font-bold text-white mb-0.5">@yourproduct</p>
            {headline && <p className="text-[6px] text-white/80 leading-tight line-clamp-2">{headline}</p>}
            {ctaLabel && (
              <div className="mt-1.5 px-2 py-0.5 rounded text-[5px] font-bold text-white text-center" style={{ background: "#EE1D52" }}>
                {ctaLabel}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Meta / Facebook
  return (
    <div className="rounded-t-xl overflow-hidden border-b border-border/30 bg-white dark:bg-[#242526]">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
            <span className="text-white font-black text-xs leading-none">Y</span>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 leading-none">Your Product</p>
            <p className="text-[9px] text-zinc-400">Sponsored · 🌐</p>
          </div>
        </div>
        <span className="text-zinc-300 text-sm leading-none">···</span>
      </div>
      {primaryText && (
        <p className="px-3 pb-2 text-[11px] text-zinc-800 dark:text-zinc-200 line-clamp-2 leading-snug">{primaryText}</p>
      )}
      {videoUrl ? (
        <video src={videoUrl} className="w-full aspect-video object-cover" playsInline preload="metadata" />
      ) : imageUrl ? (
        <img src={imageUrl} alt="" className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video bg-linear-to-br from-blue-400 via-blue-500 to-blue-700 flex items-center justify-center">
          <svg className="w-10 h-10 text-white/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-100/80 dark:bg-zinc-800/60">
        <div className="min-w-0 flex-1">
          {domain && <p className="text-[9px] text-zinc-400 uppercase tracking-wide truncate">{domain}</p>}
          {headline ? (
            <p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 leading-tight truncate">{headline}</p>
          ) : (
            <p className="text-[11px] text-zinc-300 dark:text-zinc-600 italic">Your headline</p>
          )}
          {description && <p className="text-[9px] text-zinc-500 truncate">{description}</p>}
        </div>
        {ctaLabel && (
          <button className="shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
            {ctaLabel}
          </button>
        )}
      </div>
      <div className="flex items-center justify-around border-t border-zinc-100 dark:border-zinc-700 px-2 py-1.5">
        {["👍 Like", "💬 Comment", "↗ Share"].map((l) => (
          <span key={l} className="text-[10px] font-medium text-zinc-400">{l}</span>
        ))}
      </div>
    </div>
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

  if (form.platform === "tiktok") {
    return (
      <TikTokAdPreview
        platform="tiktok"
        headline={form.headline}
        primaryText={form.primaryText}
        imageUrl={form.imageUrl}
        videoUrl={form.videoUrl}
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
  const [adDeleteTarget, setAdDeleteTarget] = useState<{ id: string; name: string } | null>(null);
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
    adAccountId: "", customerId: "", advertiserId: "",
    ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "", keywords: "",
    headline: "", primaryText: "", description: "",
    imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
  });

  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createAdAccounts, setCreateAdAccounts] = useState<{ id: string; name: string }[]>([]);
  const [createLoadingAccounts, setCreateLoadingAccounts] = useState(false);
  const [form, setForm] = useState({
    name: "", platform: "meta" as "meta" | "google" | "tiktok",
    objective: "traffic", dailyBudgetCents: 1000,
    startDate: new Date().toISOString().split("T")[0], endDate: "", productId: "",
    adAccountId: "", customerId: "", advertiserId: "",
    ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "", keywords: "",
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
      adAccountId: "", customerId: "", advertiserId: "",
      ageMin: 18, ageMax: 65, gender: "all", locations: "", interests: "", keywords: "",
      headline: "", primaryText: "", description: "",
      imageUrl: "", videoUrl: "", linkUrl: "", ctaType: "",
    });
    setCreateAdAccounts([]);
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
          targeting: { ageMin: number; ageMax: number; gender: string; locations: string[]; interests: string[]; keywords?: string[] };
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
        keywords: s.targeting?.keywords?.join(", ") || f.keywords,
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
        productId: form.productId || undefined,
        // Platform-specific account IDs
        ...(form.platform === "google" && form.customerId ? { customerId: form.customerId } : {}),
        ...(form.platform === "meta" && form.adAccountId ? { adAccountId: form.adAccountId } : {}),
        ...(form.platform === "tiktok" && form.advertiserId ? { adAccountId: form.advertiserId } : {}),
        targeting: {
          ageMin: form.ageMin, ageMax: form.ageMax, gender: form.gender,
          locations: form.locations ? form.locations.split(",").map((s) => s.trim()).filter(Boolean) : [],
          // Interests: Meta and TikTok only
          ...(form.platform !== "google" ? {
            interests: form.interests ? form.interests.split(",").map((s) => s.trim()).filter(Boolean) : [],
          } : {}),
          // Keywords: Google Search only
          ...(form.platform === "google" ? {
            keywords: form.keywords ? form.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
          } : {}),
        },
        creative: {
          headline: form.headline, primaryText: form.primaryText, description: form.description,
          imageUrl: form.imageUrl,
          // Video: Meta and TikTok only
          ...(form.platform !== "google" ? { videoUrl: form.videoUrl } : {}),
          linkUrl: form.linkUrl, ctaType: form.ctaType,
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
      adAccountId: c.platform === "meta" ? (c.adAccountId || "") : "",
      customerId: c.platform === "google" ? (c.customerId || "") : "",
      advertiserId: c.platform === "tiktok" ? (c.adAccountId || "") : "",
      ageMin: c.targeting?.ageMin ?? 18,
      ageMax: c.targeting?.ageMax ?? 65,
      gender: c.targeting?.gender ?? "all",
      locations: (c.targeting?.locations || []).join(", "),
      interests: (c.targeting?.interests || []).join(", "),
      keywords: (c.targeting?.keywords || []).join(", "),
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
        if (!c.productId) { setEditAdAccounts([]); return; }
        const qs = `?productId=${c.productId}`;
        const res = await apiGet<{ adAccounts: { id: string; name: string }[]; error?: string }>(`/api/integrations/meta/ad-accounts${qs}`);
        if (res.ok) {
          setEditAdAccounts(res.data.adAccounts || []);
          if (res.data.error) toast.error(`Meta: ${res.data.error}`);
        }
      } else if (c.platform === "google") {
        const res = await apiGet<{ customers: { id: string; name: string }[]; error?: string }>("/api/integrations/google/customers");
        if (res.ok) {
          setEditAdAccounts(res.data.customers || []);
          if (res.data.error) toast.error(`Google Ads: ${res.data.error}`);
        }
      } else {
        // TikTok — no account list API yet, user enters advertiser ID manually
        setEditAdAccounts([]);
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
        productId: editForm.productId || undefined,
        // Platform-specific account IDs
        ...(editForm.platform === "google" && editForm.customerId ? { customerId: editForm.customerId } : {}),
        ...(editForm.platform === "meta" && editForm.adAccountId ? { adAccountId: editForm.adAccountId } : {}),
        ...(editForm.platform === "tiktok" && editForm.advertiserId ? { adAccountId: editForm.advertiserId } : {}),
        targeting: {
          ageMin: editForm.ageMin, ageMax: editForm.ageMax, gender: editForm.gender,
          locations: editForm.locations ? editForm.locations.split(",").map((s) => s.trim()).filter(Boolean) : [],
          ...(editForm.platform !== "google" ? {
            interests: editForm.interests ? editForm.interests.split(",").map((s) => s.trim()).filter(Boolean) : [],
          } : {}),
          ...(editForm.platform === "google" ? {
            keywords: editForm.keywords ? editForm.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
          } : {}),
        },
        creative: {
          headline: editForm.headline, primaryText: editForm.primaryText, description: editForm.description,
          imageUrl: editForm.imageUrl,
          ...(editForm.platform !== "google" ? { videoUrl: editForm.videoUrl } : {}),
          linkUrl: editForm.linkUrl, ctaType: editForm.ctaType,
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
  const totalConversions = campaigns.reduce((s, c) => s + (c.metrics?.conversions || 0), 0);
  const totalConversionValue = campaigns.reduce((s, c) => s + (c.metrics?.conversionValue || 0), 0);
  const overallRoas = totalSpend > 0 && totalConversionValue > 0 ? (totalConversionValue / totalSpend) : null;
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  return (
    <AppShell>
      <FeatureGate feature="ads">
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
                        setForm({ ...form, platform, objective: normalizeObjectiveForPlatform(platform, form.objective), customerId: "", adAccountId: "", advertiserId: "" });
                        if (platform === "google") {
                          setCreateLoadingAccounts(true);
                          setCreateAdAccounts([]);
                          apiGet<{ customers: { id: string; name: string }[]; error?: string }>("/api/integrations/google/customers")
                            .then((res) => { if (res.ok) setCreateAdAccounts(res.data.customers || []); })
                            .catch(() => {})
                            .finally(() => setCreateLoadingAccounts(false));
                        } else {
                          setCreateAdAccounts([]);
                        }
                      }}>
                        <option value="meta">Meta (Facebook / Instagram)</option>
                        <option value="google">Google Ads</option>
                        <option value="tiktok">TikTok Ads</option>
                      </Select>
                    </FormField>

                    {/* Meta: product required for page selection */}
                    {form.platform === "meta" && (
                      <FormField label="Product" description="Required — used to determine which Facebook page to run ads from.">
                        <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                          <option value="">Select a product</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </FormField>
                    )}

                    {/* Google: customer account selector */}
                    {form.platform === "google" && (
                      <>
                        <FormField label="Product" description="Optional — helps AI research your market for Smart Suggest.">
                          <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                            <option value="">None</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </Select>
                        </FormField>
                        <FormField
                          label="Google Ads Account"
                          description={createLoadingAccounts ? "Loading accounts..." : createAdAccounts.length === 0 ? "Connect your Google Ads account in Integrations first" : "Select which Google Ads account to create this campaign under"}
                        >
                          <Select
                            value={form.customerId}
                            onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                            disabled={createLoadingAccounts || createAdAccounts.length === 0}
                          >
                            <option value="">Use workspace default</option>
                            {createAdAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                          </Select>
                        </FormField>
                      </>
                    )}

                    {/* TikTok: advertiser ID */}
                    {form.platform === "tiktok" && (
                      <>
                        <FormField label="Product" description="Optional — helps AI research your market for Smart Suggest.">
                          <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                            <option value="">None</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </Select>
                        </FormField>
                        <FormField label="TikTok Advertiser ID" description="Found in TikTok Ads Manager — top-right account dropdown">
                          <Input placeholder="1234567890" value={form.advertiserId} onChange={(e) => setForm({ ...form, advertiserId: e.target.value })} />
                        </FormField>
                      </>
                    )}

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
                        {suggesting ? "Researching your market..." : "Smart Suggest — Let AI build this ad"}
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
                    <FormField label="Objective">
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
                    {/* Platform badge */}
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {form.platform === "google" ? "Google Ads Targeting" : form.platform === "meta" ? "Meta Audience Targeting" : "TikTok Audience Targeting"}
                    </p>

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
                    <FormField
                      label="Locations"
                      description={form.platform === "google" ? "Comma-separated country codes (e.g. US, GB, CA) — resolved to Google geo target IDs" : "Comma-separated country codes (e.g. US, GB, CA)"}
                    >
                      <Input placeholder="US, GB, CA" value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} />
                    </FormField>

                    {/* Interests: Meta and TikTok only */}
                    {form.platform !== "google" && (
                      <FormField
                        label="Interests"
                        description={form.platform === "meta" ? "Comma-separated Meta interest taxonomy IDs or names" : "Comma-separated interest topics for TikTok targeting"}
                      >
                        <Input placeholder="Technology, Marketing, SaaS" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
                      </FormField>
                    )}

                    {/* Keywords: Google Search only */}
                    {form.platform === "google" && ["traffic", "leads", "conversions"].includes(form.objective) && (
                      <FormField label="Search Keywords" description="Keywords that trigger your ads. Use commas to separate. Google matches broad variations automatically.">
                        <Textarea placeholder="marketing automation, email marketing tool, best CRM software" rows={4} value={form.keywords}
                          onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {form.keywords ? form.keywords.split(",").filter((s) => s.trim()).length : 0} keywords · BROAD match
                        </p>
                      </FormField>
                    )}

                    {/* Google Display/Awareness — no keyword targeting note */}
                    {form.platform === "google" && ["awareness", "engagement", "app_installs"].includes(form.objective) && (
                      <p className="text-xs text-muted-foreground p-3 rounded-lg border border-border/30">
                        Display campaigns use audience signals and placements rather than keywords. No keyword targeting required.
                      </p>
                    )}
                  </>
                )}

                {/* Step 2: Creative */}
                {formStep === 2 && (
                  <>
                    {/* Platform badge */}
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {form.platform === "google" ? "Google Responsive Search Ad" : form.platform === "meta" ? "Meta Ad Creative" : "TikTok Ad Creative"}
                    </p>

                    <FormField
                      label="Headline"
                      description={form.platform === "google" ? "Pinned as Headline 1 in your RSA — max 30 characters" : form.platform === "tiktok" ? "Short, punchy headline — max 100 characters" : undefined}
                    >
                      <Input placeholder={form.platform === "google" ? "Grow Your Business Fast" : form.platform === "tiktok" ? "Wait till you see this..." : "Your attention-grabbing headline"}
                        value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })}
                      />
                      {form.platform === "google" && (
                        <p className={`text-[10px] mt-0.5 ${form.headline.length > 30 ? "text-destructive" : "text-muted-foreground"}`}>
                          {form.headline.length}/30 characters
                        </p>
                      )}
                      {form.platform === "tiktok" && (
                        <p className={`text-[10px] mt-0.5 ${form.headline.length > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                          {form.headline.length}/100 characters
                        </p>
                      )}
                    </FormField>

                    <FormField
                      label={form.platform === "google" ? "Ad Description (RSA)" : "Primary Text"}
                      description={form.platform === "google" ? "Used as RSA description — max 90 characters" : form.platform === "tiktok" ? "Main ad caption — max 100 characters" : "Main body copy of your ad"}
                    >
                      <Textarea
                        placeholder={form.platform === "google" ? "Clear, compelling benefit for searchers..." : form.platform === "tiktok" ? "Grab attention in the first 3 words..." : "The main body of your ad..."}
                        rows={3} value={form.primaryText} onChange={(e) => setForm({ ...form, primaryText: e.target.value })}
                      />
                      {form.platform === "google" && (
                        <p className={`text-[10px] mt-0.5 ${form.primaryText.length > 90 ? "text-destructive" : "text-muted-foreground"}`}>
                          {form.primaryText.length}/90 characters
                        </p>
                      )}
                      {form.platform === "tiktok" && (
                        <p className={`text-[10px] mt-0.5 ${form.primaryText.length > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                          {form.primaryText.length}/100 characters
                        </p>
                      )}
                    </FormField>

                    {/* Description: Google and Meta */}
                    {form.platform !== "tiktok" && (
                      <FormField label="Description" description={form.platform === "google" ? "Optional extra context shown below the ad" : "Supporting text (optional)"}>
                        <Input placeholder="Additional details about your offer" value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                        />
                      </FormField>
                    )}

                    {/* Image: Google Display + Meta + TikTok */}
                    {(form.platform !== "google" || ["awareness", "engagement", "app_installs"].includes(form.objective)) && (
                      <FormField
                        label="Ad Image"
                        description={form.platform === "google" ? "Required for Display campaigns — 1200×628px recommended" : form.platform === "meta" ? "1200×628px, JPG/PNG/GIF, max 10MB" : "1:1 or 9:16, JPG/PNG, used for image ads"}
                      >
                        <MediaUploadZone
                          type="image" url={form.imageUrl} uploading={uploadingImage}
                          onUpload={(f) => handleMediaUpload(f, "image")}
                          onRemove={() => setForm({ ...form, imageUrl: "" })}
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          platform={form.platform}
                        />
                      </FormField>
                    )}

                    {/* Video: Meta and TikTok only */}
                    {form.platform !== "google" && (
                      <FormField
                        label="Ad Video"
                        description={form.platform === "meta" ? "MP4/MOV, 16:9, max 500MB — video ads outperform images on Meta" : "MP4/MOV, 9:16 vertical recommended — TikTok is video-first"}
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

                    <FormField label="Landing Page URL" description={form.platform === "google" ? "Final URL — users land here after clicking your ad" : undefined}>
                      <Input placeholder="https://yoursite.com/offer" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} />
                    </FormField>

                    {/* CTA: Meta and TikTok (Google uses its own CTA system) */}
                    {form.platform !== "google" && (
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
                    )}
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
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-10">
          <MetricCard label="Active Campaigns" value={String(activeCampaigns)} />
          <MetricCard label="Total Impressions" value={totalImpressions.toLocaleString()} />
          <MetricCard label="Total Clicks" value={totalClicks.toLocaleString()} />
          <MetricCard label="Total Spend" value={formatCurrency(totalSpend)} />
          <MetricCard label="Conversions" value={totalConversions.toLocaleString()} />
          <MetricCard label="Overall ROAS" value={overallRoas !== null ? `${overallRoas.toFixed(2)}x` : "—"} />
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
          <div className="flex gap-1.5 mb-6 flex-wrap">
            {[
              { v: "all", label: "All Platforms" },
              { v: "meta", label: "Meta" },
              { v: "google", label: "Google" },
              { v: "tiktok", label: "TikTok" },
            ].map(({ v, label }) => (
              <button key={v} onClick={() => setPlatformFilter(v)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full border transition-all ${
                  platformFilter === v
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground"
                }`}
              >{label}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              [1, 2, 3].map((i) => <div key={i} className="h-44 rounded-xl bg-muted/20 animate-pulse" />)
            ) : filtered.length === 0 ? (
              <div className="col-span-full text-center py-20 border border-dashed border-border/50 rounded-xl">
                <p className="text-sm font-medium">No ad campaigns yet</p>
                <p className="text-xs text-muted-foreground mt-2">Create your first campaign to start advertising.</p>
              </div>
            ) : filtered.map((c) => (
              <div
                key={c.id}
                className="flex flex-col border border-border/50 rounded-xl overflow-hidden hover:border-border/80 hover:shadow-md transition-all bg-card"
              >
                {/* Platform ad preview — full bleed at top */}
                <CampaignCardPreview campaign={c} />

                {/* Card body */}
                <div className="flex flex-col flex-1 px-4 py-3 gap-3">
                  {/* Name + status */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug line-clamp-2 flex-1 min-w-0">{c.name}</p>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDotColors[c.status] || "bg-zinc-300"}`} />
                      <span className={`text-[10px] uppercase tracking-wider font-medium ${statusColors[c.status] || "text-muted-foreground"}`}>
                        {c.status}
                      </span>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-wider font-semibold">{platformLabels[c.platform]}</span>
                    <span className="w-px h-2.5 bg-border/60" />
                    <span>{objectiveLabels[c.objective]}</span>
                    <span className="w-px h-2.5 bg-border/60" />
                    <span className="tabular-nums">{formatCurrency(c.dailyBudgetCents)}/day</span>
                  </div>

                  {c.errorMessage && c.status === "failed" && (
                    <p className="text-xs text-destructive p-2.5 rounded-lg bg-destructive/5">{c.errorMessage}</p>
                  )}

                  {/* Metrics */}
                  {c.metrics && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/30">
                      <MetricCard label="Impressions" value={c.metrics.impressions.toLocaleString()} />
                      <MetricCard label="Clicks" value={c.metrics.clicks.toLocaleString()} />
                      <MetricCard label="CTR" value={`${(c.metrics.ctr * 100).toFixed(2)}%`} />
                      <MetricCard label="Spend" value={formatCurrency(c.metrics.spend)} />
                      <MetricCard label="CPC" value={c.metrics.cpc > 0 ? formatCurrency(c.metrics.cpc) : "—"} />
                      <MetricCard label="ROAS" value={c.metrics.roas > 0 ? `${c.metrics.roas.toFixed(2)}x` : "—"} />
                      {c.metrics.conversions > 0 && (
                        <MetricCard label="Conversions" value={c.metrics.conversions.toLocaleString()} />
                      )}
                      {c.metrics.frequency > 0 && (
                        <MetricCard label="Frequency" value={c.metrics.frequency.toFixed(2) + "x"} />
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-1 mt-auto pt-2 border-t border-border/30">
                    {c.status === "draft" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>Launch</Button>
                    )}
                    {c.status === "failed" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "launch")} disabled={actionLoading === c.id}>Retry</Button>
                    )}
                    {c.status === "active" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "pause")} disabled={actionLoading === c.id}>Pause</Button>
                    )}
                    {c.status === "paused" && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "resume")} disabled={actionLoading === c.id}>Resume</Button>
                    )}
                    {c.externalCampaignId && (
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => handleAction(c.id, "sync")} disabled={actionLoading === c.id}>
                        {actionLoading === c.id ? "Syncing..." : "Sync"}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setDetailCampaign(c); if (!campaignInsights[c.id]) fetchCampaignInsights(c.id); }}>Insights</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-destructive" onClick={() => setAdDeleteTarget({ id: c.id, name: c.name })} disabled={actionLoading === c.id}>Delete</Button>
                    {c.createdAt && (
                      <span className="text-[10px] text-muted-foreground/60 ml-auto">{new Date(c.createdAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
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
                This campaign is live. Budget changes will be pushed to the ad platform automatically. Other changes (targeting, creative) will only apply if you pause and relaunch.
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
                {/* Platform badge — locked for existing campaigns */}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/40 border border-border/40">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Platform</span>
                  <span className="ml-auto text-xs font-semibold capitalize">
                    {editForm.platform === "meta" ? "Meta (Facebook / Instagram)" : editForm.platform === "google" ? "Google Ads" : "TikTok Ads"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">(locked)</span>
                </div>

                {/* Meta: product is required */}
                {editForm.platform === "meta" && (
                  <FormField label="Product" description="Required for Meta campaigns">
                    <Select value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })}>
                      <option value="">Select a product…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </FormField>
                )}

                {/* Meta: ad account selector */}
                {editForm.platform === "meta" && (
                  <FormField
                    label="Ad Account"
                    description={editLoadingAccounts ? "Loading accounts…" : editAdAccounts.length === 0 ? "No ad accounts found — connect Meta integration first" : undefined}
                  >
                    <Select
                      value={editForm.adAccountId}
                      onChange={(e) => setEditForm({ ...editForm, adAccountId: e.target.value })}
                      disabled={editLoadingAccounts || editAdAccounts.length === 0}
                    >
                      <option value="">Use product default</option>
                      {editAdAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                    </Select>
                  </FormField>
                )}

                {/* Google: optional product + account selector */}
                {editForm.platform === "google" && (
                  <>
                    <FormField label="Product" description="Optional — used for ad copy context">
                      <Select value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })}>
                        <option value="">None</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </FormField>
                    <FormField
                      label="Google Ads Customer ID"
                      description={editLoadingAccounts ? "Loading accounts…" : editAdAccounts.length === 0 ? "No Google Ads accounts found — connect Google integration first" : undefined}
                    >
                      <Select
                        value={editForm.customerId}
                        onChange={(e) => setEditForm({ ...editForm, customerId: e.target.value })}
                        disabled={editLoadingAccounts || editAdAccounts.length === 0}
                      >
                        <option value="">Select account…</option>
                        {editAdAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                      </Select>
                    </FormField>
                  </>
                )}

                {/* TikTok: optional product + manual advertiser ID */}
                {editForm.platform === "tiktok" && (
                  <>
                    <FormField label="Product" description="Optional">
                      <Select value={editForm.productId} onChange={(e) => setEditForm({ ...editForm, productId: e.target.value })}>
                        <option value="">None</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </FormField>
                    <FormField label="TikTok Advertiser ID" description="Found in TikTok Ads Manager → Account">
                      <Input
                        placeholder="e.g. 7012345678901234567"
                        value={editForm.advertiserId}
                        onChange={(e) => setEditForm({ ...editForm, advertiserId: e.target.value })}
                      />
                    </FormField>
                  </>
                )}

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
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {editForm.platform === "meta" ? "Meta Audience Targeting" : editForm.platform === "google" ? "Google Ads Targeting" : "TikTok Audience Targeting"}
                </p>

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
                <FormField label="Locations" description={editForm.platform === "google" ? "Comma-separated ISO country codes (e.g. US, GB, CA) — resolved to geo IDs automatically" : "Comma-separated country codes (e.g. US, GB, CA)"}>
                  <Input value={editForm.locations} onChange={(e) => setEditForm({ ...editForm, locations: e.target.value })} />
                </FormField>

                {/* Interests: Meta and TikTok only */}
                {editForm.platform !== "google" && (
                  <FormField label="Interests" description="Comma-separated interests for audience targeting">
                    <Input value={editForm.interests} onChange={(e) => setEditForm({ ...editForm, interests: e.target.value })} />
                  </FormField>
                )}

                {/* Keywords: Google Search only (traffic / leads / conversions) */}
                {editForm.platform === "google" && ["traffic", "leads", "conversions"].includes(editForm.objective) && (
                  <FormField label="Search Keywords" description="Comma-separated keywords users search to trigger your ad">
                    <Textarea placeholder="marketing automation, email marketing tool, crm software" rows={3} value={editForm.keywords}
                      onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {editForm.keywords ? editForm.keywords.split(",").filter((s) => s.trim()).length : 0} keywords added.
                    </p>
                  </FormField>
                )}

                {/* Display campaigns don't use keywords */}
                {editForm.platform === "google" && ["awareness", "engagement", "app_installs"].includes(editForm.objective) && (
                  <div className="p-3 rounded-lg bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200/40">
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Display campaigns use audience signals instead of keywords. Google will target users based on your demographics and interests you set at the ad group level.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Step 2: Creative */}
            {editFormStep === 2 && (
              <>
                {/* Headline */}
                <FormField
                  label={editForm.platform === "google" ? "Headline" : "Headline"}
                  description={
                    editForm.platform === "google" ? "Max 30 characters (Google RSA)" :
                    editForm.platform === "meta" ? "Max 40 characters (Facebook / Instagram)" :
                    "Max 100 characters (TikTok)"
                  }
                >
                  <Input
                    placeholder={
                      editForm.platform === "google" ? "Stop Losing Leads Today" :
                      editForm.platform === "meta" ? "Transform Your Marketing in 5 Minutes" :
                      "Watch How We Solve Your #1 Problem"
                    }
                    value={editForm.headline}
                    onChange={(e) => setEditForm({ ...editForm, headline: e.target.value })}
                  />
                  <p className={`text-[10px] mt-0.5 ${
                    (editForm.platform === "google" && editForm.headline.length > 30) ||
                    (editForm.platform === "meta" && editForm.headline.length > 40) ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    {editForm.headline.length}/{editForm.platform === "google" ? 30 : editForm.platform === "meta" ? 40 : 100} characters
                  </p>
                </FormField>

                {/* Primary Text */}
                <FormField
                  label={editForm.platform === "google" ? "Ad Copy" : editForm.platform === "tiktok" ? "Ad Text" : "Primary Text"}
                  description={
                    editForm.platform === "google" ? "Max 90 characters (shown under headline)" :
                    editForm.platform === "meta" ? "Max 125 characters (shown above the image)" :
                    "Max 100 characters"
                  }
                >
                  <Textarea
                    rows={3}
                    placeholder={
                      editForm.platform === "google" ? "Automate your campaigns. Save hours weekly." :
                      editForm.platform === "meta" ? "Tired of wasting ad budget? Our platform cuts CPL by 40% on average." :
                      "See why 10,000+ brands trust us for their marketing."
                    }
                    value={editForm.primaryText}
                    onChange={(e) => setEditForm({ ...editForm, primaryText: e.target.value })}
                  />
                  <p className={`text-[10px] mt-0.5 ${
                    (editForm.platform === "google" && editForm.primaryText.length > 90) ||
                    (editForm.platform === "meta" && editForm.primaryText.length > 125) ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    {editForm.primaryText.length}/{editForm.platform === "google" ? 90 : editForm.platform === "meta" ? 125 : 100} characters
                  </p>
                </FormField>

                {/* Description: Meta and Google only (not TikTok) */}
                {editForm.platform !== "tiktok" && (
                  <FormField
                    label="Description"
                    description={editForm.platform === "google" ? "Max 90 characters" : "Max 30 characters (shown below headline on some placements)"}
                  >
                    <Input
                      placeholder={editForm.platform === "google" ? "Free 14-day trial. No credit card required." : "Start free today"}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                    {editForm.platform === "meta" && (
                      <p className={`text-[10px] mt-0.5 ${editForm.description.length > 30 ? "text-destructive" : "text-muted-foreground"}`}>
                        {editForm.description.length}/30 characters
                      </p>
                    )}
                  </FormField>
                )}

                {/* Image: always shown for Meta and TikTok; only for Google Display */}
                {(editForm.platform !== "google" || ["awareness", "engagement", "app_installs"].includes(editForm.objective)) && (
                  <FormField label={editForm.platform === "google" ? "Display Ad Image" : "Ad Image"} description={editForm.platform === "google" ? "Required for Display campaigns (1200×628 recommended)" : "Recommended: 1080×1080 or 1080×1920"}>
                    <MediaUploadZone
                      type="image" url={editForm.imageUrl} uploading={editUploadingImage}
                      onUpload={(f) => handleEditMediaUpload(f, "image")}
                      onRemove={() => setEditForm({ ...editForm, imageUrl: "" })}
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      platform={editForm.platform}
                    />
                  </FormField>
                )}

                {/* Video: Meta and TikTok only */}
                {editForm.platform !== "google" && (
                  <FormField label="Ad Video" description={editForm.platform === "tiktok" ? "Required for TikTok — vertical 9:16, up to 60s" : "Optional — outperforms static images in most placements"}>
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
                  <Input placeholder="https://yoursite.com/landing" value={editForm.linkUrl} onChange={(e) => setEditForm({ ...editForm, linkUrl: e.target.value })} />
                </FormField>

                {/* CTA: Meta and TikTok only (Google uses its own system) */}
                {editForm.platform !== "google" && (
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
                )}
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
              {(detailCampaign.creative.headline || detailCampaign.creative.primaryText || detailCampaign.creative.imageUrl || detailCampaign.creative.videoUrl) && (
                <AdPreview form={{
                  platform: detailCampaign.platform,
                  headline: detailCampaign.creative.headline || "",
                  primaryText: detailCampaign.creative.primaryText || "",
                  description: detailCampaign.creative.description || "",
                  imageUrl: detailCampaign.creative.imageUrl || "",
                  videoUrl: detailCampaign.creative.videoUrl || "",
                  linkUrl: detailCampaign.creative.linkUrl || "",
                  ctaType: detailCampaign.creative.ctaType || "",
                }} />
              )}

              {/* Metrics */}
              {detailCampaign.metrics && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard label="Impressions" value={detailCampaign.metrics.impressions.toLocaleString()} />
                    <MetricCard label="Clicks" value={detailCampaign.metrics.clicks.toLocaleString()} />
                    <MetricCard label="CTR" value={`${(detailCampaign.metrics.ctr * 100).toFixed(2)}%`} />
                    <MetricCard label="Spend" value={formatCurrency(detailCampaign.metrics.spend)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard label="CPC" value={detailCampaign.metrics.cpc > 0 ? formatCurrency(detailCampaign.metrics.cpc) : "—"} />
                    <MetricCard label="Conversions" value={detailCampaign.metrics.conversions.toLocaleString()} />
                    <MetricCard
                      label="Conv. Rate"
                      value={detailCampaign.metrics.clicks > 0
                        ? `${((detailCampaign.metrics.conversions / detailCampaign.metrics.clicks) * 100).toFixed(2)}%`
                        : "—"}
                    />
                    <MetricCard
                      label="ROAS"
                      value={detailCampaign.metrics.roas > 0 ? `${detailCampaign.metrics.roas.toFixed(2)}x` : "—"}
                    />
                  </div>
                  {(detailCampaign.metrics.reach > 0 || detailCampaign.metrics.videoViews > 0) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {detailCampaign.metrics.reach > 0 && (
                        <MetricCard label="Reach" value={detailCampaign.metrics.reach.toLocaleString()} />
                      )}
                      {detailCampaign.metrics.frequency > 0 && (
                        <MetricCard
                          label="Frequency"
                          value={`${detailCampaign.metrics.frequency.toFixed(2)}x`}
                        />
                      )}
                      {detailCampaign.metrics.videoViews > 0 && (
                        <MetricCard label="Video Views" value={detailCampaign.metrics.videoViews.toLocaleString()} />
                      )}
                      {detailCampaign.metrics.videoWatchTime > 0 && (
                        <MetricCard label="Avg Watch" value={`${detailCampaign.metrics.videoWatchTime.toFixed(1)}s`} />
                      )}
                    </div>
                  )}
                  {detailCampaign.metrics.conversionValue > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                      <MetricCard label="Revenue Attributed" value={formatCurrency(detailCampaign.metrics.conversionValue)} />
                      <MetricCard
                        label="Cost per Conversion"
                        value={detailCampaign.metrics.conversions > 0
                          ? formatCurrency(Math.round(detailCampaign.metrics.spend / detailCampaign.metrics.conversions))
                          : "—"}
                      />
                    </div>
                  )}
                </>
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
      </FeatureGate>

      <ConfirmDeleteDialog
        open={!!adDeleteTarget}
        onOpenChange={(open) => { if (!open) setAdDeleteTarget(null); }}
        entity="ad campaign"
        name={adDeleteTarget?.name}
        warning="This will pause the campaign on the ad platform and delete the local record."
        onConfirm={async () => { if (adDeleteTarget) await handleAction(adDeleteTarget.id, "delete"); }}
      />
    </AppShell>
  );
}
