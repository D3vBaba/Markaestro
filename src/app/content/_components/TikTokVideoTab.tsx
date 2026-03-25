"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, apiGet, apiUpload } from "@/lib/api-client";
import { toast } from "sonner";
import ProductPicker from "./ProductPicker";
import {
  Sparkles,
  Video,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  FileText,
  User,
  RotateCcw,
  Upload,
  Package,
  Mic,
  Film,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────

type VideoFormat = "ugc" | "product-scene" | "faceless-narrated";

type Trend = {
  id: string;
  name: string;
  description: string;
  format: string;
  hooks: string[];
  hashtags: string[];
  viralityScore: number;
  relevanceScore: number;
};

type UGCScript = {
  script: string;
  hookLine: string;
  style: string;
  estimatedDurationSeconds: number;
};

type SavedAvatar = {
  id: string;
  name: string;
  imageUrl: string;
};

type VideoGeneration = {
  id: string;
  status: "pending" | "generating" | "completed" | "failed";
  videoUrl: string;
  errorMessage: string;
  postId?: string;
  sceneImageUrl?: string;
};

type ProductSceneType = "product-in-hand" | "unboxing" | "routine" | "before-after" | "lifestyle";

const SCRIPT_STYLES = [
  { value: "problem-solution", label: "Problem \u2192 Solution", desc: "Relatable pain point, then the fix" },
  { value: "testimonial", label: "Testimonial", desc: "Personal experience story" },
  { value: "review", label: "Honest Review", desc: "Candid first impression" },
  { value: "routine", label: "Routine", desc: "Product in daily life" },
  { value: "comparison", label: "Comparison", desc: "Before vs. after switching" },
];

const SCENE_TYPES: { value: ProductSceneType; label: string; desc: string }[] = [
  { value: "product-in-hand", label: "Product in Hand", desc: "Character holding or examining the product" },
  { value: "unboxing", label: "Unboxing", desc: "Opening and revealing the product" },
  { value: "routine", label: "Routine / GRWM", desc: "Using product in daily routine" },
  { value: "before-after", label: "Before / After", desc: "Transformation moment with product" },
  { value: "lifestyle", label: "Lifestyle", desc: "Candid moment with product visible" },
];

const VOICES = {
  female: [
    { id: "af_heart", label: "Heart" },
    { id: "af_bella", label: "Bella" },
    { id: "af_jessica", label: "Jessica" },
    { id: "af_nicole", label: "Nicole" },
    { id: "af_nova", label: "Nova" },
    { id: "af_sarah", label: "Sarah" },
    { id: "af_sky", label: "Sky" },
    { id: "af_river", label: "River" },
  ],
  male: [
    { id: "am_adam", label: "Adam" },
    { id: "am_echo", label: "Echo" },
    { id: "am_eric", label: "Eric" },
    { id: "am_liam", label: "Liam" },
    { id: "am_michael", label: "Michael" },
    { id: "am_puck", label: "Puck" },
  ],
};

// ── Step indicator ─────────────────────────────────────────────────

function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5 shrink-0">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all ${
            i < step ? "bg-foreground text-background" : i === step ? "bg-foreground text-background ring-2 ring-foreground/20 ring-offset-2 ring-offset-background" : "bg-muted text-muted-foreground"
          }`}>
            {i < step ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
          </div>
          <span className={`text-[11px] font-medium hidden sm:inline ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
          {i < labels.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/30" />}
        </div>
      ))}
    </div>
  );
}

// ── Trend card ─────────────────────────────────────────────────────

