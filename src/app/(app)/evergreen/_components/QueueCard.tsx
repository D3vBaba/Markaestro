"use client";

import { useState } from "react";
import { useLocale, useTranslations, useNow } from "next-intl";
import { BarChart3, CalendarClock, ChevronDown, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/mk/Status";
import { Channel } from "@/components/mk/Channel";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import SourceMedia from "./SourceMedia";
import { messageFrom, type Analytics, type Queue } from "./types";

const fmtDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });

export default function QueueCard({ queue, onChanged }: { queue: Queue; onChanged: () => Promise<void> | void }) {
  const t = useTranslations("content.evergreenTab");
  const locale = useLocale();
  const now = useNow();
  const expired = Boolean(queue.expiresAt && Date.parse(queue.expiresAt) <= now.getTime());
  const [working, setWorking] = useState(false);
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const confirmContent = async () => {
    if (!contentConfirmed || !analytics) return;
    setWorking(true);
    const result = await apiPatch(`/api/evergreen-queues/${queue.id}`, { version: queue.version, contentConfirmed: true });
    if (!result.ok) toast.error(messageFrom(result.data, t("actionFailed")));
    else await onChanged();
    setWorking(false);
  };

  const transition = async (action: "activate" | "pause" | "resume" | "archive") => {
    setWorking(true);
    const result = action === "archive"
      ? await apiDelete(`/api/evergreen-queues/${queue.id}`)
      : await apiPost(`/api/evergreen-queues/${queue.id}/${action}`, {});
    if (!result.ok) toast.error(messageFrom(result.data, t("actionFailed")));
    else toast.success(t(`actions.${action}Success`));
    setWorking(false);
    await onChanged();
  };

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (analytics) return;
    setLoading(true);
    const result = await apiGet<{ analytics: Analytics }>(`/api/evergreen-queues/${queue.id}/analytics`);
    if (result.ok) setAnalytics(result.data.analytics);
    else toast.error(messageFrom(result.data, t("analytics.loadFailed")));
    setLoading(false);
  };

  const metric = (value: number | null) => (value == null ? t("analytics.unavailable") : value.toLocaleString(locale));

  return (
    <article className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[15px] font-semibold text-foreground">{queue.name}</h3>
            <Status value={queue.status} label={t(`statuses.${queue.status}`)} />
            <Badge variant="secondary">{t("everyDays", { count: queue.intervalDays })}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {queue.channels.map((channel) => <Channel key={channel} channel={channel} size={18} showLabel />)}
          </div>
          <div className="mt-3 grid gap-1.5 text-[13px] text-muted-foreground">
            <p className="m-0 flex items-center gap-2">
              <CalendarClock className="size-4 text-mk-ink-40" />
              {queue.nextRunAt ? t("nextRun", { date: new Date(queue.nextRunAt).toLocaleString(locale) }) : t("notScheduled")}
            </p>
            <p className="m-0">{t("runs", { count: queue.runCount })}</p>
            <p className="m-0">{expired ? t("assessment.needsUpdate") : queue.contentReview ? t("assessment.reusable") : t("assessment.needsReview")}</p>
            <p className="m-0">{t("assessment.insufficient")}</p>
            {queue.channels.includes("x") && <p className="m-0">{t("assessment.xManual")}</p>}
            {queue.pauseReason && <p className="m-0 text-mk-warn">{t("pausedReason", { reason: queue.pauseReason })}</p>}
            {queue.lastCollisionShift && <p className="m-0">{t("queues.shifted", { days: queue.lastCollisionShift.days })}</p>}
          </div>
          {queue.upcomingRunAts && queue.upcomingRunAts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mk-label me-1">{t("queues.upcoming")}</span>
              {queue.upcomingRunAts.map((iso) => (
                <span key={iso} className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-mk-ink-80">{fmtDate(iso, locale)}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {queue.status === "draft" && (
            <Button size="sm" disabled={working || !queue.contentReview || expired} onClick={() => void transition("activate")}><Play className="size-3.5" />{t("actions.activate")}</Button>
          )}
          {queue.status === "active" && (
            <Button size="sm" variant="outline" disabled={working} onClick={() => void transition("pause")}><Pause className="size-3.5" />{t("actions.pause")}</Button>
          )}
          {queue.status === "paused" && (
            <Button size="sm" disabled={working || !queue.contentReview || expired} onClick={() => void transition("resume")}><Play className="size-3.5" />{t("actions.resume")}</Button>
          )}
          <Button size="sm" variant="ghost" disabled={working} onClick={() => void transition("archive")}>{t("actions.archive")}</Button>
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => void toggle()}>
            <BarChart3 className="size-3.5" />
            {!queue.contentReview ? t("assessment.reviewContent") : t("analytics.details")}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border px-5 py-5">
          {loading ? (
            <p className="m-0 text-[13px] text-muted-foreground">{t("analytics.loading")}</p>
          ) : analytics ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
                {([
                  ["views", metric(analytics.lifetime.views)],
                  ["engagements", metric(analytics.lifetime.engagements)],
                  ["trackedClicks", analytics.lifetime.trackedLinkClicks.toLocaleString(locale)],
                  ["conversions", analytics.lifetime.attributedConversions.toLocaleString(locale)],
                  ["measured", analytics.lifetime.measuredOccurrences.toLocaleString(locale)],
                  ["needsReview", analytics.runs.needsReview.toLocaleString(locale)],
                ] as const).map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <p className="mk-label m-0">{t(`analytics.${label}`)}</p>
                    <p className="mk-figure m-0 mt-1 text-lg font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="m-0 text-sm font-semibold text-foreground">{t("queues.variantsTitle")}</h4>
                <ul className="m-0 mt-3 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0">
                  {analytics.variants.map((variant) => (
                    <li key={variant.variantId} className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !variant.enabled && "bg-muted/40")}>
                      <div className="min-w-0">
                        <p className={cn("m-0 whitespace-pre-wrap text-[13px] leading-5", variant.enabled ? "text-foreground" : "text-muted-foreground line-through")}>{variant.caption}</p>
                        {variant.retiredReason && <p className="m-0 mt-1 text-xs text-mk-warn">{t("queues.variantRetired")}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-muted-foreground">
                        <span>{variant.runs > 0 ? t("queues.variantRuns", { count: variant.runs }) : t("queues.variantNoRuns")}</span>
                        <span>{metric(variant.metrics.views)} {t("summary.views").toLowerCase()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {!queue.contentReview && (
                  <div className="mt-4 space-y-3">
                    <SourceMedia urls={queue.sourceSnapshot?.mediaUrls ?? []} channel={queue.channels[0] ?? ""} />
                    <label className="flex items-start gap-3 text-[13px]">
                      <input type="checkbox" checked={contentConfirmed} onChange={(e) => setContentConfirmed(e.target.checked)} className="mt-1" />
                      {t("assessment.confirm")}
                    </label>
                    <Button size="sm" disabled={!contentConfirmed || working} onClick={() => void confirmContent()}>{t("assessment.saveReview")}</Button>
                  </div>
                )}
              </div>

              <div>
                <h4 className="m-0 text-sm font-semibold text-foreground">{t("analytics.recentRuns")}</h4>
                {analytics.recentRuns.length === 0 ? (
                  <p className="m-0 mt-2 text-[13px] text-muted-foreground">{t("analytics.noRuns")}</p>
                ) : (
                  <ul className="m-0 mt-3 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0">
                    {analytics.recentRuns.map((run) => (
                      <li key={run.runId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="m-0 font-medium text-foreground">{new Date(run.plannedAt).toLocaleString(locale)}</p>
                          <p className="m-0 mt-0.5 text-muted-foreground">{run.reason || "n/a"}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="secondary">{run.status.replaceAll("_", " ")}</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
