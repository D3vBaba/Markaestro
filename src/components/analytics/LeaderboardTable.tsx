"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Channel } from "@/components/mk/Channel";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsPostRow } from "@/lib/analytics/api-shape";

type SortKey = "engagements" | "views" | "reach" | "erByReach" | "publishedAt";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "engagements", label: "Engagement" },
  { key: "erByReach", label: "ER (reach)" },
  { key: "publishedAt", label: "Published" },
];

function cell(value: number | null): string {
  return value === null ? "—" : fmtCount(Math.round(value));
}

/** Top posts, sortable by any metric. Unavailable metrics render as "—". */
export function LeaderboardTable({ rows }: { rows: AnalyticsPostRow[] }) {
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
        No posts with metrics in this period yet. Metrics arrive about an hour after publishing.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--mk-rule)" }}>
            <th
              className="text-left font-normal py-2 pr-3 mk-eyebrow"
              style={{ minWidth: 220 }}
            >
              Post
            </th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="text-right font-normal py-2 px-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setSortKey(col.key)}
                  className="mk-eyebrow inline-flex items-center gap-1 cursor-pointer hover:opacity-70"
                  title={`Sort by ${col.label}`}
                >
                  {col.label}
                  {sortKey === col.key && <ArrowDown className="h-3 w-3" />}
                </button>
              </th>
            ))}
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
                    {row.content || "Untitled post"}
                  </span>
                </Link>
              </td>
              <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                {cell(row.views)}
              </td>
              <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                {cell(row.reach)}
              </td>
              <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                {cell(row.engagements)}
              </td>
              <td className="text-right px-2 font-mono" style={{ color: "var(--mk-ink-60)" }}>
                {row.erByReach === null ? "—" : `${(row.erByReach * 100).toFixed(1)}%`}
              </td>
              <td
                className="text-right px-2 font-mono text-[11px] whitespace-nowrap"
                style={{ color: "var(--mk-ink-40)" }}
              >
                {row.publishedAt ? new Date(row.publishedAt).toLocaleDateString() : "—"}
              </td>
              <td className="text-right pl-1">
                {row.externalUrl && (
                  <a
                    href={row.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open on platform"
                    className="inline-flex opacity-50 hover:opacity-100"
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
