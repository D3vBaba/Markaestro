"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Pagination from "@/components/app/Pagination";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import { cn } from "@/lib/utils";

export type SourceCandidate = {
  id: string;
  content: string;
  channel: string;
  channels: string[];
  publishedAt: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  engagements: number;
  views: number;
  engagementRate: number | null;
  eligible: boolean;
  reasons: string[];
  suggested: boolean;
};

const PAGE_SIZE = 6;
type Filter = "suggested" | "eligible" | "all";

/**
 * Pick the post an evergreen queue repeats. Suggested posts (the strongest
 * measured ones) come first; the rest are browsable and searchable, and posts
 * that are not ready yet say why instead of being hidden.
 */
export default function SourcePostPicker({
  candidates,
  value,
  onChange,
  loading,
}: {
  candidates: SourceCandidate[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  const t = useTranslations("content.evergreenTab.picker");
  const locale = useLocale();
  const suggestedCount = candidates.filter((c) => c.suggested).length;
  const [filter, setFilterState] = useState<Filter>("all");
  const [touched, setTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  // Candidates arrive after mount; land on Suggested once we know there are
  // some, unless the user already picked a filter.
  if (!touched && suggestedCount > 0 && filter !== "suggested") setFilterState("suggested");
  const setFilter = (next: Filter) => { setTouched(true); setFilterState(next); };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (filter === "suggested" && !c.suggested) return false;
      if (filter === "eligible" && !c.eligible) return false;
      if (q && !c.content.toLowerCase().includes(q) && !channelLabel(c.channel).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [candidates, filter, query]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const counts = {
    suggested: suggestedCount,
    eligible: candidates.filter((c) => c.eligible).length,
    all: candidates.length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setPage(1); }}>
          <TabsList>
            {(["suggested", "eligible", "all"] as Filter[]).map((key) => (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                {t(`filters.${key}`)}
                <span className="tabular-nums text-mk-ink-40">{counts[key]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
          {filter === "suggested" ? t("noSuggested") : t("noMatches")}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2" role="radiogroup" aria-label={t("search")}>
          {visible.map((c) => {
            const selected = c.id === value;
            const date = c.publishedAt ? new Date(c.publishedAt).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
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
                      {c.suggested ? <Badge variant="accent">{t("suggested")}</Badge> : null}
                      {!c.eligible ? <Badge variant="warning">{t("notReady")}</Badge> : null}
                    </div>
                    <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-5 text-mk-ink-80">{c.content || t("mediaOnly")}</p>
                    <dl className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-baseline gap-1">
                        <dt className="text-muted-foreground">{t("engagements")}</dt>
                        <dd className="m-0 font-semibold tabular-nums text-foreground">{fmtCount(c.engagements, locale)}</dd>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <dt className="text-muted-foreground">{t("views")}</dt>
                        <dd className="m-0 font-semibold tabular-nums text-foreground">{c.views > 0 ? fmtCount(c.views, locale) : "n/a"}</dd>
                      </div>
                      {c.engagementRate !== null && (
                        <div className="flex items-baseline gap-1">
                          <dt className="text-muted-foreground">{t("rate")}</dt>
                          <dd className="m-0 font-semibold tabular-nums text-mk-pos">{(c.engagementRate * 100).toFixed(1)}%</dd>
                        </div>
                      )}
                    </dl>
                    {!c.eligible && c.reasons[0] ? (
                      <p className="m-0 mt-1.5 text-xs text-mk-warn">{t(`reasons.${c.reasons[0]}`)}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]",
                      selected ? "border-mk-accent bg-mk-accent text-white" : "border-mk-ink-20",
                    )}
                    aria-hidden
                  >
                    {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
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
