"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Channel } from "@/components/mk/Channel";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsPostRow } from "@/lib/analytics/api-shape";

type SortKey = "engagements" | "views" | "reach" | "erByReach" | "publishedAt";

const COLUMN_KEYS: SortKey[] = ["views", "reach", "engagements", "erByReach", "publishedAt"];

const COLUMN_LABEL_KEYS: Record<SortKey, string> = {
  views: "columns.views",
  reach: "columns.reach",
  engagements: "columns.engagement",
  erByReach: "columns.erReach",
  publishedAt: "columns.published",
};

// On phones the table scrolls horizontally; keep it from collapsing to
// min-content so the scroll affordance engages instead of crushed columns.
const TABLE_MIN_W = "min-w-[640px]";

function cell(value: number | null, locale?: string): string {
  return value === null ? "—" : fmtCount(Math.round(value), locale);
}

/** Top posts, sortable by any metric. Unavailable metrics render as "—". */
export function LeaderboardTable({ rows }: { rows: AnalyticsPostRow[] }) {
  const t = useTranslations("analytics.leaderboardTable");
  const locale = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>("engagements");

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      if (sortKey === "publishedAt") return b.publishedAt.localeCompare(a.publishedAt);
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return bv - av;
    });
    return list;
  }, [rows, sortKey]);

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: "var(--mk-ink-60)" }}>
        {t("empty")}
      </div>
    );
  }

  return (
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
          {sorted.map((row) => (
            <tr
              key={row.id}
              className="hover:bg-muted/40 transition-colors"
              style={{ borderBottom: "1px solid var(--mk-rule-soft)" }}
            >
              <td className="py-2.5 pr-3">
                <Link href={`/content/${row.id}`} className="flex items-start gap-2.5 min-w-0">
                  <div className="flex items-center gap-1 pt-0.5 shrink-0">
                    {row.channels.map((ch) => (
                      <Channel key={ch} channel={ch} size={15} />
                    ))}
                  </div>
                  <span
                    className="line-clamp-2 min-w-0"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                  >
                    {row.content || t("untitledPost")}
                  </span>
                </Link>
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
              <td className="text-right px-2 font-mono" style={{ color: "var(--mk-ink-60)" }}>
                {row.erByReach === null ? "—" : `${(row.erByReach * 100).toFixed(1)}%`}
              </td>
              <td
                className="text-right px-2 font-mono text-[11px] whitespace-nowrap"
                style={{ color: "var(--mk-ink-40)" }}
              >
                {row.publishedAt ? new Date(row.publishedAt).toLocaleDateString(locale) : "—"}
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
  );
}
