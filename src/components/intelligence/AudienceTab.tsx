"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import AudienceProfileEditor from "@/components/intelligence/AudienceProfileEditor";
import { PhaseGate, Section, TabHeader, phasesOf } from "./shared";
import { useIntelligenceFormat } from "./format";
import type { IntelligenceOverview, TrackedLink } from "./types";

function TrackedLinks({ productId }: { productId: string }) {
  const t = useTranslations("intelligence.links");
  const fmt = useIntelligenceFormat();
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [creating, setCreating] = useState(false);
  const links = useApiQuery<{ links: TrackedLink[] }>(`/api/intelligence/tracked-links?productId=${encodeURIComponent(productId)}`);

  async function create() {
    setCreating(true);
    try {
      const response = await apiPost("/api/intelligence/tracked-links", { productId, label, destination });
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("createFailed")));
        return;
      }
      setLabel("");
      setDestination("");
      toast.success(t("created"));
      invalidateQueries("/api/intelligence/tracked-links");
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("createFailed"));
    }
  }

  return (
    <Section trust="measured" title={t("title")} subtitle={t("subtitle")} help="links">
      {!links.data?.links.length && (
        <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("empty")}</p>
      )}
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("label")} aria-label={t("label")} className="rounded-xl" />
        <Input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder={t("destination")}
          aria-label={t("destination")}
          className="rounded-xl"
          type="url"
        />
        <Button
          type="submit"
          className="h-9 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
          disabled={!label || !destination || creating}
        >
          {creating ? t("creating") : t("create")}
        </Button>
      </form>
      {(links.data?.links.length ?? 0) > 0 && (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80">
          {links.data?.links.map((link) => {
            const lastClick = fmt.dateTime(link.lastClickedAt);
            return (
              <div key={link.code} className="flex flex-col gap-1.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-200">{link.label}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">{link.url}</span>
                    <button
                      type="button"
                      onClick={() => void copy(link.url)}
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      {t("copy")}
                    </button>
                  </div>
                  <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{link.destination}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 sm:text-end">
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{t("clicks", { count: link.clicks })}</span>
                  {link.attributedConversions > 0 && (
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300">{t("conversions", { count: link.attributedConversions })}</span>
                  )}
                  <span>{lastClick ? t("lastClick", { when: lastClick }) : t("noClicks")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function AudienceTab({ productId, data }: { productId: string; data: IntelligenceOverview }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  return (
    <div className="space-y-4 sm:space-y-5">
      <TabHeader topic="audience" title={t("howItWorks.audience.title")} body={t("howItWorks.audience.intro")} />
      <Section trust="declared" title={t("audience.title")}>
        <AudienceProfileEditor productId={productId} variant="advanced" />
      </Section>

      {phases.growth && data.drift && (
        <Section trust="calculated" title={data.drift.title}>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{data.drift.summary}</p>
        </Section>
      )}

      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        <TrackedLinks productId={productId} />
      </PhaseGate>
    </div>
  );
}
