"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "sonner";

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
  pipelineConfig: {
    channels: string[];
    cadence: string;
    postCount: number;
    startDate: string;
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
  pipelineStatus?: string;
  pipeline?: {
    channels: string[];
    cadence: string;
    postCount: number;
    startDate: string;
  };
};

const stageConfig: Record<string, { label: string; color: string; description: string }> = {
  awareness: { label: "Awareness", color: "bg-rose-50 text-rose-700", description: "Problem-aware content — make audience feel seen" },
  interest: { label: "Interest", color: "bg-orange-50 text-orange-700", description: "Educational content — introduce the solution category" },
  consideration: { label: "Consideration", color: "bg-amber-50 text-amber-700", description: "Product positioning — features & comparisons" },
  trial: { label: "Trial", color: "bg-emerald-50 text-emerald-700", description: "Drive sign-ups — urgency & social proof" },
  activation: { label: "Activation", color: "bg-blue-50 text-blue-700", description: "Onboarding tips — help users succeed quickly" },
  retention: { label: "Retention", color: "bg-violet-50 text-violet-700", description: "Advanced value — success stories & community" },
};

const cadenceLabels: Record<string, string> = {
  daily: "Daily",
  "3x_week": "3x / week (Mon, Wed, Fri)",
  "2x_week": "2x / week (Tue, Thu)",
  weekly: "Weekly (Monday)",
};

const channelLabels: Record<string, string> = {
  x: "X", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok",
};

const postStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-50 text-blue-700",
  publishing: "bg-amber-50 text-amber-700",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
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

  const fetchData = useCallback(async () => {
    try {
      const campaignRes = await apiGet<Campaign>(`/api/campaigns/${id}`);
      if (!campaignRes.ok) { toast.error("Campaign not found"); router.push("/campaigns"); return; }
      setCampaign({ ...campaignRes.data, id: id! });

      // Only fetch pipeline data if posts have been generated
      if (campaignRes.data.pipelineStatus && campaignRes.data.pipelineStatus !== "pending_research") {
        const pipelineRes = await apiGet<PipelineData>(`/api/campaigns/${id}/pipeline`);
        if (pipelineRes.ok) setPipeline(pipelineRes.data);
      }
    } catch {
      toast.error("Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerate = async () => {
    if (!campaign?.productId) { toast.error("No product associated with this campaign"); return; }
    setGenerating(true);
    toast.info("Starting pipeline generation — researching competitors, generating posts & images. This may take a minute...");

    try {
      const res = await apiPost<{ postCount: number; imagesGenerated: number }>(
        `/api/campaigns/${id}/generate-pipeline`,
        {
          productId: campaign.productId,
          imageSubtypes: selectedSubtypes.length > 0 ? selectedSubtypes : undefined,
        },
      );
      if (res.ok) {
        toast.success(`Pipeline generated: ${res.data.postCount} posts, ${res.data.imagesGenerated} images`);
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

  const pipelineStatus = campaign.pipelineStatus || "pending_research";
  const isGenerated = ["generated", "scheduling", "scheduled"].includes(pipelineStatus);
  const isScheduled = pipelineStatus === "scheduled";
  const stages = Object.keys(stageConfig);

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.push("/campaigns")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          &larr; Back to Campaigns
        </button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-normal tracking-tight font-[family-name:var(--font-display)]">
                {campaign.name}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {campaign.pipeline?.postCount || 20} posts · {cadenceLabels[campaign.pipeline?.cadence || "3x_week"]}
              {campaign.pipeline?.channels && (
                <span> · {campaign.pipeline.channels.map((ch) => channelLabels[ch] || ch).join(", ")}</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isGenerated && (
              <>
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
                    "Generate Pipeline"
                  )}
                </Button>
              </>
            )}
            {isGenerated && !isScheduled && (
              <Button onClick={handleSchedule} disabled={scheduling} className="rounded-xl">
                {scheduling ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling...</>
                ) : (
                  "Schedule All Posts"
                )}
              </Button>
            )}
            {isScheduled && (
              <Badge variant="outline" className="border-0 bg-emerald-50 text-emerald-700 px-3 py-1.5">
                Pipeline Scheduled
              </Badge>
            )}
          </div>
        </div>
      </div>

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
                      <Badge variant="outline" className={`border-0 ${config.color}`}>
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
                                <Badge variant="outline" className={`border-0 text-[10px] ml-auto ${postStatusColors[post.status] || ""}`}>
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
