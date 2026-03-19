"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader,
    SheetTitle, SheetTrigger, SheetFooter, SheetClose,
} from "@/components/ui/sheet";
import { Trash2, Mail, Rocket, ArrowRight } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import ProductPicker from "@/app/content/_components/ProductPicker";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";

type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  type?: string;
  targetAudience?: string;
  cta?: string;
  pipelineStatus?: string;
  pipeline?: {
    channels: string[];
    cadence: string;
    postCount: number;
  };
  createdAt?: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const pipelineStatusColors: Record<string, string> = {
  pending_research: "bg-gray-100 text-gray-600",
  researching: "bg-violet-50 text-violet-700",
  research_complete: "bg-violet-50 text-violet-700",
  generating: "bg-amber-50 text-amber-700",
  generating_images: "bg-amber-50 text-amber-700",
  generated: "bg-blue-50 text-blue-700",
  scheduling: "bg-blue-50 text-blue-700",
  scheduled: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};

const pipelineStatusLabels: Record<string, string> = {
  pending_research: "Ready",
  researching: "Researching...",
  research_complete: "Research done",
  generating: "Generating posts...",
  generating_images: "Generating images...",
  generated: "Ready to schedule",
  scheduling: "Scheduling...",
  scheduled: "Scheduled",
  failed: "Failed",
};

const cadenceLabels: Record<string, string> = {
  daily: "Daily",
  "3x_week": "3x / week",
  "2x_week": "2x / week",
  weekly: "Weekly",
};

