"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Channel } from "@/components/mk/Channel";
import { fmtCount } from "@/components/mk/format";
import { rateCell } from "@/components/analytics/ChannelTable";
import Pagination from "@/components/app/Pagination";
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

// On phones the table scrolls horizontally; keep it from collapsing to
// min-content so the scroll affordance engages instead of crushed columns.
const TABLE_MIN_W = "min-w-[640px]";

function cell(value: number | null, locale?: string): string {
  return value === null ? "n/a" : fmtCount(Math.round(value), locale);
}

/** Top posts, sortable by any metric. Unavailable metrics render as "n/a". */
export function LeaderboardTable({ rows }: { rows: AnalyticsPostRow[] }) {
  const t = useTranslations("analytics.leaderboardTable");
  const locale = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>("engagements");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      if (sortKey === "publishedAt") return b.publishedAt.localeCompare(a.publishedAt);
      const pick = (row: AnalyticsPostRow) => (sortKey === "erByReach" ? row.erByReach ?? row.erByViews : row[sortKey]);
      const av = pick(a) ?? -1;
      const bv = pick(b) ?? -1;
      return bv - av;
    });
    return list;
  }, [rows, sortKey]);

  // A new sort or a fresh data set changes what page 1 means — reset instead
  // of stranding the user on a page number that no longer lines up.
  const [pagedFor, setPagedFor] = useState({ rows, sortKey });
  if (pagedFor.rows !== rows || pagedFor.sortKey !== sortKey) {
    setPagedFor({ rows, sortKey });
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: "var(--mk-ink-60)" }}>
        {t("empty")}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className={`w-full ${TABLE_MIN_W} border-collapse text-[12.5px]`}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--mk-rule)" }}>
              <th
                className="text-left font-normal py-2 pr-3 mk-eyebrow"
                style={{ minWidth: 220 }}
              >
                {t("post")}
              </th>
              {COLUMN_KEYS.map((key) => {
                const label = t(COLUMN_LABEL_KEYS[key]);
                return (
                  <th key={key} className="text-right font-normal py-2 px-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSortKey(key)}
                      className="mk-eyebrow inline-flex items-center gap-1 cursor-pointer hover:opacity-70 py-2.5 -my-2.5 px-1 -mx-1"
                      title={t("sortBy", { label })}
                    >
                      {label}
                      {sortKey === key && <ArrowDown className="h-3 w-3" />}
                    </button>
                  </th>
                );
              })}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-muted/40 transition-colors"
                style={{ borderBottom: "1px solid var(--mk-rule-soft)" }}
              >
                <td className="py-2.5 pr-3">
                  {/* Published posts have no in-app detail page; the live
                      post is the useful destination, so the caption opens it. */}
                  {row.externalUrl ? (
                    <a
                      href={row.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2.5 min-w-0 hover:underline"
                      title={t("openOnPlatform")}
                    >
                      <div className="flex items-center gap-1 pt-0.5 shrink-0">
                        {row.channels.map((ch) => (
                          <Channel key={ch} channel={ch} size={15} />
                        ))}
                      </div>
                      <span className="line-clamp-2 min-w-0" style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}>
                        {row.content || t("untitledPost")}
                      </span>
                    </a>
                  ) : (
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex items-center gap-1 pt-0.5 shrink-0">
                        {row.channels.map((ch) => (
                          <Channel key={ch} channel={ch} size={15} />
                        ))}
                      </div>
                      <span className="line-clamp-2 min-w-0" style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}>
                        {row.content || t("untitledPost")}
                      </span>
                    </div>
                  )}
                </td>
                <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {cell(row.views, locale)}
                </td>
                <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {cell(row.reach, locale)}
                </td>
                <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {cell(row.engagements, locale)}
                </td>
                <td className="text-right px-2 font-mono whitespace-nowrap" style={{ color: "var(--mk-ink-60)" }}>
                  {rateCell(row.erByReach, row.erByViews, t("byViews"))}
                </td>
                <td
                  className="text-right px-2 font-mono text-[11px] whitespace-nowrap"
                  style={{ color: "var(--mk-ink-40)" }}
                >
                  {row.publishedAt ? new Date(row.publishedAt).toLocaleDateString(locale) : "n/a"}
                </td>
                <td className="text-right pl-1">
                  {row.externalUrl && (
                    <a
                      href={row.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("openOnPlatform")}
                      className="inline-flex opacity-70 hover:opacity-100 p-2 -m-2"
                      style={{ color: "var(--mk-ink)" }}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
