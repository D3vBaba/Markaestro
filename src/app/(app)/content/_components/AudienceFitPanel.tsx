"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api-client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { SocialChannel } from "@/lib/schemas";

type FitComponent = {
  component: string;
  label: string;
  weight: number;
  score: number | null;
  available: boolean;
  evidence: string[];
};

type FitResult = {
  fit: {
    score: number | null;
    dataCoverage: number;
    confidence: { score: number; label: "low" | "medium" | "high" };
    coldStart: boolean;
    recommendations: string[];
    components: FitComponent[];
  };
  sampleSize: number;
  suggestedCopy?: { caption: string | null; hook: string | null } | null;
};

export default function AudienceFitPanel({
  productId,
  content,
  platform,
  scheduledAt,
  onApplyCaption,
}: {
  productId: string;
  content: string;
  platform: SocialChannel;
  scheduledAt?: string;
  onApplyCaption?: (caption: string) => void;
}) {
  const t = useTranslations("intelligence.composer");
  // Light endpoint served from the insights cache: opening the composer must
  // not re-read the brand's whole post history.
  const timing = useApiQuery<{ timing?: { windows: Array<{ bucket: string; observations: number }> } | null }>(
    productId ? `/api/intelligence/timing?productId=${encodeURIComponent(productId)}` : null,
    { staleMs: 5 * 60_000 },
  );
  const [result, setResult] = useState<FitResult | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "failed">("idle");
  const [analysisKey, setAnalysisKey] = useState("");
  const [applied, setApplied] = useState(false);
  const polling = useRef(0);
  const currentKey = `${productId}\0${platform}\0${content}\0${scheduledAt || ""}`;
  const displayResult = analysisKey === currentKey ? result : null;
  const displayStatus = analysisKey === currentKey ? status : "idle";
  const suggestion = displayResult?.suggestedCopy?.caption;

  useEffect(() => () => { polling.current += 1; }, []);
  useEffect(() => { polling.current += 1; }, [content, platform, productId, scheduledAt]);

  async function poll(jobId: string, generation: number) {
    for (let attempt = 0; attempt < 45 && polling.current === generation; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await apiGet<{ status: string; result?: FitResult; errorCode?: string }>(`/api/intelligence/analysis/${jobId}`);
      if (polling.current !== generation) return;
      if (!response.ok) { setStatus("failed"); return; }
      if (response.data.status === "complete" && response.data.result) {
        setResult(response.data.result);
        setStatus("idle");
        return;
      }
      if (response.data.status === "dead_letter") { setStatus("failed"); return; }
    }
    if (polling.current === generation) setStatus("failed");
  }

  async function analyze() {
    if (!content.trim() || displayStatus === "queued") return;
    setAnalysisKey(currentKey);
    setStatus("queued");
    setResult(null);
    setApplied(false);
    const response = await apiPost<{ jobId: string; status: string; result?: FitResult }>("/api/intelligence/audience-fit", {
      productId,
      platform,
      content,
      ...(scheduledAt ? { scheduledAt } : {}),
    });
    if (!response.ok) { setStatus("failed"); return; }
    if (response.data.status === "complete" && response.data.result) {
      setResult(response.data.result);
      setStatus("idle");
      return;
    }
    const generation = ++polling.current;
    void poll(response.data.jobId, generation);
  }

  return (
    <section className="rounded-xl p-4" style={{ background: "var(--mk-panel)", border: "1px solid var(--mk-rule)" }} aria-labelledby="audience-fit-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4" aria-hidden="true" />
          <h3 id="audience-fit-title" className="text-[13px] font-semibold">{t("title")}</h3>
        </div>
        <Badge variant="outline" className="text-[9px] uppercase">{t("recommended")}</Badge>
      </div>
      {timing.data?.timing?.windows?.[0] && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--mk-ink-60)" }}>
          {t("timingHint", { bucket: timing.data.timing.windows[0].bucket, count: timing.data.timing.windows[0].observations })}
        </p>
      )}
      {!displayResult && (
        <div className="mt-3">
          <p className="text-[11px] leading-5" style={{ color: "var(--mk-ink-60)" }}>{displayStatus === "failed" ? t("failed") : t("body")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" disabled={!content.trim() || displayStatus === "queued"} onClick={analyze}>
            {displayStatus === "queued" && <RefreshCw className="h-3 w-3 animate-spin" />}
            {displayStatus === "queued" ? t("analyzing") : displayStatus === "failed" ? t("retry") : t("analyze")}
          </Button>
        </div>
      )}
      {displayResult && (
        <div className="mt-3 space-y-3">
          <div className="flex items-end gap-2">
            <span className="text-3xl font-semibold tabular-nums">{displayResult.fit.score ?? "n/a"}</span>
            <span className="pb-1 text-[11px]" style={{ color: "var(--mk-ink-40)" }}>/100</span>
          </div>
          <p className="text-[10px]" style={{ color: "var(--mk-ink-40)" }}>
            {t("meta", { coverage: displayResult.fit.dataCoverage, confidence: t(`confidence.${displayResult.fit.confidence.label}`), sample: displayResult.sampleSize })}
          </p>
          {displayResult.fit.coldStart && <p className="text-[11px]" style={{ color: "var(--mk-warn)" }}>{t("coldStart")}</p>}
          {displayResult.fit.components.length > 0 && (
            <ul className="space-y-1.5">
              {displayResult.fit.components.map((component) => (
                <li key={component.component} className="flex items-center justify-between gap-2 text-[11px]">
                  <span>{component.label}</span>
                  <span className="tabular-nums" style={{ color: component.available ? "var(--mk-ink)" : "var(--mk-ink-40)" }}>
                    {component.score === null ? t("unavailable") : component.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {displayResult.fit.recommendations.length > 0 && (
            <ul className="space-y-2">
              {displayResult.fit.recommendations.map((recommendation) => (
                <li key={recommendation} className="text-[11px] leading-4">{recommendation}</li>
              ))}
            </ul>
          )}
          {suggestion && onApplyCaption && (
            <div className="rounded-lg p-3" style={{ background: "var(--mk-paper)", border: "1px dashed var(--mk-rule)" }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--mk-ink-40)" }}>{t("suggestion")}</p>
              <p className="mt-1 text-[12px] leading-5 whitespace-pre-wrap">{suggestion}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={applied}
                onClick={() => {
                  onApplyCaption(suggestion);
                  setApplied(true);
                }}
              >
                {applied ? t("applied") : t("apply")}
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" className="px-0 text-[11px]" onClick={analyze}>{t("reanalyze")}</Button>
        </div>
      )}
    </section>
  );
}
