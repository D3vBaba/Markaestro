"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Layers3, Target, Plus } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/app/PageHeader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import CampaignWizard from "./_components/CampaignWizard";
import { apiGet, apiDelete } from "@/lib/api-client";
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
  scheduledAt?: string | null;
  createdAt?: string;
};

const statusPill: Record<string, { bg: string; fg: string }> = {
  draft:     { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" },
  scheduled: { bg: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-pos) 60%, var(--mk-ink))" },
  active:    { bg: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-pos) 60%, var(--mk-ink))" },
  paused:    { bg: "color-mix(in oklch, var(--mk-warn) 18%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-warn) 60%, var(--mk-ink))" },
  completed: { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" },
  cancelled: { bg: "color-mix(in oklch, var(--mk-neg) 12%, var(--mk-paper))", fg: "var(--mk-neg)" },
  failed:    { bg: "color-mix(in oklch, var(--mk-neg) 12%, var(--mk-paper))", fg: "var(--mk-neg)" },
  pending_research:  { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" },
  researching:       { bg: "var(--mk-accent-soft)", fg: "var(--mk-accent)" },
  research_complete: { bg: "var(--mk-accent-soft)", fg: "var(--mk-accent)" },
  generating:        { bg: "color-mix(in oklch, var(--mk-warn) 18%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-warn) 60%, var(--mk-ink))" },
  generating_images: { bg: "color-mix(in oklch, var(--mk-warn) 18%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-warn) 60%, var(--mk-ink))" },
  generated:         { bg: "var(--mk-accent-soft)", fg: "var(--mk-accent)" },
  scheduling:        { bg: "var(--mk-accent-soft)", fg: "var(--mk-accent)" },
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
          <Button onClick={() => setWizardOpen(true)} className="rounded-lg h-9 text-[13px] gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New campaign
          </Button>
        }
      />

      {/* Filter tabs */}
      <div
        className="flex items-center gap-6 mb-5 border-b overflow-x-auto scrollbar-hide"
        style={{ borderColor: "var(--mk-rule-soft)" }}
      >
        {(["all", "standard", "pipeline"] as FilterTab[]).map((tab) => {
          const active = filter === tab;
          const label = tab === "all" ? "All" : tab === "standard" ? "Single posts" : "Pipelines";
          return (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className="relative py-2.5 text-[13px] transition-colors whitespace-nowrap"
              style={{
                marginBottom: -1,
                color: active ? "var(--mk-ink)" : "var(--mk-ink-60)",
                fontWeight: active ? 600 : 400,
                letterSpacing: "-0.005em",
                borderBottom: `2px solid ${active ? "var(--mk-ink)" : "transparent"}`,
              }}
            >
              <span className="flex items-center gap-1.5">
                {label}
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--mk-ink-40)" }}
                >
                  {counts[tab]}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId="campaigns-filter-underline"
                  className="absolute left-0 right-0 -bottom-px h-px"
                  style={{ background: "var(--mk-ink)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-2.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[78px] rounded-[10px] animate-pulse"
              style={{ background: "var(--mk-panel)" }}
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState onCreate={() => setWizardOpen(true)} filter={filter} />
      ) : (
        <div className="grid gap-2.5">
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
  const pillKey = isPipeline && c.pipelineStatus ? c.pipelineStatus : c.status;
  const pillLabel = isPipeline && c.pipelineStatus
    ? pipelineStatusLabels[c.pipelineStatus] || c.pipelineStatus
    : c.status;
  const pillStyle = statusPill[pillKey] ?? { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" };

  const channels = isPipeline
    ? (c.pipeline?.channels || []).map((ch) => channelLabels[ch] || ch).join(" · ")
    : channelLabels[c.channel] || c.channel;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, delay: index * 0.03, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <button
        onClick={onOpen}
        className="w-full text-left rounded-[10px] transition-colors group p-3.5 sm:p-4"
        style={{
          background: "var(--mk-paper)",
          border: "1px solid var(--mk-rule)",
        }}
      >
        <div className="flex items-start gap-3 sm:gap-3.5">
          {/* Icon */}
          <div
            className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
            style={{ background: "var(--mk-panel)", color: "var(--mk-ink-80)" }}
          >
            {isPipeline ? <Layers3 className="h-4 w-4" /> : <Target className="h-4 w-4" />}
          </div>

          {/* Body */}
          <div className="min-w-0 flex-1">
            {/* Row 1: title + status pill */}
            <div className="flex items-start justify-between gap-3">
              <p
                className="text-[14px] font-medium truncate m-0"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
              >
                {c.name}
              </p>
              <span
                className="text-[11px] font-medium whitespace-nowrap shrink-0"
                style={{
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: pillStyle.bg,
                  color: pillStyle.fg,
                  letterSpacing: "-0.005em",
                }}
              >
                {pillLabel}
              </span>
            </div>

            {/* Row 2: meta */}
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12px]"
              style={{ color: "var(--mk-ink-60)" }}
            >
              <span className="whitespace-nowrap">{isPipeline ? "Pipeline" : "Single"}</span>
              <span style={{ color: "var(--mk-ink-20)" }}>·</span>
              <span className="truncate">{channels}</span>
              {isPipeline && c.pipeline && (
                <>
                  <span style={{ color: "var(--mk-ink-20)" }}>·</span>
                  <span className="whitespace-nowrap">
                    {c.pipeline.postCount} {c.pipeline.postCount === 1 ? "post" : "posts"}
                  </span>
                  <span style={{ color: "var(--mk-ink-20)" }}>·</span>
                  <span className="whitespace-nowrap">
                    {cadenceLabels[c.pipeline.cadence] || c.pipeline.cadence}
                  </span>
                </>
              )}
              {!isPipeline && c.cta && (
                <>
                  <span style={{ color: "var(--mk-ink-20)" }}>·</span>
                  <span className="truncate">CTA: {c.cta}</span>
                </>
              )}
            </div>

            {/* Row 3: dates + delete action */}
            <div
              className="mt-1.5 flex items-center flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px]"
              style={{ color: "var(--mk-ink-40)", letterSpacing: "0.02em" }}
            >
              {c.scheduledAt && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <Calendar className="h-3 w-3" />
                  {new Date(c.scheduledAt).toLocaleDateString()}
                </span>
              )}
              {c.createdAt && (
                <span className="whitespace-nowrap">
                  Created {new Date(c.createdAt).toLocaleDateString()}
                </span>
              )}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onDelete();
                  }
                }}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-[color:var(--mk-neg)]"
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
    <div
      className="rounded-xl py-14 text-center"
      style={{
        background: "var(--mk-paper)",
        border: "1px dashed var(--mk-rule)",
      }}
    >
      <div
        className="mx-auto h-11 w-11 rounded-xl grid place-items-center mb-3.5"
        style={{ background: "var(--mk-panel)" }}
      >
        <Plus className="h-4 w-4" style={{ color: "var(--mk-ink-60)" }} />
      </div>
      <p
        className="text-[14px] font-medium"
        style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
      >
        {labels[filter]}
      </p>
      <p
        className="mt-1 text-[13px] max-w-sm mx-auto"
        style={{ color: "var(--mk-ink-60)" }}
      >
        Start with a single post for a quick announcement, or launch a pipeline for a full multi-stage funnel.
      </p>
      <Button
        onClick={onCreate}
        className="rounded-lg mt-4 h-9 text-[13px] gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" /> New campaign
      </Button>
    </div>
  );
}
