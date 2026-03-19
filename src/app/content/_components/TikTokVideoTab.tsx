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
  Mic,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────

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
};

const SCRIPT_STYLES = [
  { value: "problem-solution", label: "Problem → Solution", desc: "Relatable pain point, then the fix" },
  { value: "testimonial", label: "Testimonial", desc: "Personal experience story" },
  { value: "review", label: "Honest Review", desc: "Candid first impression" },
  { value: "routine", label: "Routine", desc: "Product in daily life" },
  { value: "comparison", label: "Comparison", desc: "Before vs. after switching" },
];

const VOICES = [
  "Aria", "Sarah", "Laura", "Charlotte", "Alice", "Jessica", "Lily",
  "Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Brian", "Daniel",
];

// ── Step indicator ─────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = ["Product", "Trends", "Script", "Avatar & Voice", "Generate"];
  return (
    <div className="flex items-center gap-1.5 mb-8 overflow-x-auto">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5 shrink-0">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all ${
            i < step ? "bg-foreground text-background" : i === step ? "bg-foreground text-background ring-2 ring-foreground/20 ring-offset-2 ring-offset-background" : "bg-muted text-muted-foreground"
          }`}>
            {i < step ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
          </div>
          <span className={`text-[11px] font-medium ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/30" />}
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

  // Trends
  const [trends, setTrends] = useState<Trend[]>([]);
  const [researching, setResearching] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [focusArea, setFocusArea] = useState("");

  // Script
  const [scriptStyle, setScriptStyle] = useState("problem-solution");
  const [scriptDuration, setScriptDuration] = useState(30);
  const [writingScript, setWritingScript] = useState(false);
  const [script, setScript] = useState<UGCScript | null>(null);
  const [editedScript, setEditedScript] = useState("");

  // Avatar & Voice
  const [savedAvatars, setSavedAvatars] = useState<SavedAvatar[]>([]);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState("");
  const [voice, setVoice] = useState("Aria");
  const [uploading, setUploading] = useState(false);
  const [avatarName, setAvatarName] = useState("");
  const [generatingFace, setGeneratingFace] = useState(false);
  const [faceGender, setFaceGender] = useState<"male" | "female">("female");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate
  const [caption, setCaption] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<VideoGeneration | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentStep = !productId ? 0 : !selectedTrend ? 1 : !script ? 2 : !selectedAvatarUrl ? 3 : 4;

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
        // Save to workspace avatars
        const name = avatarName || file.name.replace(/\.[^.]+$/, '');
        const saveRes = await apiPost<SavedAvatar>("/api/ai/ugc-avatars", { name, imageUrl: url });
        if (saveRes.ok) { setSavedAvatars((prev) => [saveRes.data, ...prev]); }
        toast.success("Avatar uploaded");
        setAvatarName("");
      } else toast.error("Upload failed");
    } catch { toast.error("Upload failed"); }
    finally { setUploading(false); }
  };

  // ── Generate face ───────────────────────────────────────────────

  const handleGenerateFace = async () => {
    setGeneratingFace(true);
    try {
      const res = await apiPost<SavedAvatar & { imageUrl: string }>("/api/ai/generate-face", {
        name: avatarName || `AI Creator ${savedAvatars.length + 1}`,
        gender: faceGender,
        ageRange: "young adult",
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
            if (res.data.status === "completed") { toast.success("UGC video ready! Draft post created."); onPostCreated?.(); }
            else toast.error(res.data.errorMessage || "Video generation failed");
          }
        }
      } catch { /* keep polling */ }
    }, 8000);
  }, [onPostCreated]);

  const handleGenerate = async () => {
    if (!editedScript || !selectedAvatarUrl) return;
    setGenerating(true); setGeneration(null);
    try {
      const res = await apiPost<VideoGeneration>("/api/ai/ugc-video", {
        script: editedScript,
        imageUrl: selectedAvatarUrl,
        voice,
        scenePrompt: "A person talking directly to the camera in a casual, authentic TikTok-style video.",
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

  const handleReset = () => {
    setTrends([]); setSelectedTrend(null); setScript(null); setEditedScript("");
    setSelectedAvatarUrl(""); setCaption(""); setGeneration(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <StepIndicator step={currentStep} />

      <ProductPicker value={productId} onChange={setProductId} />

      {productId && (
        <>
          {/* Research */}
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Focus Area (optional)</label>
            <Textarea placeholder='"testimonials", "humor", "day in the life"...' value={focusArea} onChange={(e) => setFocusArea(e.target.value)} rows={2} className="resize-none" />
            <Button onClick={handleResearch} disabled={researching} className="w-full h-11 text-sm font-medium">
              {researching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Researching...</> : <><Sparkles className="w-4 h-4 mr-2" />Research Viral Trends</>}
            </Button>
          </div>

          {/* Trends */}
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

          {/* Script */}
          {selectedTrend && (
            <div className="space-y-4 border-t border-border/30 pt-6">
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

              <div className="flex items-center gap-3">
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

          {/* Avatar & Voice */}
          {script && (
            <div className="space-y-4 border-t border-border/30 pt-6">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Avatar Face & Voice</label>
              </div>

              {/* Saved avatars */}
              {savedAvatars.length > 0 && (
                <div className="space-y-2">
                  <label className="text-[11px] text-muted-foreground">Your Avatars</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
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

              {/* Generate AI face or upload */}
              <div className="space-y-3">
                <label className="text-[11px] text-muted-foreground font-medium">Add New Creator</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="Creator name..." value={avatarName} onChange={(e) => setAvatarName(e.target.value)} className="flex-1 h-9 rounded-lg border border-border/60 bg-background px-3 text-xs" />
                </div>
                <div className="flex gap-2">
                  {/* Gender toggle for face gen */}
                  <div className="flex rounded-md border border-border/60 overflow-hidden">
                    {(["female", "male"] as const).map((g) => (
                      <button key={g} onClick={() => setFaceGender(g)} className={`px-3 py-1.5 text-[11px] transition-all ${faceGender === g ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                        {g === "female" ? "Female" : "Male"}
                      </button>
                    ))}
                  </div>
                  <Button variant="default" size="sm" className="h-9 text-xs flex-1" onClick={handleGenerateFace} disabled={generatingFace}>
                    {generatingFace ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate AI Face</>}
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Upload className="w-3.5 h-3.5 mr-1.5" />Upload</>}
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadAvatar(f); e.target.value = ""; }} />
                <p className="text-[10px] text-muted-foreground/60">Generate a realistic AI face or upload your own. Clear, front-facing, good lighting.</p>
              </div>

              {/* Voice picker */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-muted-foreground" />
                  <label className="text-[11px] text-muted-foreground">Voice</label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {VOICES.map((v) => (
                    <button key={v} onClick={() => setVoice(v)} className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${voice === v ? "bg-foreground text-background font-medium" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{v}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Generate */}
          {selectedAvatarUrl && script && (
            <div className="space-y-4 border-t border-border/30 pt-6">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">TikTok Caption</label>
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="Caption with hashtags..." className="resize-none text-sm" />
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="px-2 py-1 rounded bg-muted">MultiTalk (fal.ai)</span>
                <span>Voice: {voice}</span>
                <span>720p</span>
                <span>9:16</span>
              </div>

              <Button onClick={handleGenerate} disabled={generating || generation?.status === "generating"} className="w-full h-12 text-sm font-medium">
                {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : <><Video className="w-4 h-4 mr-2" />Generate UGC Video</>}
              </Button>

              {generation && (
                <div className="rounded-xl border border-border/50 p-5 space-y-4">
                  {generation.status === "generating" && (
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <div><p className="text-sm font-medium">Generating UGC video...</p><p className="text-xs text-muted-foreground">Takes 2-5 minutes. You can leave — it completes in the background.</p></div>
                    </div>
                  )}
                  {generation.status === "completed" && generation.videoUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /><p className="text-sm font-medium">UGC video ready!</p></div>
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
        </>
      )}
    </div>
  );
}