const socialChannelLabels: Record<string, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const socialChannels = [
  { value: "x", label: "X (Twitter)" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
];

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // Creation mode
  const [campaignType, setCampaignType] = useState<"standard" | "pipeline">("standard");

  // Standard campaign form
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState("email");
  const [newAudience, setNewAudience] = useState("");
  const [newCta, setNewCta] = useState("");

  // Pipeline form
  const [pipelineName, setPipelineName] = useState("");
  const [pipelineProductId, setPipelineProductId] = useState("");
  const [pipelineChannels, setPipelineChannels] = useState<string[]>(["x"]);
  const [pipelineCadence, setPipelineCadence] = useState("3x_week");
  const [pipelinePostCount, setPipelinePostCount] = useState(20);

  const [saving, setSaving] = useState(false);

  const fetchCampaigns = async () => {
    try {
      const res = await apiGet<{ campaigns: Campaign[] }>("/api/campaigns");
      if (res.ok) setCampaigns(res.data.campaigns || []);
    } catch {
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleCreateStandard = async () => {
    setSaving(true);
    try {
      const res = await apiPost("/api/campaigns", {
        name: newName,
        channel: newChannel,
        targetAudience: newAudience,
        cta: newCta,
      });
      if (res.ok) {
        toast.success("Campaign created");
        setNewName(""); setNewChannel("email"); setNewAudience(""); setNewCta("");
        fetchCampaigns();
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create campaign");
      }
    } catch {
      toast.error("Failed to create campaign");
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePipeline = async () => {
    if (!pipelineName.trim()) { toast.error("Name is required"); return; }
    if (!pipelineProductId) { toast.error("Select a product"); return; }
    if (pipelineChannels.length === 0) { toast.error("Select at least one channel"); return; }

    setSaving(true);
    try {
      const res = await apiPost<{ id: string }>("/api/campaigns", {
        name: pipelineName,
        type: "pipeline",
        channel: pipelineChannels[0],
        productId: pipelineProductId,
        pipeline: {
          channels: pipelineChannels,
          cadence: pipelineCadence,
          postCount: pipelinePostCount,
          startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          stages: ["awareness", "interest", "consideration", "trial", "activation", "retention"],
        },
      });
      if (res.ok) {
        toast.success("Pipeline campaign created");
        setPipelineName(""); setPipelineProductId(""); setPipelineChannels(["x"]);
        setPipelineCadence("3x_week"); setPipelinePostCount(20);
        router.push(`/campaigns/${res.data.id}`);
      } else {
        const errData = res.data as { error?: string; issues?: { field: string; message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create pipeline");
      }
    } catch {
      toast.error("Failed to create pipeline");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await apiDelete(`/api/campaigns/${id}`);
    if (res.ok) {
      toast.success("Campaign deleted");
      fetchCampaigns();
    } else {
      const errData = res.data as { error?: string };
      toast.error(errData.error || "Failed to delete campaign");
    }
  };

  const toggleChannel = (ch: string) => {
    setPipelineChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  return (
    <AppShell>
      <PageHeader
        title="Campaigns"
        subtitle="Plan and ship high-converting multi-channel campaigns."
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button className="rounded-xl">New Campaign</Button>
            </SheetTrigger>
            <SheetContent className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Create Campaign</SheetTitle>
                <SheetDescription>Choose between a single campaign or an automated adoption pipeline.</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                {/* Type selector */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCampaignType("standard")}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      campaignType === "standard"
                        ? "border-foreground bg-foreground/5"
                        : "border-border/60 hover:border-foreground/30"
                    }`}
                  >
                    <Mail className="h-4 w-4 mb-1.5 text-muted-foreground" />
                    <p className="text-sm font-medium">Standard</p>
                    <p className="text-[11px] text-muted-foreground">Single campaign</p>
                  </button>
                  <button
                    onClick={() => setCampaignType("pipeline")}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      campaignType === "pipeline"
                        ? "border-foreground bg-foreground/5"
                        : "border-border/60 hover:border-foreground/30"
                    }`}
                  >
                    <Rocket className="h-4 w-4 mb-1.5 text-muted-foreground" />
                    <p className="text-sm font-medium">Pipeline</p>
                    <p className="text-[11px] text-muted-foreground">Adoption roadmap</p>
                  </button>
                </div>

                {campaignType === "standard" ? (
                  <>
                    <FormField label="Name">
                      <Input placeholder="Spring Reactivation" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </FormField>
                    <FormField label="Channel">
                      <Select value={newChannel} onChange={(e) => setNewChannel(e.target.value)}>
                        <option value="email">Email</option>
                        <option value="x">X (Twitter)</option>
                        <option value="facebook">Facebook</option>
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="sms">SMS</option>
                      </Select>
                    </FormField>
                    <FormField label="Target Audience">
                      <Input placeholder="Dormant Users" value={newAudience} onChange={(e) => setNewAudience(e.target.value)} />
                    </FormField>
                    <FormField label="Call to Action">
                      <Input placeholder="Start trial" value={newCta} onChange={(e) => setNewCta(e.target.value)} />
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField label="Pipeline Name">
                      <Input
                        placeholder="Q2 User Adoption"
                        value={pipelineName}
                        onChange={(e) => setPipelineName(e.target.value)}
                      />
                    </FormField>

                    <ProductPicker value={pipelineProductId} onChange={setPipelineProductId} />

                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Channels
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {socialChannels.map((ch) => (
                          <label
                            key={ch.value}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-all ${
                              pipelineChannels.includes(ch.value)
                                ? "border-foreground bg-foreground/5"
                                : "border-border/60 hover:border-foreground/30"
                            }`}
                          >
                            <Checkbox
                              checked={pipelineChannels.includes(ch.value)}
                              onCheckedChange={() => toggleChannel(ch.value)}
                            />
                            {ch.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <FormField label="Posting Cadence">
                      <Select value={pipelineCadence} onChange={(e) => setPipelineCadence(e.target.value)}>
                        <option value="daily">Daily</option>
                        <option value="3x_week">3x per week (Mon/Wed/Fri)</option>
                        <option value="2x_week">2x per week (Tue/Thu)</option>
                        <option value="weekly">Weekly (Monday)</option>
                      </Select>
                    </FormField>

                    <FormField label={`Number of Posts: ${pipelinePostCount}`} description="Distributed across 6 adoption stages (awareness → retention)">
                      <Slider
                        value={[pipelinePostCount]}
                        onValueChange={([v]) => setPipelinePostCount(v)}
                        min={15}
                        max={30}
                        step={1}
                        className="mt-2"
                      />
                    </FormField>
                  </>
                )}
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button
                    onClick={campaignType === "standard" ? handleCreateStandard : handleCreatePipeline}
                    disabled={saving}
                  >
                    {saving
                      ? "Creating..."
                      : campaignType === "pipeline"
                      ? "Create Pipeline"
                      : "Create Campaign"}
                  </Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        }
      />

      <div className="grid gap-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <Card className="border-border/30">
            <CardContent className="py-16 text-center">
              <div className="h-12 w-12 rounded-xl bg-primary mx-auto mb-4 flex items-center justify-center">
                <Mail className="h-5 w-5 text-white" />
              </div>
              <p className="text-base font-medium text-foreground">No campaigns yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first campaign to get started.</p>
            </CardContent>
          </Card>
        ) : (
          campaigns.map((c) => (
            <Card
              key={c.id}
              className={`card-premium border-border/30 ${c.type === "pipeline" ? "cursor-pointer hover:border-foreground/20 transition-colors" : ""}`}
              onClick={c.type === "pipeline" ? () => router.push(`/campaigns/${c.id}`) : undefined}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {c.type === "pipeline" && <Rocket className="h-4 w-4 text-muted-foreground" />}
                    <span>{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.type === "pipeline" && c.pipelineStatus ? (
                      <Badge variant="outline" className={`border-0 text-[11px] ${pipelineStatusColors[c.pipelineStatus] || ""}`}>
                        {pipelineStatusLabels[c.pipelineStatus] || c.pipelineStatus}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={`capitalize border-0 ${statusColors[c.status] || ""}`}>
                        {c.status}
                      </Badge>
                    )}
                    {c.type === "pipeline" && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    {c.type !== "pipeline" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardTitle>
                <CardDescription>
                  {c.type === "pipeline" ? (
                    <>
                      Pipeline · {c.pipeline?.postCount || 20} posts · {cadenceLabels[c.pipeline?.cadence || "3x_week"]}
                      {c.pipeline?.channels && (
                        <span className="ml-1">
                          · {c.pipeline.channels.map((ch) => socialChannelLabels[ch] || ch).join(", ")}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="capitalize">{c.channel} {c.targetAudience ? `· ${c.targetAudience}` : ""}</span>
                  )}
                </CardDescription>
              </CardHeader>
              {c.type !== "pipeline" && (
                <CardContent className="text-sm text-muted-foreground">
                  Primary CTA: <span className="text-foreground font-medium">{c.cta || "Learn more"}</span>
                  {c.createdAt && (
                    <span className="ml-4 text-xs text-muted-foreground">Created {new Date(c.createdAt).toLocaleDateString()}</span>
                  )}
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