function TrendCard({ trend, selected, onSelect }: { trend: Trend; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className={`w-full text-left p-4 rounded-xl border transition-all ${selected ? "border-foreground bg-foreground/5 shadow-sm" : "border-border/50 hover:border-foreground/30"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <h4 className="text-sm font-medium">{trend.name}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{trend.description}</p>
          <p className="text-[11px] text-muted-foreground/70"><span className="font-medium">Format:</span> {trend.format}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">Viral <span className="font-semibold text-foreground">{trend.viralityScore}</span></span>
          <span className="text-[10px] text-muted-foreground">Fit <span className="font-semibold text-foreground">{trend.relevanceScore}</span></span>
        </div>
      </div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────

export default function TikTokVideoTab({ onPostCreated }: { onPostCreated?: () => void }) {
  const [productId, setProductId] = useState("");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("ugc");

  // Trends
  const [trends, setTrends] = useState<Trend[]>([]);
  const [researching, setResearching] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [focusArea, setFocusArea] = useState("");

  // Script (shared between UGC and product-scene voiceover)
  const [scriptStyle, setScriptStyle] = useState("problem-solution");
  const [scriptDuration, setScriptDuration] = useState(30);
  const [writingScript, setWritingScript] = useState(false);
  const [script, setScript] = useState<UGCScript | null>(null);
  const [editedScript, setEditedScript] = useState("");

  // Avatar & Voice (shared)
  const [savedAvatars, setSavedAvatars] = useState<SavedAvatar[]>([]);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState("");
  const [voice, setVoice] = useState("af_heart");
  const [uploading, setUploading] = useState(false);
  const [avatarName, setAvatarName] = useState("");
  const [generatingFace, setGeneratingFace] = useState(false);
  const [faceGender, setFaceGender] = useState<"male" | "female">("female");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Product Scene specific
  const [sceneType, setSceneType] = useState<ProductSceneType>("product-in-hand");
  const [sceneDescription, setSceneDescription] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [wantsVoiceover, setWantsVoiceover] = useState(false);
  const productImageInputRef = useRef<HTMLInputElement>(null);

  // Generate
  const [caption, setCaption] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<VideoGeneration | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Faceless narrated state
  const [facelessSceneCount, setFacelessSceneCount] = useState(4);
  const [facelessDuration, setFacelessDuration] = useState(30);

  // Wizard navigation
  const [wizardStep, setWizardStep] = useState(0);

  // Step labels per format
  const stepLabels = videoFormat === "ugc"
    ? ["Product", "Trends", "Script", "Avatar & Voice", "Generate"]
    : videoFormat === "product-scene"
    ? ["Product", "Trends", "Scene Setup", "Voiceover", "Generate"]
    : ["Product", "Trends", "Script & Voice", "Generate"];

  // Current step calculation
  const currentStep = (() => {
    if (!productId) return 0;
    if (!selectedTrend) return 1;
    if (videoFormat === "ugc") {
      if (!script) return 2;
      if (!selectedAvatarUrl) return 3;
      return 4;
    }
    if (videoFormat === "faceless-narrated") {
      if (!voice) return 2;
      return 3;
    }
    // product-scene
    if (!sceneType) return 2;
    if (wantsVoiceover && !script) return 3;
    return 4;
  })();

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // Load saved avatars
  useEffect(() => {
    apiGet<{ avatars: SavedAvatar[] }>("/api/ai/ugc-avatars").then((res) => {
      if (res.ok) setSavedAvatars(res.data.avatars);
    });
  }, []);

  // ── Research ───────────────────────────────────────────────────

  const handleResearch = async () => {
    if (!productId) { toast.error("Select a product first"); return; }
    setResearching(true); setTrends([]); setSelectedTrend(null); setScript(null); setSelectedAvatarUrl(""); setGeneration(null);
    try {
      const res = await apiPost<{ trends: Trend[] }>("/api/ai/tiktok-trends", { productId, focusArea: focusArea || undefined });
      if (res.ok && res.data.trends?.length) { setTrends(res.data.trends); toast.success(`Found ${res.data.trends.length} trends`); }
      else toast.error("No trends found");
    } catch { toast.error("Failed to research trends"); }
    finally { setResearching(false); }
  };

  // ── Script ─────────────────────────────────────────────────────

  const handleWriteScript = async () => {
    setWritingScript(true); setScript(null);
    try {
      const res = await apiPost<UGCScript>("/api/ai/ugc-script", { productId, trendId: selectedTrend?.id, scriptStyle, durationSeconds: scriptDuration });
      if (res.ok) { setScript(res.data); setEditedScript(res.data.script); setCaption(selectedTrend?.hashtags?.join(" ") || ""); toast.success("Script written!"); }
      else toast.error("Failed to write script");
    } catch { toast.error("Failed to write script"); }
    finally { setWritingScript(false); }
  };

  // ── Avatar upload ──────────────────────────────────────────────

  const handleUploadAvatar = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("image", file);
      const uploadRes = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (uploadRes.ok) {
        const url = uploadRes.data.url;
        setSelectedAvatarUrl(url);
        const name = avatarName || file.name.replace(/\.[^.]+$/, '');
        const saveRes = await apiPost<SavedAvatar>("/api/ai/ugc-avatars", { name, imageUrl: url });
        if (saveRes.ok) { setSavedAvatars((prev) => [saveRes.data, ...prev]); }
        toast.success("Avatar uploaded");
        setAvatarName("");
      } else toast.error("Upload failed");
    } catch { toast.error("Upload failed"); }
    finally { setUploading(false); }
  };

  // ── Product image upload ───────────────────────────────────────

  const handleUploadProductImage = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    setUploadingProductImage(true);
    try {
      const fd = new FormData(); fd.append("image", file);
      const uploadRes = await apiUpload<{ ok: boolean; url: string }>("/api/ai/images", fd);
      if (uploadRes.ok) { setProductImageUrl(uploadRes.data.url); toast.success("Product image uploaded"); }
      else toast.error("Upload failed");
    } catch { toast.error("Upload failed"); }
    finally { setUploadingProductImage(false); }
  };

  // ── Generate face ───────────────────────────────────────────────

  const handleGenerateFace = async () => {
    setGeneratingFace(true);
    try {
      const res = await apiPost<SavedAvatar & { imageUrl: string }>("/api/ai/generate-face", {
        name: avatarName || `AI Creator ${savedAvatars.length + 1}`,
        gender: faceGender,
        ageRange: "young adult",
        productId: productId || undefined,
      });
      if (res.ok) {
        setSavedAvatars((prev) => [res.data, ...prev]);
        setSelectedAvatarUrl(res.data.imageUrl);
        setAvatarName("");
        toast.success("Face generated!");
      } else {
        toast.error("Face generation failed");
      }
    } catch { toast.error("Face generation failed"); }
    finally { setGeneratingFace(false); }
  };

  // ── Generate & poll ────────────────────────────────────────────

  const startPolling = useCallback((genId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiGet<VideoGeneration>(`/api/ai/ugc-video/${genId}`);
        if (res.ok) {
          setGeneration(res.data);
          if (res.data.status === "completed" || res.data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null;
            if (res.data.status === "completed") { toast.success("Video ready! Draft post created."); onPostCreated?.(); }
            else toast.error(res.data.errorMessage || "Video generation failed");
          }
        }
      } catch { /* keep polling */ }
    }, 8000);
  }, [onPostCreated]);

  const handleGenerateUGC = async () => {
    if (!editedScript || !selectedAvatarUrl) return;
    setGenerating(true); setGeneration(null);
    try {
      const res = await apiPost<VideoGeneration>("/api/ai/ugc-video", {
        script: editedScript,
        imageUrl: selectedAvatarUrl,
        voice,
        productId: productId || undefined,
        trendId: selectedTrend?.id || undefined,
        caption,
        hashtags: selectedTrend?.hashtags || [],
      });
      if (res.ok) { setGeneration(res.data); toast.success("UGC video generation started"); startPolling(res.data.id); }
      else { const e = res.data as unknown as { error?: string }; toast.error(e.error || "Failed to start"); }
    } catch { toast.error("Failed to start video generation"); }
    finally { setGenerating(false); }
  };

  const handleGenerateScene = async () => {
    setGenerating(true); setGeneration(null);
    try {
      const res = await apiPost<VideoGeneration>("/api/ai/product-scene", {
        productId,
        sceneType,
        avatarImageUrl: selectedAvatarUrl || undefined,
        productImageUrl: productImageUrl || undefined,
        sceneDescription: sceneDescription || undefined,
        provider: "kling",
        durationSeconds: 5,
        voiceover: wantsVoiceover && editedScript ? { script: editedScript, voice, speed: 1.0 } : undefined,
        caption,
        hashtags: selectedTrend?.hashtags || [],
        trendId: selectedTrend?.id || undefined,
      });
      if (res.ok) { setGeneration(res.data); toast.success("Product scene generation started"); startPolling(res.data.id); }
      else { const e = res.data as unknown as { error?: string }; toast.error(e.error || "Failed to start"); }
    } catch { toast.error("Failed to start scene generation"); }
    finally { setGenerating(false); }
  };

  const handleGenerateFaceless = async () => {
    setGenerating(true); setGeneration(null);
    try {
      const res = await apiPost<VideoGeneration>("/api/ai/faceless-video", {
        productId,
        sceneCount: facelessSceneCount,
        durationSeconds: facelessDuration,
        voice,
        speed: 1.0,
        script: editedScript || undefined,
        scriptStyle,
        caption,
        hashtags: selectedTrend?.hashtags || [],
        trendId: selectedTrend?.id || undefined,
      });
      if (res.ok) { setGeneration(res.data); toast.success("Faceless video generation started"); startPolling(res.data.id); }
      else { const e = res.data as unknown as { error?: string }; toast.error(e.error || "Failed to start"); }
    } catch { toast.error("Failed to start faceless video generation"); }
    finally { setGenerating(false); }
  };

  const handleGenerate = videoFormat === "ugc" ? handleGenerateUGC : videoFormat === "product-scene" ? handleGenerateScene : handleGenerateFaceless;

  const handleReset = () => {
    setTrends([]); setSelectedTrend(null); setScript(null); setEditedScript("");
    setSelectedAvatarUrl(""); setCaption(""); setGeneration(null);
    setSceneDescription(""); setProductImageUrl(""); setWantsVoiceover(false);
    setWizardStep(1);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  // Can we proceed to generate?
  const canGenerate = videoFormat === "ugc"
    ? !!(selectedAvatarUrl && script)
    : videoFormat === "product-scene"
    ? !!(selectedTrend && sceneType && (!wantsVoiceover || editedScript))
    : !!(selectedTrend && voice);

  // Determine if the user can proceed from each wizard step
  const canProceedFromStep = (step: number): boolean => {
    if (step === 0) return !!productId;
    if (step === 1) return !!selectedTrend;
    if (videoFormat === "ugc") {
      if (step === 2) return !!script;
      if (step === 3) return !!selectedAvatarUrl;
    } else if (videoFormat === "product-scene") {
      if (step === 2) return !!sceneType;
      if (step === 3) return !wantsVoiceover || !!editedScript;
    } else {
      // faceless-narrated
      if (step === 2) return !!voice;
    }
    return true;
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <StepIndicator step={currentStep} labels={stepLabels} />

      {/* ── Step 0: Product & Format ──────────────────────────── */}
      {wizardStep === 0 && (
        <>
          <ProductPicker value={productId} onChange={setProductId} />

          {productId && (
            <>
              {/* Format selector */}
              <div className="space-y-3">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Video Format</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => { setVideoFormat("ugc"); handleReset(); }}
                    className={`text-left p-4 rounded-xl border transition-all ${videoFormat === "ugc" ? "border-foreground bg-foreground/5 shadow-sm" : "border-border/50 hover:border-foreground/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <User className="w-4 h-4" />
                      <span className="text-sm font-medium">UGC Talking Head</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">AI avatar speaks your script with lip sync</p>
                  </button>
                  <button
                    onClick={() => { setVideoFormat("product-scene"); handleReset(); }}
                    className={`text-left p-4 rounded-xl border transition-all ${videoFormat === "product-scene" ? "border-foreground bg-foreground/5 shadow-sm" : "border-border/50 hover:border-foreground/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Package className="w-4 h-4" />
                      <span className="text-sm font-medium">Product Scene</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Character interacting with your product, animated into video</p>
                  </button>
                  <button
                    onClick={() => { setVideoFormat("faceless-narrated"); handleReset(); }}
                    className={`text-left p-4 rounded-xl border transition-all ${videoFormat === "faceless-narrated" ? "border-foreground bg-foreground/5 shadow-sm" : "border-border/50 hover:border-foreground/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Film className="w-4 h-4" />
                      <span className="text-sm font-medium">Faceless Narrated</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Cinematic B-roll visuals with voiceover narration</p>
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={() => setWizardStep(1)} className="h-11 text-sm font-medium px-6">
                  Next: {stepLabels[1]} <ChevronRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Step 1: Research & Select Trend ───────────────────── */}
      {wizardStep === 1 && (
        <>
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Focus Area (optional)</label>
            <Textarea placeholder='"testimonials", "humor", "day in the life"...' value={focusArea} onChange={(e) => setFocusArea(e.target.value)} rows={2} className="resize-none" />
            <Button onClick={handleResearch} disabled={researching} className="w-full h-11 text-sm font-medium">
              {researching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Researching...</> : <><Sparkles className="w-4 h-4 mr-2" />Research Viral Trends</>}
            </Button>
          </div>

          {trends.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Select a Trend</label>
                <button onClick={handleReset} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />Reset</button>
              </div>
              <div className="space-y-2">
                {trends.map((t) => <TrendCard key={t.id} trend={t} selected={selectedTrend?.id === t.id} onSelect={() => { setSelectedTrend(t); setScript(null); setSelectedAvatarUrl(""); setGeneration(null); }} />)}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setWizardStep(0)} className="h-11 text-sm font-medium px-6">
              Back
            </Button>
            <Button onClick={() => setWizardStep(2)} disabled={!canProceedFromStep(1)} className="h-11 text-sm font-medium px-6">
              Next: {stepLabels[2]} <ChevronRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </>
      )}

      {/* ── Step 2: Script / Scene Setup / Script & Voice ─────── */}
      {wizardStep === 2 && (
        <>
          {/* UGC: Script step */}
          {videoFormat === "ugc" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">UGC Script</label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SCRIPT_STYLES.map((s) => (
                  <button key={s.value} onClick={() => setScriptStyle(s.value)} className={`text-left p-3 rounded-lg border text-xs transition-all ${scriptStyle === s.value ? "border-foreground bg-foreground/5" : "border-border/50 text-muted-foreground hover:border-foreground/30"}`}>
                    <p className="font-medium text-foreground">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground">Duration:</label>
                {[15, 30, 45, 60].map((d) => (
                  <button key={d} onClick={() => setScriptDuration(d)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${scriptDuration === d ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{d}s</button>
                ))}
              </div>

              <Button onClick={handleWriteScript} disabled={writingScript} className="w-full h-11 text-sm font-medium">
                {writingScript ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Writing Script...</> : <><FileText className="w-4 h-4 mr-2" />Write UGC Script</>}
              </Button>

              {script && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/40 p-3 bg-muted/30">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Hook Line</p>
                    <p className="text-sm font-medium">{script.hookLine}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">Full Script (editable)</label>
                      <button onClick={handleWriteScript} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />Rewrite</button>
                    </div>
                    <Textarea value={editedScript} onChange={(e) => setEditedScript(e.target.value)} rows={6} className="resize-none text-sm font-mono" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Product Scene: Scene Setup step */}
          {videoFormat === "product-scene" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scene Setup</label>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Scene Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SCENE_TYPES.map((s) => (
                    <button key={s.value} onClick={() => setSceneType(s.value)} className={`text-left p-3 rounded-lg border text-xs transition-all ${sceneType === s.value ? "border-foreground bg-foreground/5" : "border-border/50 text-muted-foreground hover:border-foreground/30"}`}>
                      <p className="font-medium text-foreground">{s.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Product Photo (optional)</label>
                <div className="flex items-center gap-3">
                  {productImageUrl && (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-border/60">
                      <img src={productImageUrl} alt="Product" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => productImageInputRef.current?.click()} disabled={uploadingProductImage}>
                    {uploadingProductImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5 mr-1.5" />{productImageUrl ? "Replace" : "Upload Product Photo"}</>}
                  </Button>
                  <input ref={productImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadProductImage(f); e.target.value = ""; }} />
                </div>
                <p className="text-[10px] text-muted-foreground/60">Upload a clear photo of your product for better visual accuracy.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Character (optional)</label>
                {savedAvatars.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {savedAvatars.map((a) => (
                      <button key={a.id} onClick={() => setSelectedAvatarUrl(selectedAvatarUrl === a.imageUrl ? "" : a.imageUrl)} className={`relative rounded-lg overflow-hidden border-2 transition-all ${selectedAvatarUrl === a.imageUrl ? "border-foreground shadow-md" : "border-transparent hover:border-foreground/30"}`}>
                        <img src={a.imageUrl} alt={a.name} className="w-full aspect-square object-cover" loading="lazy" />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                          <p className="text-white text-[9px] font-medium truncate">{a.name}</p>
                        </div>
                        {selectedAvatarUrl === a.imageUrl && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-foreground flex items-center justify-center"><CheckCircle2 className="w-2.5 h-2.5 text-background" /></div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <div className="flex rounded-md border border-border/60 overflow-hidden">
                    {(["female", "male"] as const).map((g) => (
                      <button key={g} onClick={() => setFaceGender(g)} className={`px-3 py-1.5 text-[11px] transition-all ${faceGender === g ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                        {g === "female" ? "Female" : "Male"}
                      </button>
                    ))}
                  </div>
                  <Button variant="default" size="sm" className="h-9 text-xs" onClick={handleGenerateFace} disabled={generatingFace}>
                    {generatingFace ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate AI Face</>}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground font-medium">Custom Scene Description (optional)</label>
                <Textarea value={sceneDescription} onChange={(e) => setSceneDescription(e.target.value)} rows={3} placeholder='e.g. "Woman lifting the serum bottle from a marble countertop, soft morning light..."' className="resize-none text-sm" />
              </div>
            </div>
          )}

          {/* Faceless Narrated: Script & Voice step */}
          {videoFormat === "faceless-narrated" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Script & Voice</label>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Scenes:</label>
                  <div className="flex gap-1.5">
                    {[3, 4, 5, 6].map((n) => (
                      <button key={n} onClick={() => setFacelessSceneCount(n)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${facelessSceneCount === n ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{n}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Duration:</label>
                  <div className="flex gap-1.5">
                    {[15, 30, 45, 60].map((d) => (
                      <button key={d} onClick={() => setFacelessDuration(d)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${facelessDuration === d ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{d}s</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Narration Style</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SCRIPT_STYLES.map((s) => (
                    <button key={s.value} onClick={() => setScriptStyle(s.value)} className={`text-left p-3 rounded-lg border text-xs transition-all ${scriptStyle === s.value ? "border-foreground bg-foreground/5" : "border-border/50 text-muted-foreground hover:border-foreground/30"}`}>
                      <p className="font-medium text-foreground">{s.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground font-medium">Custom Script (optional)</label>
                <Textarea value={editedScript} onChange={(e) => setEditedScript(e.target.value)} rows={4} placeholder="Leave empty for AI-generated narration, or write your own..." className="resize-none text-sm" />
                <p className="text-[10px] text-muted-foreground/60">If left empty, AI will write the narration and generate matching visuals automatically.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Narrator Voice</label>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground/60">Female</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VOICES.female.map((v) => (
                      <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 pt-1">Male</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VOICES.male.map((v) => (
                      <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setWizardStep(1)} className="h-11 text-sm font-medium px-6">
              Back
            </Button>
            <Button onClick={() => setWizardStep(3)} disabled={!canProceedFromStep(2)} className="h-11 text-sm font-medium px-6">
              Next: {stepLabels[3]} <ChevronRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </>
      )}

      {/* ── Step 3: Avatar & Voice / Voiceover / Generate ─────── */}
      {wizardStep === 3 && (
        <>
          {/* UGC: Avatar & Voice step */}
          {videoFormat === "ugc" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Avatar Face & Voice</label>
              </div>

              {savedAvatars.length > 0 && (
                <div className="space-y-2">
                  <label className="text-[11px] text-muted-foreground">Your Avatars</label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {savedAvatars.map((a) => (
                      <button key={a.id} onClick={() => setSelectedAvatarUrl(a.imageUrl)} className={`relative rounded-lg overflow-hidden border-2 transition-all ${selectedAvatarUrl === a.imageUrl ? "border-foreground shadow-md" : "border-transparent hover:border-foreground/30"}`}>
                        <img src={a.imageUrl} alt={a.name} className="w-full aspect-square object-cover" loading="lazy" />
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                          <p className="text-white text-[9px] font-medium truncate">{a.name}</p>
                        </div>
                        {selectedAvatarUrl === a.imageUrl && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-foreground flex items-center justify-center"><CheckCircle2 className="w-2.5 h-2.5 text-background" /></div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[11px] text-muted-foreground font-medium">Add New Creator</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="Creator name..." value={avatarName} onChange={(e) => setAvatarName(e.target.value)} className="flex-1 h-9 rounded-lg border border-border/60 bg-background px-3 text-xs" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex rounded-md border border-border/60 overflow-hidden">
                    {(["female", "male"] as const).map((g) => (
                      <button key={g} onClick={() => setFaceGender(g)} className={`px-3 py-1.5 text-[11px] transition-all ${faceGender === g ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                        {g === "female" ? "Female" : "Male"}
                      </button>
                    ))}
                  </div>
                  <Button variant="default" size="sm" className="h-9 text-xs flex-1 min-w-35" onClick={handleGenerateFace} disabled={generatingFace}>
                    {generatingFace ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate AI Face</>}
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload</>}
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadAvatar(f); e.target.value = ""; }} />
                <p className="text-[10px] text-muted-foreground/60">Generate a realistic AI face or upload your own. Clear, front-facing, good lighting.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-muted-foreground font-medium">Voice</label>
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground/60">Female</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VOICES.female.map((v) => (
                      <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 pt-1">Male</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VOICES.male.map((v) => (
                      <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Product Scene: Voiceover step */}
          {videoFormat === "product-scene" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-muted-foreground" />
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Voiceover</label>
                </div>
                <button
                  onClick={() => setWantsVoiceover(!wantsVoiceover)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${wantsVoiceover ? "bg-foreground" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-background shadow-sm transition-transform ${wantsVoiceover ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>

              {wantsVoiceover && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {SCRIPT_STYLES.map((s) => (
                      <button key={s.value} onClick={() => setScriptStyle(s.value)} className={`text-left p-3 rounded-lg border text-xs transition-all ${scriptStyle === s.value ? "border-foreground bg-foreground/5" : "border-border/50 text-muted-foreground hover:border-foreground/30"}`}>
                        <p className="font-medium text-foreground">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-muted-foreground">Duration:</label>
                    {[15, 30, 45, 60].map((d) => (
                      <button key={d} onClick={() => setScriptDuration(d)} className={`px-3 py-1.5 rounded-md text-xs transition-all ${scriptDuration === d ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{d}s</button>
                    ))}
                  </div>

                  <Button onClick={handleWriteScript} disabled={writingScript} className="w-full h-11 text-sm font-medium">
                    {writingScript ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Writing Script...</> : <><FileText className="w-4 h-4 mr-2" />Write Voiceover Script</>}
                  </Button>

                  {script && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-muted-foreground">Script (editable)</label>
                          <button onClick={handleWriteScript} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" />Rewrite</button>
                        </div>
                        <Textarea value={editedScript} onChange={(e) => setEditedScript(e.target.value)} rows={4} className="resize-none text-sm font-mono" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[11px] text-muted-foreground font-medium">Voice</label>
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground/60">Female</p>
                      <div className="flex flex-wrap gap-1.5">
                        {VOICES.female.map((v) => (
                          <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 pt-1">Male</p>
                      <div className="flex flex-wrap gap-1.5">
                        {VOICES.male.map((v) => (
                          <button key={v.id} onClick={() => setVoice(v.id)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v.id ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!wantsVoiceover && (
                <p className="text-[11px] text-muted-foreground/60">Video will be generated without voiceover. You can add audio later in your editor.</p>
              )}
            </div>
          )}

          {/* Faceless Narrated: this is the Generate step (step 3 = last step) */}
          {videoFormat === "faceless-narrated" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">TikTok Caption</label>
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="Caption with hashtags..." className="resize-none text-sm" />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="px-2 py-1 rounded bg-muted">Kling Multi-Shot + Kokoro TTS + FFmpeg Merge</span>
                <span>720p</span>
                <span>9:16</span>
              </div>

              <Button onClick={handleGenerate} disabled={generating || generation?.status === "generating"} className="w-full h-12 text-sm font-medium">
                {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : <><Video className="w-4 h-4 mr-2" />Generate Faceless Video</>}
              </Button>

              {generation && (
                <div className="rounded-xl border border-border/50 p-5 space-y-4">
                  {generation.status === "generating" && (
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <div><p className="text-sm font-medium">Generating video...</p><p className="text-xs text-muted-foreground">Takes 2-5 minutes. You can leave — it completes in the background.</p></div>
                    </div>
                  )}
                  {generation.status === "completed" && generation.videoUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /><p className="text-sm font-medium">Video ready!</p></div>
                      <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "9/16", maxHeight: "480px" }}>
                        <video src={generation.videoUrl} controls className="w-full h-full object-contain" />
                      </div>
                      {generation.postId && <p className="text-xs text-muted-foreground">Draft post created — find it in the Drafts tab.</p>}
                    </div>
                  )}
                  {generation.status === "failed" && (
                    <div className="flex items-center gap-3">
                      <XCircle className="w-5 h-5 text-red-500" />
                      <div><p className="text-sm font-medium">Generation failed</p><p className="text-xs text-muted-foreground">{generation.errorMessage}</p></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setWizardStep(2)} className="h-11 text-sm font-medium px-6">
              Back
            </Button>
            {/* UGC and product-scene have a next step; faceless generate is already shown above */}
            {(videoFormat === "ugc" || videoFormat === "product-scene") && (
              <Button onClick={() => setWizardStep(4)} disabled={!canProceedFromStep(3)} className="h-11 text-sm font-medium px-6">
                Next: {stepLabels[4]} <ChevronRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── Step 4: Generate (UGC & Product Scene only) ──────── */}
      {wizardStep === 4 && (videoFormat === "ugc" || videoFormat === "product-scene") && (
        <>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">TikTok Caption</label>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="Caption with hashtags..." className="resize-none text-sm" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {videoFormat === "ugc" ? (
                <span className="px-2 py-1 rounded bg-muted">Kokoro TTS + Kling Avatar</span>
              ) : (
                <span className="px-2 py-1 rounded bg-muted">Gemini Scene + Kling Image-to-Video{wantsVoiceover ? " + Kokoro TTS" : ""}</span>
              )}
              <span>720p</span>
              <span>9:16</span>
            </div>

            <Button onClick={handleGenerate} disabled={generating || generation?.status === "generating"} className="w-full h-12 text-sm font-medium">
              {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : <><Video className="w-4 h-4 mr-2" />{videoFormat === "ugc" ? "Generate UGC Video" : "Generate Product Scene"}</>}
            </Button>

            {generation && (
              <div className="rounded-xl border border-border/50 p-5 space-y-4">
                {generation.status === "generating" && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <div><p className="text-sm font-medium">Generating video...</p><p className="text-xs text-muted-foreground">Takes 2-5 minutes. You can leave — it completes in the background.</p></div>
                  </div>
                )}
                {generation.status === "completed" && generation.videoUrl && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /><p className="text-sm font-medium">Video ready!</p></div>
                    <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "9/16", maxHeight: "480px" }}>
                      <video src={generation.videoUrl} controls className="w-full h-full object-contain" />
                    </div>
                    {generation.postId && <p className="text-xs text-muted-foreground">Draft post created — find it in the Drafts tab.</p>}
                  </div>
                )}
                {generation.status === "failed" && (
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-red-500" />
                    <div><p className="text-sm font-medium">Generation failed</p><p className="text-xs text-muted-foreground">{generation.errorMessage}</p></div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-start pt-4">
            <Button variant="outline" onClick={() => setWizardStep(3)} className="h-11 text-sm font-medium px-6">
              Back
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
