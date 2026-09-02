"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import ExperimentBoard, { type ExperimentItem } from "@/components/intelligence/ExperimentBoard";
import { KindBadge, PhaseGate, Section, TabHeader, TrustBadge, phasesOf } from "./shared";
import type { IntelligenceOverview } from "./types";

const STRATEGIST_TOOLS = [
  "audience_performance", "audience_alignment", "top_posts", "pillar_performance",
  "hook_performance", "timing_performance", "drift", "learnings", "campaigns",
  "platform_comparisons", "experiments",
] as const;

// Campaigns can be created but posts cannot be assigned to them yet. Keep the
// preview off until assignment ships so no customer sees a "coming soon" stub.
const CAMPAIGNS_PREVIEW_ENABLED = false;

function CampaignsPreview({ productId, objective }: { productId: string; objective: string }) {
  const t = useTranslations("intelligence.campaigns");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const campaigns = useApiQuery<{ campaigns: Array<{ id: string; name: string; status: string; productId: string }> }>("/api/intelligence/campaigns");
  const brandCampaigns = (campaigns.data?.campaigns || []).filter((item) => item.productId === productId);

  async function create() {
    setCreating(true);
    try {
      const response = await apiPost("/api/intelligence/campaigns", {
        productId,
        name,
        objective,
        platforms: ["instagram", "facebook", "tiktok", "threads", "pinterest", "linkedin"],
      });
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("createFailed")));
        return;
      }
      setName("");
      toast.success(t("created"));
      invalidateQueries("/api/intelligence/campaigns");
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Section trust="declared" title={t("title")} action={<KindBadge tone="amber">{t("preview")}</KindBadge>}>
      <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("empty")}</p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("name")} aria-label={t("name")} className="flex-1 rounded-xl" />
        <Button type="submit" className="h-9 rounded-xl text-xs font-semibold" disabled={!name || creating}>
          {t("create")}
        </Button>
      </form>
      {brandCampaigns.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80">
          {brandCampaigns.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
              <span className="font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
              <KindBadge tone="slate">{t(`status.${item.status as "draft"}`)}</KindBadge>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function AskMarkaestro({ productId }: { productId: string }) {
  const t = useTranslations("intelligence.ask");
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<{ answer: string; tool: string; evidenceIds?: string[]; limitations: string[] } | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask() {
    setAsking(true);
    setAskResult(null);
    try {
      const response = await apiPost<{ answer: string; tool: string; evidenceIds?: string[]; limitations: string[] }>(
        "/api/intelligence/strategist",
        { productId, question },
        undefined,
        { timeoutMs: 90_000 },
      );
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("failed"), {
          REQUEST_TIMEOUT: t("timeout"),
          QUOTA_EXCEEDED: t("quota"),
          FEATURE_NOT_AVAILABLE: t("unavailable"),
        }));
        return;
      }
      setAskResult(response.data);
    } catch {
      toast.error(t("failed"));
    } finally {
      setAsking(false);
    }
  }

  const toolLabel = askResult && (STRATEGIST_TOOLS as readonly string[]).includes(askResult.tool)
    ? t(`tools.${askResult.tool as (typeof STRATEGIST_TOOLS)[number]}`)
    : askResult?.tool || "";

  return (
    <Section trust="recommended" title={t("title")} subtitle={t("subtitle")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim() && !asking) void ask();
        }}
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("placeholder")}
          rows={3}
          aria-label={t("title")}
          className="rounded-xl"
        />
        <Button className="mt-3 h-9 rounded-xl text-xs font-semibold" type="submit" disabled={!question.trim() || asking}>
          {asking ? t("asking") : t("submit")}
        </Button>
      </form>
      {askResult && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <TrustBadge kind="generated" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("tool", { tool: toolLabel })}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800 dark:text-slate-200">{askResult.answer}</p>
          {askResult.evidenceIds && askResult.evidenceIds.length > 0 && (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("evidence")}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {askResult.evidenceIds.map((id) => (
                  <KindBadge key={id} tone="slate"><span className="font-mono">{id.slice(0, 18)}</span></KindBadge>
                ))}
              </div>
            </div>
          )}
          {askResult.limitations.map((item) => (
            <p key={item} className="mt-1.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{item}</p>
          ))}
        </div>
      )}
    </Section>
  );
}

export function AdvancedTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  const experimentsQuery = useApiQuery<{ experiments: ExperimentItem[] }>(
    phases.experiments ? "/api/intelligence/experiments" : null,
  );
  const brandExperiments = (experimentsQuery.data?.experiments || []).filter((item) => item.productId === productId);

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabHeader topic="advanced" title={t("howItWorks.advanced.title")} body={t("howItWorks.advanced.intro")} />
      <PhaseGate enabled={Boolean(phases.experiments)} feature="intelligenceExperiments">
        <Section trust="measured" title={t("experiments.title")}>
          <ExperimentBoard productId={productId} experiments={brandExperiments} />
        </Section>
      </PhaseGate>
      <PhaseGate enabled={phases.strategist !== false && phases.advanced} feature="intelligenceStrategist">
        <AskMarkaestro productId={productId} />
      </PhaseGate>
      {CAMPAIGNS_PREVIEW_ENABLED && (
        <PhaseGate enabled={phases.growth} feature="intelligenceOptimization">
          <CampaignsPreview productId={productId} objective={data.profile?.objective || "awareness"} />
        </PhaseGate>
      )}
    </div>
  );
}
