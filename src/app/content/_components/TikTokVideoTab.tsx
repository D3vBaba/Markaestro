"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, apiGet } from "@/lib/api-client";
import { toast } from "sonner";
import ProductPicker from "./ProductPicker";
import {
  Sparkles,
  Video,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  ChevronRight,
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
  videoPromptSuggestion?: string;
  status: string;
};

type VideoGeneration = {
  id: string;
  status: "pending" | "generating" | "completed" | "failed";
  videoUrl: string;
  thumbnailUrl: string;
  caption: string;
  hashtags: string[];
  errorMessage: string;
  postId?: string;
  provider: string;
};

// ── Step indicator ─────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = ["Select Product", "Research Trends", "Generate Video"];
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
              i < step
                ? "bg-foreground text-background"
                : i === step
                ? "bg-foreground text-background ring-2 ring-foreground/20 ring-offset-2 ring-offset-background"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
          </div>
          <span
            className={`text-xs font-medium ${
              i <= step ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </span>
          {i < steps.length - 1 && (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Trend card ─────────────────────────────────────────────────────

function TrendCard({
  trend,
  selected,
  onSelect,
}: {
  trend: Trend;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        selected
          ? "border-foreground bg-foreground/5 shadow-sm"
          : "border-border/50 hover:border-foreground/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <h4 className="text-sm font-medium">{trend.name}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {trend.description}
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            <span className="font-medium">Format:</span> {trend.format}
          </p>
          {trend.hooks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {trend.hooks.map((hook, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {hook}
                </span>
              ))}
            </div>
          )}
          {trend.hashtags.length > 0 && (
            <p className="text-[11px] text-muted-foreground/60 pt-1">
              {trend.hashtags.slice(0, 5).join(" ")}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Viral</span>
            <span className="text-xs font-semibold tabular-nums">
              {trend.viralityScore}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Fit</span>
            <span className="text-xs font-semibold tabular-nums">
              {trend.relevanceScore}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────

export default function TikTokVideoTab({
  onPostCreated,
}: {
  onPostCreated?: () => void;
}) {
  // Step 1: Product
  const [productId, setProductId] = useState("");

  // Step 2: Trends
  const [trends, setTrends] = useState<Trend[]>([]);
  const [researching, setResearching] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [focusArea, setFocusArea] = useState("");

  // Step 3: Video generation
  const [videoPrompt, setVideoPrompt] = useState("");
  const [caption, setCaption] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<VideoGeneration | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentStep = !productId ? 0 : trends.length === 0 && !researching ? 1 : 2;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Research trends ────────────────────────────────────────────

  const handleResearch = async () => {
    if (!productId) {
      toast.error("Select a product first");
      return;
    }
    setResearching(true);
    setTrends([]);
    setSelectedTrend(null);
    setGeneration(null);
    try {
      const res = await apiPost<{ trends: Trend[] }>("/api/ai/tiktok-trends", {
        productId,
        focusArea: focusArea || undefined,
      });
      if (res.ok && res.data.trends?.length) {
        setTrends(res.data.trends);
        toast.success(`Found ${res.data.trends.length} trends`);
      } else {
        toast.error("No trends found — try a different focus area");
      }
    } catch {
      toast.error("Failed to research trends");
    } finally {
      setResearching(false);
    }
  };

  // ── Select trend ───────────────────────────────────────────────

  const handleSelectTrend = (trend: Trend) => {
    setSelectedTrend(trend);
    setVideoPrompt(trend.videoPromptSuggestion || "");
    const tags = trend.hashtags.length > 0 ? trend.hashtags.join(" ") : "";
    setCaption(tags);
  };

  // ── Poll for video completion ──────────────────────────────────

  const startPolling = useCallback(
    (genId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const res = await apiGet<VideoGeneration>(
            `/api/ai/video-status/${genId}`
          );
          if (res.ok) {
            setGeneration(res.data);
            if (
              res.data.status === "completed" ||
              res.data.status === "failed"
            ) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              if (res.data.status === "completed") {
                toast.success("Video generated! Draft post created.");
                onPostCreated?.();
              } else {
                toast.error(
                  res.data.errorMessage || "Video generation failed"
                );
              }
            }
          }
        } catch {
          // Keep polling on transient errors
        }
      }, 8000);
    },
    [onPostCreated]
  );

  // ── Generate video ─────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!videoPrompt) {
      toast.error("Enter a video prompt");
      return;
    }
    setGenerating(true);
    setGeneration(null);
    try {
      const res = await apiPost<VideoGeneration>("/api/ai/generate-video", {
        prompt: videoPrompt,
        productId: productId || undefined,
        trendId: selectedTrend?.id || undefined,
        provider: "kling",
        durationSeconds: 5,
        caption,
        hashtags: selectedTrend?.hashtags || [],
      });
      if (res.ok) {
        setGeneration(res.data);
        toast.success("Video generation started — this takes 1-3 minutes");
        startPolling(res.data.id);
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Failed to start video generation");
      }
    } catch {
      toast.error("Failed to start video generation");
    } finally {
      setGenerating(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────

  const handleReset = () => {
    setTrends([]);
    setSelectedTrend(null);
    setVideoPrompt("");
    setCaption("");
    setGeneration(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <StepIndicator step={currentStep} />

      {/* Step 1: Product */}
      <ProductPicker value={productId} onChange={setProductId} />

      {productId && (
        <>
          {/* Research section */}
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Focus Area (optional)
            </label>
            <Textarea
              placeholder='e.g. "tutorials", "humor", "before/after transformations", "day in the life"...'
              value={focusArea}
              onChange={(e) => setFocusArea(e.target.value)}
              rows={2}
              className="resize-none"
            />
            <Button
              onClick={handleResearch}
              disabled={researching}
              className="w-full h-11 text-sm font-medium"
            >
              {researching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Researching TikTok Trends...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Research Viral Trends
                </>
              )}
            </Button>
          </div>

          {/* Step 2: Trend results */}
          {trends.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Select a Trend
                </label>
                <button
                  onClick={handleReset}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Research Again
                </button>
              </div>
              <div className="space-y-2">
                {trends.map((trend) => (
                  <TrendCard
                    key={trend.id}
                    trend={trend}
                    selected={selectedTrend?.id === trend.id}
                    onSelect={() => handleSelectTrend(trend)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Video generation */}
          {selectedTrend && (
            <div className="space-y-4 border-t border-border/30 pt-6">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Video Prompt
              </label>
              <Textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={5}
                placeholder="Describe the video scene-by-scene..."
                className="resize-none text-sm"
              />

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Caption
                </label>
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={2}
                  placeholder="TikTok caption with hashtags..."
                  className="resize-none text-sm"
                />
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="px-2 py-1 rounded bg-muted">Kling 2.6 Pro</span>
                <span>5 seconds</span>
                <span>9:16 vertical</span>
                <span>~$0.55</span>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={generating || generation?.status === "generating"}
                className="w-full h-12 text-sm font-medium"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Video className="w-4 h-4 mr-2" />
                    Generate TikTok Video
                  </>
                )}
              </Button>

              {/* Generation status */}
              {generation && (
                <div className="rounded-xl border border-border/50 p-5 space-y-4">
                  {generation.status === "generating" && (
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-foreground" />
                      <div>
                        <p className="text-sm font-medium">Generating video...</p>
                        <p className="text-xs text-muted-foreground">
                          This usually takes 1-3 minutes. You can leave this page — the video will complete in the background.
                        </p>
                      </div>
                    </div>
                  )}

                  {generation.status === "completed" && generation.videoUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <p className="text-sm font-medium">Video ready!</p>
                      </div>
                      <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "9/16", maxHeight: "480px" }}>
                        <video
                          src={generation.videoUrl}
                          controls
                          className="w-full h-full object-contain"
                          poster={generation.thumbnailUrl || undefined}
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
                          <Play className="w-12 h-12 text-white/80" />
                        </div>
                      </div>
                      {generation.postId && (
                        <p className="text-xs text-muted-foreground">
                          Draft post created — find it in the Drafts tab to review and publish.
                        </p>
                      )}
                    </div>
                  )}

                  {generation.status === "failed" && (
                    <div className="flex items-center gap-3">
                      <XCircle className="w-5 h-5 text-red-500" />
                      <div>
                        <p className="text-sm font-medium">Generation failed</p>
                        <p className="text-xs text-muted-foreground">
                          {generation.errorMessage || "Unknown error"}
                        </p>
                      </div>
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
