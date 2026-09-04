"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import AudienceProfileEditor from "@/components/intelligence/AudienceProfileEditor";
import { KindBadge, PhaseGate, Section, TYPE, phasesOf } from "./shared";
import { cn } from "@/lib/utils";
import { useIntelligenceFormat } from "./format";
import type { IntelligenceOverview, TrackedLink } from "./types";

function TrackedLinks({ productId }: { productId: string }) {
  const t = useTranslations("intelligence.links");
  const fmt = useIntelligenceFormat();
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  // Retired links are hidden by default so the common view stays clean, but
  // they stay reachable: a retired link still holds click history inside the
  // 90 day attribution window, and reactivating one is a normal thing to want.
  const [showRetired, setShowRetired] = useState(false);
  const listPath = `/api/intelligence/tracked-links?productId=${encodeURIComponent(productId)}${showRetired ? "&includeInactive=1" : ""}`;
  const links = useApiQuery<{ links: TrackedLink[] }>(listPath);

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

  async function setActive(link: TrackedLink, active: boolean) {
    setPendingCode(link.code);
    try {
      const path = `/api/intelligence/tracked-links/${encodeURIComponent(link.code)}`;
      // Retiring is a soft delete on the server: click and conversion rows
      // reference the code for 90 days, so the row never actually goes away.
      const response = active
        ? await apiPatch(path, { active: true })
        : await apiDelete(path);
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("retireFailed")));
        return;
      }
      toast.success(active ? t("reactivated") : t("retired"));
      invalidateQueries("/api/intelligence/tracked-links");
    } catch {
      toast.error(t("retireFailed"));
    } finally {
      setPendingCode(null);
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
        <p className={cn("mb-4", TYPE.hint)}>{t("empty")}</p>
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
         
          disabled={!label || !destination || creating}
        >
          {creating ? t("creating") : t("create")}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => setShowRetired((current) => !current)}
        className="mt-3 text-xs font-semibold text-muted-foreground hover:underline"
      >
        {showRetired ? t("hideRetired") : t("showRetired")}
      </button>
      {(links.data?.links.length ?? 0) > 0 && (
        <div className="mt-4 divide-y divide-border">
          {links.data?.links.map((link) => {
            const lastClick = fmt.dateTime(link.lastClickedAt);
            return (
              <div key={link.code} className="flex flex-col gap-1.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link2 className="size-3.5 shrink-0 text-mk-ink-40" aria-hidden="true" />
                    <span className="truncate font-semibold text-foreground">{link.label}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-muted-foreground">{link.url}</span>
                    <button
                      type="button"
                      onClick={() => void copy(link.url)}
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-mk-accent hover:underline"
                    >
                      <Copy className="size-3" aria-hidden="true" />
                      {t("copy")}
                    </button>
                  </div>
                  <p className="truncate text-xs text-mk-ink-40">{link.destination}</p>
                  {!link.active && (
                    <span className="mt-1 inline-block rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-medium leading-4 text-muted-foreground">
                      {t("inactive")}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-end">
                  <span className={TYPE.strong}>{t("clicks", { count: link.clicks })}</span>
                  {link.attributedConversions > 0 && (
                    <span className="font-semibold tabular-nums text-mk-pos">{t("conversions", { count: link.attributedConversions })}</span>
                  )}
                  <span>{lastClick ? t("lastClick", { when: lastClick }) : t("noClicks")}</span>
                  <button
                    type="button"
                    disabled={pendingCode === link.code}
                    onClick={() => {
                      if (link.active && !window.confirm(t("confirmRetire"))) return;
                      void setActive(link, !link.active);
                    }}
                    className="shrink-0 text-xs font-semibold text-muted-foreground hover:underline disabled:opacity-60"
                  >
                    {pendingCode === link.code
                      ? t("retiring")
                      : link.active ? t("retire") : t("reactivate")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

const FIT_DIMENSIONS = ["geography", "age", "gender", "industryInterests"] as const;

function AudienceSignals({ data }: { data: IntelligenceOverview }) {
  const t = useTranslations("intelligence.audienceSignals");
  const tDim = useTranslations("intelligence.alignment.dimensions");
  const fmt = useIntelligenceFormat();
  const alignment = data.alignment ?? null;
  const drift = data.drift ?? null;
  const dimensions = alignment
    ? FIT_DIMENSIONS.filter((key) => typeof alignment.dimensions[key] === "number")
    : [];
  return (
    <Section trust="calculated" title={t("title")} subtitle={t("subtitle")}>
      {!alignment || alignment.score === null ? (
        <p className={cn("m-0", TYPE.hint)}>{t("noFit")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div>
            <p className="mk-label">{t("fit")}</p>
            <p className={cn("m-0 mt-1 text-3xl", TYPE.figure)}>{fmt.whole(Math.round(alignment.score))}<span className="text-base text-muted-foreground">/100</span></p>
            <p className={cn("m-0 mt-1", TYPE.hint)}>{t("coverage", { value: Math.round(alignment.coverage * 100) })}</p>
          </div>
          <ul className="m-0 list-none space-y-3 p-0">
            {dimensions.map((key) => {
              const value = alignment.dimensions[key] as number;
              return (
                <li key={key}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">{tDim(key)}</span>
                    <span className={TYPE.figure}>{fmt.whole(Math.round(value))}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-full origin-left rounded-full bg-mk-accent rtl:origin-right" style={{ transform: `scaleX(${Math.max(0, Math.min(1, value / 100))})` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("m-0", TYPE.meta)}>{t("driftTitle")}</p>
          {drift ? <KindBadge tone="amber">{drift.title}</KindBadge> : null}
        </div>
        <p className={cn("m-0 mt-1.5", TYPE.body)}>{drift ? drift.summary : t("noDrift")}</p>
        {drift && <p className={cn("m-0 mt-1", TYPE.hint)}>{t("associationNote")}</p>}
      </div>
    </Section>
  );
}

export function AudienceTab({ productId, data }: { productId: string; data: IntelligenceOverview }) {
  const t = useTranslations("intelligence");
  const phases = phasesOf(data);
  return (
    <div className="space-y-4 sm:space-y-5">
      <Section trust="declared" title={t("audience.title")} subtitle={t("audience.subtitle")} help="audience">
        <AudienceProfileEditor productId={productId} variant="advanced" />
      </Section>

      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        <AudienceSignals data={data} />
      </PhaseGate>

      <PhaseGate enabled={phases.learning} feature="intelligenceOptimization">
        <TrackedLinks productId={productId} />
      </PhaseGate>
    </div>
  );
}
