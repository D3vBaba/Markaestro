"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Layers3, Target, Plus, ArrowUpRight } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import CampaignWizard from "./_components/CampaignWizard";
import { apiGet, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  scheduledAt?: string | null;
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
  researching: "Researching…",
  research_complete: "Research done",
  generating: "Generating posts…",
  generating_images: "Generating images…",
  generated: "Ready to schedule",
  scheduling: "Scheduling…",
  scheduled: "Scheduled",
  failed: "Failed",
};

const cadenceLabels: Record<string, string> = {
  daily: "Daily",
  "3x_week": "3×/wk",
  "2x_week": "2×/wk",
  weekly: "Weekly",
};

const channelLabels: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  sms: "SMS",
};

type FilterTab = "all" | "standard" | "pipeline";

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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

  const handleCreated = (id: string, type: "standard" | "pipeline") => {
    fetchCampaigns();
    if (type === "pipeline") router.push(`/campaigns/${id}`);
    else router.push(`/campaigns/${id}`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await apiDelete(`/api/campaigns/${deleteTarget.id}`);
    if (res.ok) {
      toast.success("Campaign deleted");
      fetchCampaigns();
    } else {
      const errData = res.data as { error?: string };
      toast.error(errData.error || "Failed to delete campaign");
    }
  };

  const counts = {
    all: campaigns.length,
    standard: campaigns.filter((c) => c.type !== "pipeline").length,
    pipeline: campaigns.filter((c) => c.type === "pipeline").length,
  };

  const visible = campaigns.filter((c) => {
    if (filter === "standard") return c.type !== "pipeline";
    if (filter === "pipeline") return c.type === "pipeline";
    return true;
  });

  return (
    <AppShell>
      <PageHeader
        title="Campaigns"
        subtitle="Plan and ship high-converting multi-channel campaigns."
        action={
          <Button onClick={() => setWizardOpen(true)} className="rounded-xl gap-1.5">
            <Plus className="h-4 w-4" /> New campaign
          </Button>
        }
      />

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border/40">
        {(["all", "standard", "pipeline"] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          const label = tab === "all" ? "All" : tab === "standard" ? "Single posts" : "Pipelines";
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={cn(
                "relative px-3 py-2 text-sm transition-colors",
                active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1.5">
                {label}
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  {counts[tab]}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId="campaigns-filter-underline"
                  className="absolute left-0 right-0 -bottom-px h-0.5 bg-foreground"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setWizardOpen(true)} filter={filter} />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {visible.map((c, i) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                index={i}
                onOpen={() => router.push(`/campaigns/${c.id}`)}
                onDelete={() => setDeleteTarget({ id: c.id, name: c.name })}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={handleCreated} />

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        entity="campaign"
        name={deleteTarget?.name}
        warning="Any generated posts from this campaign will remain but will no longer be linked to it."
        onConfirm={confirmDelete}
      />
    </AppShell>
  );
}

function CampaignRow({
  campaign: c,
  index,
  onOpen,
  onDelete,
}: {
  campaign: Campaign;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const isPipeline = c.type === "pipeline";
  const statusBadge = isPipeline && c.pipelineStatus ? (
    <Badge variant="outline" className={cn("border-0 text-[10px]", pipelineStatusColors[c.pipelineStatus] || "")}>
      {pipelineStatusLabels[c.pipelineStatus] || c.pipelineStatus}
    </Badge>
  ) : (
    <Badge variant="outline" className={cn("capitalize border-0 text-[10px]", statusColors[c.status] || "")}>
      {c.status}
    </Badge>
  );

  const channels = isPipeline
    ? (c.pipeline?.channels || []).map((ch) => channelLabels[ch] || ch).join(" · ")
    : channelLabels[c.channel] || c.channel;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, delay: index * 0.03, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <button
        onClick={onOpen}
        className="w-full text-left rounded-2xl border border-border/40 bg-card hover:border-foreground/25 hover:shadow-sm transition-all p-5 group"
      >
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={cn(
            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
            isPipeline
              ? "bg-foreground/5 text-foreground group-hover:bg-foreground group-hover:text-background"
              : "bg-muted text-muted-foreground group-hover:bg-foreground group-hover:text-background",
          )}>
            {isPipeline ? <Layers3 className="h-5 w-5" /> : <Target className="h-5 w-5" />}
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-foreground truncate">{c.name}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  <span>{isPipeline ? "Pipeline" : "Single post"}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="truncate">{channels}</span>
                  {isPipeline && c.pipeline && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{c.pipeline.postCount} posts</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{cadenceLabels[c.pipeline.cadence] || c.pipeline.cadence}</span>
                    </>
                  )}
                  {!isPipeline && c.cta && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="truncate">CTA: {c.cta}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {statusBadge}
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                {c.scheduledAt && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(c.scheduledAt).toLocaleDateString()}
                  </span>
                )}
                {c.createdAt && (
                  <span>Created {new Date(c.createdAt).toLocaleDateString()}</span>
                )}
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onDelete();
                  }
                }}
                className="text-[11px] text-muted-foreground/60 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                Delete
              </span>
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function EmptyState({ onCreate, filter }: { onCreate: () => void; filter: FilterTab }) {
  const labels = {
    all: "No campaigns yet",
    standard: "No single-post campaigns",
    pipeline: "No pipelines yet",
  };
  return (
    <div className="rounded-3xl border border-dashed border-border/50 bg-muted/10 py-16 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-foreground/5 flex items-center justify-center mb-4">
        <Plus className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-base font-medium text-foreground">{labels[filter]}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        Start with a single post for a quick announcement, or launch a pipeline for a full multi-stage funnel.
      </p>
      <Button onClick={onCreate} className="rounded-xl mt-5 gap-1.5">
        <Plus className="h-4 w-4" /> New campaign
      </Button>
    </div>
  );
}
