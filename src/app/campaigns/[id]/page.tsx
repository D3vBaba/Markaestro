"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import ProductPicker from "@/app/content/_components/ProductPicker";
import MediaUploader from "../_components/MediaUploader";
import StandardCampaignView from "../_components/StandardCampaignView";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import { pillStyle, type PillTone } from "@/components/mk/pills";

type PipelinePost = {
  id: string;
  content: string;
  pipelineStage: string;
  pipelineSequence: number;
  pipelineTheme: string;
  status: string;
  scheduledAt?: string | null;
  mediaUrls?: string[];
  targetChannels?: string[];
};

type PipelineData = {
  campaignId: string;
  campaignName: string;
  pipelineStatus: string | null;
  configDirty: boolean;
  configDirtyReason: string | null;
  activeRunId: string | null;
  latestRunId: string | null;
  scheduledRunId: string | null;
  pipelineConfig: {
    channels: string[];
    cadence: string;
    postCount: number;
    startDate: string;
    stages?: string[];
    postTimeHourUTC?: number;
  } | null;
  researchBrief: {
    competitors: Array<{ name: string; positioning: string; strengths: string; weaknesses: string }>;
    trends: Array<{ trend: string; relevance: string; contentAngle: string }>;
    productInsights: {
      keyMessages: string[];
      uniqueValueProp: string;
      audiencePainPoints: string[];
      toneRecommendations: string;
    };
  } | null;
  stages: Record<string, PipelinePost[]>;
  totalPosts: number;
  statusCounts: Record<string, number>;
};

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  productId?: string;
  channel?: string;
  targetAudience?: string;
  cta?: string;
  body?: string;
  subject?: string;
  scheduledAt?: string | null;
  mediaUrls?: string[];
  createdAt?: string;
  updatedAt?: string;
  pipelineStatus?: string;
  configDirty?: boolean;
  configDirtyReason?: string | null;
  configVersion?: number;
  activeRunId?: string | null;
  latestRunId?: string | null;
  scheduledRunId?: string | null;
  pipeline?: {
    channels: string[];
    cadence: string;
    postCount: number;
    startDate: string;
    stages?: string[];
    postTimeHourUTC?: number;
  };
};

type GenerationRunSummary = {
  id: string;
  status: string;
  operationType: string;
  configVersion: number;
  createdAt: string;
  itemCounts?: {
    total: number;
    imagesGenerated: number;
    imagesFailed?: number;
    imageErrorSamples?: string[];
  };
  isActive: boolean;
  isScheduled: boolean;
};

// Stages use distinct hues at identical lightness/chroma so they harmonize
// with the Markaestro token system instead of jumping between tailwind pastels.
const stageTint = (hue: number) => ({
  background: `oklch(0.96 0.04 ${hue})`,
  color: `oklch(0.38 0.1 ${hue})`,
});

const stageConfig: Record<string, { label: string; style: React.CSSProperties; description: string }> = {
  awareness:     { label: "Awareness",     style: stageTint(20),  description: "Problem-aware content — make audience feel seen" },
  interest:      { label: "Interest",      style: stageTint(55),  description: "Educational content — introduce the solution category" },
  consideration: { label: "Consideration", style: stageTint(85),  description: "Product positioning — features & comparisons" },
  trial:         { label: "Trial",         style: stageTint(145), description: "Drive sign-ups — urgency & social proof" },
  activation:    { label: "Activation",    style: stageTint(240), description: "Onboarding tips — help users succeed quickly" },
  retention:     { label: "Retention",     style: stageTint(295), description: "Advanced value — success stories & community" },
};

const cadenceLabels: Record<string, string> = {
  daily: "Daily",
  "3x_week": "3x / week (Mon, Wed, Fri)",
  "2x_week": "2x / week (Tue, Thu)",
  weekly: "Weekly (Monday)",
};

const channelLabels: Record<string, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

const socialChannels = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
];

const stageOptions = [
  { value: "awareness", label: "Awareness" },
  { value: "interest", label: "Interest" },
  { value: "consideration", label: "Consideration" },
  { value: "trial", label: "Trial" },
  { value: "activation", label: "Activation" },
  { value: "retention", label: "Retention" },
];

const postStatusTone: Record<string, PillTone> = {
  draft: "neutral",
  scheduled: "accent",
  publishing: "warn",
  published: "pos",
  failed: "neg",
};

