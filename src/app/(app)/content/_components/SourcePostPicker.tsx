"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Pagination from "@/components/app/Pagination";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { channelLabel } from "@/components/mk/channels";
import { evergreenMetricKeys } from "@/lib/evergreen/eligibility";
import { cn } from "@/lib/utils";

export type { EvergreenCandidate as SourceCandidate } from "@/lib/evergreen/candidates";
import type { EvergreenCandidate as SourceCandidate } from "@/lib/evergreen/candidates";

const PAGE_SIZE = 6;

export default function SourcePostPicker({
  candidates,
  value,
  onChange,
  loading,
  mode = "select",
}: {
  candidates: SourceCandidate[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  mode?: "select" | "browse";
}) {
  const t = useTranslations("content.evergreenTab.picker");
  const locale = useLocale();
  const a = useTranslations("content.evergreenTab.assessment");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (q && !c.content.toLowerCase().includes(q) && !channelLabel(c.channel).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [candidates, query]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-mk-ink-40" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={t("search")}
            className="ps-8"
            aria-label={t("search")}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-muted/60" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="m-0 rounded-xl border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
          {t("noMatches")}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2" role={mode === "select" ? "radiogroup" : undefined} aria-label={t("search")}>
          {visible.map((c) => {
            const selected = c.id === value;
            const date = c.publishedAt ? new Date(c.publishedAt).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role={mode === "select" ? "radio" : undefined}
                  aria-checked={mode === "select" ? selected : undefined}
                  onClick={() => onChange(c.id)}
                  className={cn(
                    "flex w-full gap-3 rounded-xl border bg-card p-3 text-start transition-[border-color,box-shadow] hover:border-mk-ink-20",
                    selected ? "border-mk-accent ring-1 ring-mk-accent" : "border-border",
                  )}
                >
                  <PostThumbnail src={c.thumbnailUrl} mediaUrl={c.mediaUrl} channel={c.channel} size={64} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{channelLabel(c.channel)}</span>
                      {date ? <span>{date}</span> : null}
                      <Badge variant="secondary">{a("needsReview")}</Badge>
                      {!c.eligible ? <Badge variant="warning">{t("notReady")}</Badge> : null}
                    </div>
                    <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-5 text-mk-ink-80">{c.content || t("mediaOnly")}</p>
                    <p className="m-0 mt-2 text-xs text-muted-foreground">{a(c.assessment.measurementStatus === "available" ? "measurementsAvailable" : "noMeasurements")}</p>
                    {c.assessment.observations.map((row) => (
                      <div key={row.channel} className="mt-1 text-xs text-muted-foreground">
                        <p className="m-0 font-medium">{channelLabel(row.channel)}</p>
                        <dl className="m-0 flex flex-wrap gap-x-3 gap-y-1">
                        {evergreenMetricKeys.map((key) => (
                          <div key={key} className="flex gap-1">
                            <dt>{a(`metrics.${key}`)}</dt>
                            <dd className="m-0 tabular-nums">{row.metrics[key] === null ? "n/a" : row.metrics[key].toLocaleString(locale)}</dd>
                          </div>
                        ))}
                        </dl>
                      </div>
                    ))}
                    {mode === "browse" && <span className="mt-3 inline-block text-xs font-medium text-mk-accent">{a("reviewForReuse")}</span>}
                    {!c.eligible && c.reasons[0] ? (
                      <p className="m-0 mt-1.5 text-xs text-mk-warn">{t(`reasons.${c.reasons[0]}`)}</p>
                    ) : null}
                  </div>
                  {mode === "select" && <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]",
                      selected ? "border-mk-accent bg-mk-accent text-white" : "border-mk-ink-20",
                    )}
                    aria-hidden
                  >
                    {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && <Pagination page={current} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  );
}
