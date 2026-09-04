"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUpRight, ChevronDown } from "lucide-react";
import { Channel } from "@/components/mk/Channel";
import { fmtCount } from "@/components/mk/format";
import Pagination from "@/components/app/Pagination";
import { rateCell } from "@/components/analytics/ChannelTable";
import { PostMetricsHistory } from "@/components/analytics/PostMetricsHistory";
import type { AnalyticsPostRow } from "@/lib/analytics/api-shape";

const PAGE_SIZE = 20;

type SortKey = "engagements" | "views" | "reach" | "erByReach" | "publishedAt";

const COLUMN_KEYS: SortKey[] = ["views", "reach", "engagements", "erByReach", "publishedAt"];
const COLUMN_LABEL_KEYS: Record<SortKey, string> = {
  views: "columns.views",
  reach: "columns.reach",
  engagements: "columns.engagement",
  erByReach: "columns.er",
  publishedAt: "columns.published",
};

const EYEBROW = "text-xs font-medium  text-muted-foreground ";
const FIGURE = "tabular-nums font-semibold text-foreground ";

function cell(value: number | null, locale?: string): string {
  return value === null ? "n/a" : fmtCount(Math.round(value), locale);
}

/** Top posts, sortable by any metric, each expandable into its metric history. */
export function LeaderboardTable({ rows }: { rows: AnalyticsPostRow[] }) {
  const t = useTranslations("analytics.leaderboardTable");
  const h = useTranslations("analytics.history");
  const locale = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>("engagements");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      if (sortKey === "publishedAt") return b.publishedAt.localeCompare(a.publishedAt);
      const pick = (row: AnalyticsPostRow) => (sortKey === "erByReach" ? row.erByReach ?? row.erByViews : row[sortKey]);
      return (pick(b) ?? -1) - (pick(a) ?? -1);
    });
    return list;
  }, [rows, sortKey]);

  // A new sort or a fresh data set changes what page 1 means. Reset instead
  // of stranding the user on a page number that no longer lines up.
  const [pagedFor, setPagedFor] = useState({ rows, sortKey });
  if (pagedFor.rows !== rows || pagedFor.sortKey !== sortKey) {
    setPagedFor({ rows, sortKey });
    setPage(1);
    setOpenId(null);
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) {
    return <div className="py-10 text-center text-[13px] text-muted-foreground">{t("empty")}</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              <th className={`py-2 pe-3 text-start font-normal ${EYEBROW}`} style={{ minWidth: 240 }}>{t("post")}</th>
              {COLUMN_KEYS.map((key) => {
                const label = t(COLUMN_LABEL_KEYS[key]);
                return (
                  <th key={key} className="whitespace-nowrap px-2 py-2 text-end font-normal">
                    <button
                      type="button"
                      onClick={() => setSortKey(key)}
                      className={`-mx-1 -my-2.5 inline-flex cursor-pointer items-center gap-1 px-1 py-2.5 hover:text-mk-ink-80 ${EYEBROW}`}
                      title={t("sortBy", { label })}
                    >
                      {label}
                      {sortKey === key && <ArrowDown className="size-3" />}
                    </button>
                  </th>
                );
              })}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((row) => {
              const open = openId === row.id;
              return [
                <tr key={row.id} className="border-b border-mk-rule-soft transition-colors hover:bg-muted/60">
                  <td className="py-2.5 pe-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="flex shrink-0 items-center gap-1 pt-0.5">
                        {row.channels.map((ch) => <Channel key={ch} channel={ch} size={15} />)}
                      </div>
                      <span className="line-clamp-2 min-w-0 text-foreground">{row.content || t("untitledPost")}</span>
                    </div>
                  </td>
                  <td className={`px-2 text-end ${FIGURE}`}>{cell(row.views, locale)}</td>
                  <td className={`px-2 text-end ${FIGURE}`}>{cell(row.reach, locale)}</td>
                  <td className={`px-2 text-end ${FIGURE}`}>{cell(row.engagements, locale)}</td>
                  <td className="whitespace-nowrap px-2 text-end tabular-nums text-muted-foreground">{rateCell(row.erByReach, row.erByViews, t("byViews"))}</td>
                  <td className="whitespace-nowrap px-2 text-end text-[11px] tabular-nums text-mk-ink-40">
                    {row.publishedAt ? new Date(row.publishedAt).toLocaleDateString(locale) : "n/a"}
                  </td>
                  <td className="ps-1 text-end">
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : row.id)}
                        aria-expanded={open}
                        title={h("button")}
                        className="inline-flex size-7 items-center justify-center rounded-md text-mk-ink-40 hover:bg-muted hover:text-mk-ink-80"
                      >
                        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                      {row.externalUrl && (
                        <a
                          href={row.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("openOnPlatform")}
                          className="inline-flex size-7 items-center justify-center rounded-md text-mk-ink-40 hover:bg-muted hover:text-mk-ink-80"
                        >
                          <ArrowUpRight className="size-3.5" />
                        </a>
                      )}
                    </span>
                  </td>
                </tr>,
                open ? (
                  <tr key={`${row.id}-history`} className="border-b border-mk-rule-soft bg-muted/60">
                    <td colSpan={7} className="px-3 py-3">
                      <p className={`mb-2 ${EYEBROW}`}>{h("title")}</p>
                      <PostMetricsHistory postId={row.id} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