export default function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [showResearch, setShowResearch] = useState(false);
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>([]);
  const [creativeBrief, setCreativeBrief] = useState("");
  const [pipelineImagePromptMode, setPipelineImagePromptMode] = useState<
    "guided" | "custom_override" | "hybrid"
  >("guided");
  const [imageCustomTemplate, setImageCustomTemplate] = useState("");
  const [postCopyMode, setPostCopyMode] = useState<"ai_generated" | "from_outline">("ai_generated");
  const [postOutline, setPostOutline] = useState("");
  const [imageChannelMode, setImageChannelMode] = useState<"auto" | "manual">("auto");
  const [optimizeImagesForChannel, setOptimizeImagesForChannel] = useState<string>("");
  const [runs, setRuns] = useState<GenerationRunSummary[]>([]);
  const [selectingRun, setSelectingRun] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [editName, setEditName] = useState("");
  const [editProductId, setEditProductId] = useState("");
  const [editChannels, setEditChannels] = useState<string[]>(["facebook"]);
  const [editCadence, setEditCadence] = useState("3x_week");
  const [editPostCount, setEditPostCount] = useState(20);
  const [editStartDate, setEditStartDate] = useState("");
  const [editStages, setEditStages] = useState<string[]>(Object.keys(stageConfig));
  const [editPostTimeHourUTC, setEditPostTimeHourUTC] = useState(10);
  const [editMediaUrls, setEditMediaUrls] = useState<string[]>([]);
  const [useUploadedMedia, setUseUploadedMedia] = useState(false);

  const syncEditState = useCallback((campaignData: Campaign) => {
    setEditName(campaignData.name || "");
    setEditProductId(campaignData.productId || "");
    setEditChannels(campaignData.pipeline?.channels || ["facebook"]);
    setEditCadence(campaignData.pipeline?.cadence || "3x_week");
    setEditPostCount(campaignData.pipeline?.postCount || 20);
    setEditStartDate(campaignData.pipeline?.startDate ? campaignData.pipeline.startDate.slice(0, 10) : "");
    setEditStages(campaignData.pipeline?.stages || Object.keys(stageConfig));
    setEditPostTimeHourUTC(campaignData.pipeline?.postTimeHourUTC ?? 10);
    setEditMediaUrls(campaignData.mediaUrls || []);
    setUseUploadedMedia((campaignData.mediaUrls || []).length > 0);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const campaignRes = await apiGet<Campaign>(`/api/campaigns/${id}`);
      if (!campaignRes.ok) { toast.error("Campaign not found"); router.push("/campaigns"); return; }
      const nextCampaign = { ...campaignRes.data, id: id! };
      setCampaign(nextCampaign);
      syncEditState(nextCampaign);

      const runsRes = await apiGet<{ runs: GenerationRunSummary[] }>(`/api/campaigns/${id}/runs`);
      if (runsRes.ok) setRuns(runsRes.data.runs);
      else setRuns([]);

      // Only fetch pipeline data if posts have been generated
      if (campaignRes.data.pipelineStatus && campaignRes.data.pipelineStatus !== "pending_research") {
        const pipelineRes = await apiGet<PipelineData>(`/api/campaigns/${id}/pipeline`);
        if (pipelineRes.ok) setPipeline(pipelineRes.data);
        else setPipeline(null);
      } else {
        setPipeline(null);
      }
    } catch {
      toast.error("Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [id, router, syncEditState]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleEditChannel = (channel: string) => {
    setEditChannels((prev) =>
      prev.includes(channel) ? prev.filter((item) => item !== channel) : [...prev, channel]
    );
  };

  const toggleEditStage = (stage: string) => {
    setEditStages((prev) =>
      prev.includes(stage) ? prev.filter((item) => item !== stage) : [...prev, stage]
    );
  };

  const handleSaveCampaign = async () => {
    if (!editName.trim()) { toast.error("Campaign name is required"); return; }
    if (!editProductId) { toast.error("Select a product"); return; }
    if (editChannels.length === 0) { toast.error("Select at least one channel"); return; }
    if (editStages.length === 0) { toast.error("Select at least one pipeline stage"); return; }

    setSavingEdits(true);
    try {
      const startDateIso = editStartDate
        ? new Date(`${editStartDate}T00:00:00.000Z`).toISOString()
        : (campaign?.pipeline?.startDate || new Date().toISOString());
      const res = await apiPut<Campaign>(`/api/campaigns/${id}`, {
        name: editName.trim(),
        productId: editProductId,
        mediaUrls: useUploadedMedia ? editMediaUrls : [],
        pipeline: {
          channels: editChannels,
          cadence: editCadence,
          postCount: editPostCount,
          startDate: startDateIso,
          stages: editStages,
          postTimeHourUTC: editPostTimeHourUTC,
        },
      });

      if (!res.ok) {
        const errData = res.data as unknown as { error?: string; issues?: { message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to save campaign");
        return;
      }

      setEditOpen(false);
      toast.success("Campaign updated");
      await fetchData();
    } catch {
      toast.error("Failed to save campaign");
    } finally {
      setSavingEdits(false);
    }
  };

  const handleGenerate = async () => {
    if (!campaign?.productId) { toast.error("No product associated with this campaign"); return; }

    if (
      pipelineImagePromptMode !== "guided" &&
      !imageCustomTemplate.trim()
    ) {
      toast.error("Add an image template or suffix for custom / hybrid image mode.");
      return;
    }

    if (postCopyMode === "from_outline" && !postOutline.trim()) {
      toast.error("Add a post outline, or switch copy mode to AI-generated.");
      return;
    }

    const campaignChannels = campaign.pipeline?.channels || [];
    const framingChannel =
      optimizeImagesForChannel.trim() || campaignChannels[0] || "facebook";

    if (imageChannelMode === "manual") {
      if (!campaignChannels.includes(framingChannel)) {
        toast.error("Pick a channel for image framing that is included in this campaign.");
        return;
      }
    }

    setGenerating(true);
    toast.info(
      pipeline?.totalPosts
        ? "Starting a new generation from the latest campaign settings. This may take a minute..."
        : "Starting pipeline generation — researching competitors, generating posts & images. This may take a minute..."
    );

    try {
      const res = await apiPost<{
        postCount: number;
        imagesGenerated: number;
        imagesFailed?: number;
        imageErrorSamples?: string[];
      }>(
        `/api/campaigns/${id}/generate-pipeline`,
        {
          productId: campaign.productId,
          imageSubtypes: selectedSubtypes.length > 0 ? selectedSubtypes : undefined,
          creativeBrief: creativeBrief.trim() || undefined,
          imagePromptMode: pipelineImagePromptMode,
          imageCustomTemplate: imageCustomTemplate.trim() || undefined,
          postCopyMode,
          postOutline: postOutline.trim() || undefined,
          imageChannelMode,
          optimizeImagesForChannel:
            imageChannelMode === "manual" ? framingChannel : undefined,
          userMediaUrls:
            campaign.mediaUrls && campaign.mediaUrls.length > 0 ? campaign.mediaUrls : undefined,
        },
      );
      if (res.ok) {
        const failed = res.data.imagesFailed ?? 0;
        const msg =
          failed > 0
            ? `Pipeline generated: ${res.data.postCount} posts, ${res.data.imagesGenerated} images (${failed} image failures — see run details).`
            : `Pipeline generated: ${res.data.postCount} posts, ${res.data.imagesGenerated} images`;
        toast.success(msg);
        await fetchData();
        // Auto-expand all stages
        setExpandedStages(new Set(Object.keys(stageConfig)));
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Generation failed");
      }
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectRun = async (runId: string) => {
    const currentRunId = pipeline?.activeRunId || campaign?.activeRunId;
    if (!runId || runId === currentRunId) return;

    setSelectingRun(true);
    try {
      const res = await apiPost<{ runId: string }>(`/api/campaigns/${id}/runs/${runId}/select`, {});
      if (res.ok) {
        toast.success("Generation preview updated");
        await fetchData();
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Failed to switch generation");
      }
    } catch {
      toast.error("Failed to switch generation");
    } finally {
      setSelectingRun(false);
    }
  };

  const handleSchedule = async () => {
    setScheduling(true);
    try {
      const res = await apiPost<{ scheduledCount: number; firstPostAt: string; lastPostAt: string }>(
        `/api/campaigns/${id}/schedule-pipeline`,
        {},
      );
      if (res.ok) {
        toast.success(`${res.data.scheduledCount} posts scheduled: ${new Date(res.data.firstPostAt).toLocaleDateString()} → ${new Date(res.data.lastPostAt).toLocaleDateString()}`);
        await fetchData();
      } else {
        const errData = res.data as unknown as { error?: string };
        toast.error(errData.error || "Scheduling failed");
      }
    } catch {
      toast.error("Scheduling failed");
    } finally {
      setScheduling(false);
    }
  };

  const toggleStage = (stage: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  };

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-muted/30 animate-pulse" />)}
        </div>
      </AppShell>
    );
  }

  if (!campaign) return null;

  if (campaign.type !== "pipeline") {
    return (
      <AppShell>
        <StandardCampaignView campaign={campaign} />
      </AppShell>
    );
  }

  const pipelineStatus = campaign.pipelineStatus || "pending_research";
  const hasPreview = Boolean(pipeline && pipeline.totalPosts > 0);
  const currentDirtyReason = campaign.configDirtyReason || pipeline?.configDirtyReason || null;
  const isScheduleOnlyDirty = currentDirtyReason === "reschedule_only";
  const isScheduled = pipelineStatus === "scheduled" && pipeline?.scheduledRunId === pipeline?.activeRunId && !isScheduleOnlyDirty;
  const canSchedule = hasPreview && (!isScheduled || isScheduleOnlyDirty);
  const hasScheduledElsewhere = Boolean(pipeline?.scheduledRunId && pipeline?.activeRunId && pipeline.scheduledRunId !== pipeline.activeRunId);
  const isDirty = Boolean(campaign.configDirty || pipeline?.configDirty);
  const generateLabel = isDirty
    ? "Apply Changes & Regenerate"
    : hasPreview
      ? "Regenerate Pipeline"
      : "Generate Pipeline";
  const scheduleLabel = isScheduleOnlyDirty ? "Apply Schedule Changes" : "Schedule All Posts";
  const dirtyReasonLabel: Record<string, string> = {
    reschedule_only: "Schedule settings changed. You can reschedule without regenerating, or regenerate to refresh the preview.",
    regenerate_images: "Visual settings changed. Regenerate to create a new image set for this campaign.",
    regenerate_copy: "Pipeline strategy changed. Regenerate to refresh the generated posts.",
    full_regenerate: "Campaign inputs changed. Regenerate to create a new generation from the latest settings.",
  };
  const stages = Object.keys(stageConfig);

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-7">
        <button
          onClick={() => router.push("/campaigns")}
          className="flex items-center gap-1 text-[12px] mb-3 transition-colors font-mono"
          style={{ color: "var(--mk-ink-60)", letterSpacing: "0.04em" }}
        >
          ← Back to campaigns
        </button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1
              className="text-[26px] font-semibold m-0"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
            >
              {campaign.name}
            </h1>
            <p
              className="mt-1 text-[13.5px]"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              {campaign.pipeline?.postCount || 20} posts · {cadenceLabels[campaign.pipeline?.cadence || "3x_week"]}
              {campaign.pipeline?.channels && (
                <span> · {campaign.pipeline.channels.map((ch) => channelLabels[ch] || ch).join(", ")}</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="rounded-lg h-9 text-[13px]"
            >
              Edit campaign
            </Button>
            {runs.length > 0 && (
              <div className="w-full sm:w-60">
                <Select
                  size="sm"
                  value={pipeline?.activeRunId || campaign.activeRunId || ""}
                  onChange={(e) => handleSelectRun(e.target.value)}
                  disabled={selectingRun}
                >
                  <option value="" disabled>Select generation</option>
                  {runs.map((run, index) => (
                    <option key={run.id} value={run.id}>
                      {`Gen ${runs.length - index} · ${run.status}${run.isScheduled ? " · live" : run.isActive ? " · preview" : ""}`}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="w-full sm:w-auto">
              <details className="relative group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none list-none flex items-center gap-1">
                  Prompts &amp; brief
                  <ChevronDown className="h-3 w-3" />
                </summary>
                <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-xl shadow-lg p-3 w-[min(100vw-2rem,22rem)] space-y-3 max-h-[70vh] overflow-y-auto">
                  <div>
                    <p className="text-[10px] font-medium text-foreground mb-1">Creative brief (optional)</p>
                    <p className="text-[10px] text-muted-foreground mb-1.5">
                      Steers post copy and hooks. Stay factual; the model still uses your product and research.
                    </p>
                    <Textarea
                      value={creativeBrief}
                      onChange={(e) => setCreativeBrief(e.target.value)}
                      placeholder="e.g. Lead with founder story, UK English, avoid discount messaging…"
                      className="min-h-[72px] text-xs rounded-lg resize-y"
                      maxLength={4000}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-foreground mb-1">Post copy</p>
                    <Select
                      size="sm"
                      value={postCopyMode}
                      onChange={(e) =>
                        setPostCopyMode(e.target.value as "ai_generated" | "from_outline")
                      }
                    >
                      <option value="ai_generated">AI-generated from strategy + research</option>
                      <option value="from_outline">Expand from my outline</option>
                    </Select>
                  </div>
                  {postCopyMode === "from_outline" && (
                    <div>
                      <p className="text-[10px] font-medium text-foreground mb-1">Post outline</p>
                      <p className="text-[10px] text-muted-foreground mb-1.5">
                        Bullets or notes per stage (optional headings like{" "}
                        <code className="text-[9px]">--- AWARENESS ---</code>
                        ). No invented facts — only what you and the product support.
                      </p>
                      <Textarea
                        value={postOutline}
                        onChange={(e) => setPostOutline(e.target.value)}
                        placeholder={"--- AWARENESS ---\n- Pain: …\n\n--- TRIAL ---\n- CTA: …"}
                        className="min-h-[100px] text-xs rounded-lg resize-y"
                        maxLength={8000}
                      />
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-medium text-foreground mb-1">Image framing</p>
                    <p className="text-[10px] text-muted-foreground mb-1.5">
                      Aspect ratio &amp; platform style for generated images. Caption length still follows the strictest channel in the campaign.
                    </p>
                    <Select
                      size="sm"
                      value={imageChannelMode}
                      onChange={(e) => {
                        const v = e.target.value as "auto" | "manual";
                        setImageChannelMode(v);
                        if (v === "manual" && campaign?.pipeline?.channels?.length) {
                          const chs = campaign.pipeline.channels;
                          if (!optimizeImagesForChannel || !chs.includes(optimizeImagesForChannel)) {
                            setOptimizeImagesForChannel(chs[0]);
                          }
                        }
                      }}
                    >
                      <option value="auto">Automatic (strictest selected channel)</option>
                      <option value="manual">Choose channel…</option>
                    </Select>
                  </div>
                  {imageChannelMode === "manual" && (
                    <div>
                      <Select
                        size="sm"
                        value={
                          optimizeImagesForChannel ||
                          campaign?.pipeline?.channels?.[0] ||
                          ""
                        }
                        onChange={(e) => setOptimizeImagesForChannel(e.target.value)}
                      >
                        {(campaign?.pipeline?.channels || ["facebook"]).map((ch) => (
                          <option key={ch} value={ch}>
                            {channelLabels[ch] || ch}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-medium text-foreground mb-1">Image mode</p>
                    <Select
                      size="sm"
                      value={pipelineImagePromptMode}
                      onChange={(e) =>
                        setPipelineImagePromptMode(
                          e.target.value as "guided" | "custom_override" | "hybrid",
                        )
                      }
                    >
                      <option value="guided">Guided (AI scene from each post)</option>
                      <option value="hybrid">Hybrid (AI scene + your suffix / template)</option>
                      <option value="custom_override">Custom (your template is the main brief)</option>
                    </Select>
                  </div>
                  {pipelineImagePromptMode !== "guided" && (
                    <div>
                      <p className="text-[10px] font-medium text-foreground mb-1">Image template / suffix</p>
                      <p className="text-[10px] text-muted-foreground mb-1.5">
                        Placeholders:{" "}
                        <code className="text-[9px]">{"{{content}}"}</code>,{" "}
                        <code className="text-[9px]">{"{{imagePrompt}}"}</code>,{" "}
                        <code className="text-[9px]">{"{{stage}}"}</code>,{" "}
                        <code className="text-[9px]">{"{{sequence}}"}</code>,{" "}
                        <code className="text-[9px]">{"{{theme}}"}</code>
                      </p>
                      <Textarea
                        value={imageCustomTemplate}
                        onChange={(e) => setImageCustomTemplate(e.target.value)}
                        placeholder={
                          pipelineImagePromptMode === "custom_override"
                            ? "{{imagePrompt}} — plus your fixed art direction…"
                            : "e.g. Shot on phone, muted palette, no faces. Or append after AI scene: …"
                        }
                        className="min-h-[80px] text-xs rounded-lg resize-y"
                        maxLength={4000}
                      />
                    </div>
                  )}
                </div>
              </details>
            </div>
            <div className="w-full sm:w-auto">
              <details className="relative group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none list-none flex items-center gap-1">
                  Visual Types {selectedSubtypes.length > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1">{selectedSubtypes.length}</Badge>}
                  <ChevronDown className="h-3 w-3" />
                </summary>
                <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-xl shadow-lg p-3 w-56 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground mb-2">Select types to cycle through for variety. Leave empty for auto.</p>
                  {[
                    { value: "product-hero", label: "Product Hero" },
                    { value: "lifestyle", label: "Lifestyle" },
                    { value: "flat-lay", label: "Flat Lay" },
                    { value: "texture-detail", label: "Texture / Detail" },
                    { value: "before-after", label: "Before & After" },
                    { value: "hands-in-action", label: "Hands in Action" },
                    { value: "environment", label: "Environment" },
                    { value: "still-life", label: "Still Life" },
                    { value: "silhouette", label: "Silhouette" },
                    { value: "behind-the-scenes", label: "Behind the Scenes" },
                    { value: "ingredients-raw", label: "Ingredients / Raw" },
                    { value: "mood-abstract", label: "Mood / Abstract" },
                  ].map((st) => (
                    <label key={st.value} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-muted/50 rounded px-1.5 py-1">
                      <input
                        type="checkbox"
                        checked={selectedSubtypes.includes(st.value)}
                        onChange={(e) => {
                          setSelectedSubtypes((prev) =>
                            e.target.checked
                              ? [...prev, st.value]
                              : prev.filter((s) => s !== st.value)
                          );
                        }}
                        className="rounded border-border h-3.5 w-3.5"
                      />
                      {st.label}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            <Button onClick={handleGenerate} disabled={generating} className="rounded-xl">
              {generating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                generateLabel
              )}
            </Button>
            {canSchedule && (
              <Button onClick={handleSchedule} disabled={scheduling} className="rounded-xl">
                {scheduling ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling...</>
                ) : (
                  scheduleLabel
                )}
              </Button>
            )}
            {isScheduled && (
              <Badge variant="outline" className="border-0 px-3 py-1.5" style={pillStyle("pos")}>
                Pipeline scheduled
              </Badge>
            )}
            {hasScheduledElsewhere && (
              <Badge variant="outline" className="border-0 px-3 py-1.5" style={pillStyle("warn")}>
                Live schedule on previous generation
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Campaign</SheetTitle>
            <SheetDescription>
              Update the campaign source of truth. Generated content stays immutable until you regenerate.
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 py-4 space-y-5">
            <FormField label="Campaign Name">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Campaign name" />
            </FormField>

            <FormField label="Product">
              <ProductPicker value={editProductId} onChange={setEditProductId} />
            </FormField>

            <FormField label="Channels">
              <div className="grid grid-cols-1 gap-2">
                {socialChannels.map((channel) => (
                  <label key={channel.value} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <Checkbox
                      checked={editChannels.includes(channel.value)}
                      onCheckedChange={() => toggleEditChannel(channel.value)}
                    />
                    {channel.label}
                  </label>
                ))}
              </div>
            </FormField>

            <FormField label="Cadence">
              <Select value={editCadence} onChange={(e) => setEditCadence(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="3x_week">3x / week</option>
                <option value="2x_week">2x / week</option>
                <option value="weekly">Weekly</option>
              </Select>
            </FormField>

            <FormField label={`Post Count (${editPostCount})`}>
              <Slider
                min={3}
                max={30}
                step={1}
                value={[editPostCount]}
                onValueChange={([value]) => setEditPostCount(value)}
              />
            </FormField>

            <FormField label="Start Date">
              <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
            </FormField>

            <FormField label={`Post Time UTC (${String(editPostTimeHourUTC).padStart(2, "0")}:00)`}>
              <Slider
                min={0}
                max={23}
                step={1}
                value={[editPostTimeHourUTC]}
                onValueChange={([value]) => setEditPostTimeHourUTC(value)}
              />
            </FormField>

            <FormField label="Pipeline Stages">
              <div className="grid grid-cols-1 gap-2">
                {stageOptions.map((stage) => (
                  <label key={stage.value} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <Checkbox
                      checked={editStages.includes(stage.value)}
                      onCheckedChange={() => toggleEditStage(stage.value)}
                    />
                    {stage.label}
                  </label>
                ))}
              </div>
            </FormField>

            <FormField
              label="Visuals"
              description="Use uploaded media instead of AI-generated images. Posts cycle through your pool."
            >
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setUseUploadedMedia(false)}
                  className={`rounded-lg border p-2.5 text-xs text-left transition-all ${
                    !useUploadedMedia
                      ? "border-foreground bg-foreground/5"
                      : "border-border/60 hover:border-foreground/40"
                  }`}
                >
                  <p className="text-xs font-medium">AI generated</p>
                  <p className="text-[10px] text-muted-foreground">One image per post</p>
                </button>
                <button
                  type="button"
                  onClick={() => setUseUploadedMedia(true)}
                  className={`rounded-lg border p-2.5 text-xs text-left transition-all ${
                    useUploadedMedia
                      ? "border-foreground bg-foreground/5"
                      : "border-border/60 hover:border-foreground/40"
                  }`}
                >
                  <p className="text-xs font-medium">Your media</p>
                  <p className="text-[10px] text-muted-foreground">Cycle uploaded images</p>
                </button>
              </div>
              {useUploadedMedia && (
                <MediaUploader
                  value={editMediaUrls}
                  onChange={setEditMediaUrls}
                  max={30}
                  description="Each post will cycle through one of these images."
                />
              )}
            </FormField>
          </div>
          <SheetFooter className="px-6 pb-6">
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleSaveCampaign} disabled={savingEdits} className="rounded-xl">
              {savingEdits ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {isDirty && (
        <Card
          className="mb-6"
          style={{
            background: "color-mix(in oklch, var(--mk-warn) 10%, var(--mk-paper))",
            borderColor: "color-mix(in oklch, var(--mk-warn) 28%, var(--mk-rule))",
          }}
        >
          <CardContent className="py-4">
            <p
              className="text-[13px] font-medium"
              style={{ color: "color-mix(in oklch, var(--mk-warn) 70%, var(--mk-ink))" }}
            >
              Campaign settings changed
            </p>
            <p
              className="text-[13px] mt-1"
              style={{ color: "color-mix(in oklch, var(--mk-warn) 55%, var(--mk-ink))" }}
            >
              {dirtyReasonLabel[(campaign.configDirtyReason || pipeline?.configDirtyReason || "full_regenerate")] || dirtyReasonLabel.full_regenerate}
            </p>
          </CardContent>
        </Card>
      )}

      {runs.length > 0 && (
        <Card className="mb-6 border-border/30">
          <CardHeader>
            <CardTitle className="text-base">Generation History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.map((run, index) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/30 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{`Generation ${runs.length - index}`}</span>
                    <Badge variant="outline" className="border-border/40">{run.status}</Badge>
                    {run.isActive && <Badge className="border-0" style={pillStyle("accent")}>Preview</Badge>}
                    {run.isScheduled && <Badge className="border-0" style={pillStyle("pos")}>Scheduled</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(run.createdAt).toLocaleString()} · v{run.configVersion}
                    {run.itemCounts?.total ? ` · ${run.itemCounts.total} posts` : ""}
                    {run.itemCounts?.imagesGenerated ? ` · ${run.itemCounts.imagesGenerated} images` : ""}
                  </p>
                </div>
                {!run.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSelectRun(run.id)}
                    disabled={selectingRun}
                    className="rounded-xl"
                  >
                    {selectingRun ? "Switching..." : "View"}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Research Brief (collapsible) */}
      {pipeline?.researchBrief && (
        <Card className="mb-6 border-border/30">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setShowResearch(!showResearch)}
          >
            <CardTitle className="flex items-center justify-between text-base">
              <span>Research Brief</span>
              {showResearch ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          {showResearch && (
            <CardContent className="space-y-5 text-sm">
              {/* Competitors */}
              <div>
                <h4 className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">Competitors</h4>
                <div className="grid gap-2">
                  {pipeline.researchBrief.competitors.map((c, i) => (
                    <div key={i} className="rounded-lg border border-border/30 p-3">
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{c.positioning}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div><span className="text-emerald-600 font-medium">Strengths:</span> {c.strengths}</div>
                        <div><span className="text-rose-600 font-medium">Weaknesses:</span> {c.weaknesses}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trends */}
              <div>
                <h4 className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">Trends</h4>
                <div className="grid gap-2">
                  {pipeline.researchBrief.trends.map((t, i) => (
                    <div key={i} className="rounded-lg border border-border/30 p-3">
                      <p className="font-medium text-foreground">{t.trend}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{t.contentAngle}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Product Insights */}
              <div>
                <h4 className="font-medium mb-2 text-xs uppercase tracking-wider text-muted-foreground">Product Insights</h4>
                <div className="rounded-lg border border-border/30 p-3 space-y-2 text-xs">
                  <p><span className="font-medium text-foreground">UVP:</span> {pipeline.researchBrief.productInsights.uniqueValueProp}</p>
                  <p><span className="font-medium text-foreground">Key Messages:</span> {pipeline.researchBrief.productInsights.keyMessages.join(" · ")}</p>
                  <p><span className="font-medium text-foreground">Pain Points:</span> {pipeline.researchBrief.productInsights.audiencePainPoints.join(" · ")}</p>
                  <p><span className="font-medium text-foreground">Tone:</span> {pipeline.researchBrief.productInsights.toneRecommendations}</p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Status summary */}
      {pipeline && pipeline.totalPosts > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-border/30 p-4 text-center">
            <p className="text-2xl font-medium">{pipeline.totalPosts}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Posts</p>
          </div>
          <div className="rounded-xl border border-border/30 p-4 text-center">
            <p className="text-2xl font-medium">{pipeline.statusCounts?.draft || 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Drafts</p>
          </div>
          <div className="rounded-xl border border-border/30 p-4 text-center">
            <p className="text-2xl font-medium">{pipeline.statusCounts?.scheduled || 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Scheduled</p>
          </div>
          <div className="rounded-xl border border-border/30 p-4 text-center">
            <p className="text-2xl font-medium">{pipeline.statusCounts?.published || 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Published</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!pipeline && !generating && (
        <Card className="border-border/30">
          <CardContent className="py-16 text-center">
            <p className="text-base font-medium text-foreground">Pipeline ready to generate</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Click &quot;Generate Pipeline&quot; to research your market, generate {campaign.pipeline?.postCount || 20} posts
              with images, and build your adoption roadmap.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Generating state */}
      {generating && (
        <Card className="border-border/30">
          <CardContent className="py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-base font-medium text-foreground">Generating your pipeline</p>
            <p className="text-sm text-muted-foreground mt-1">
              Researching competitors & trends, generating posts, creating images...
            </p>
            <p className="text-xs text-muted-foreground mt-3">This usually takes 1-2 minutes</p>
          </CardContent>
        </Card>
      )}

      {/* Pipeline stages with posts */}
      {pipeline && pipeline.totalPosts > 0 && (
        <div className="space-y-3">
          {stages.map((stage) => {
            const config = stageConfig[stage];
            const posts = pipeline.stages[stage] || [];
            if (posts.length === 0) return null;
            const isExpanded = expandedStages.has(stage);

            return (
              <Card key={stage} className="border-border/30 overflow-hidden">
                <CardHeader
                  className="cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => toggleStage(stage)}
                >
                  <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="border-0" style={config.style}>
                        {config.label}
                      </Badge>
                      <span className="text-sm font-normal text-muted-foreground">
                        {posts.length} posts · {config.description}
                      </span>
                    </div>
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    }
                  </CardTitle>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border/30">
                      {posts.map((post) => (
                        <div key={post.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start gap-3">
                            {/* Post image thumbnail */}
                            {post.mediaUrls && post.mediaUrls.length > 0 ? (
                              <img
                                src={post.mediaUrls[0]}
                                alt=""
                                className="h-16 w-16 rounded-lg object-cover flex-shrink-0 border border-border/30"
                              />
                            ) : (
                              <div className="h-16 w-16 rounded-lg bg-muted/30 flex-shrink-0 flex items-center justify-center">
                                <span className="text-[10px] text-muted-foreground/50">No img</span>
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11px] text-muted-foreground">#{post.pipelineSequence + 1}</span>
                                <span className="text-[11px] text-muted-foreground/60">·</span>
                                <span className="text-[11px] text-muted-foreground">{post.pipelineTheme}</span>
                                <Badge
                                  variant="outline"
                                  className="border-0 text-[10px] ml-auto"
                                  style={pillStyle(postStatusTone[post.status] ?? "neutral")}
                                >
                                  {post.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-foreground leading-relaxed">{post.content}</p>
                              {post.scheduledAt && (
                                <p className="text-[11px] text-muted-foreground mt-1">
                                  Scheduled: {new Date(post.scheduledAt).toLocaleDateString()} at {new Date(post.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </p>
                              )}
                              {post.targetChannels && post.targetChannels.length > 0 && (
                                <div className="flex gap-1 mt-1.5">
                                  {post.targetChannels.map((ch) => (
                                    <span key={ch} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                                      {channelLabels[ch] || ch}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
