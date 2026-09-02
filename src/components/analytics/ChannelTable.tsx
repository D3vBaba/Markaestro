"use client";

import { useLocale, useTranslations } from "next-intl";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import type { AnalyticsResponse } from "@/lib/analytics/api-shape";
import type { SocialChannel } from "@/lib/schemas";

function cell(value: number | null, locale?: string): string {
  return value === null ? "n/a" : fmtCount(Math.round(value), locale);
}

/** Reach-based rate when the platform reports reach, otherwise the views-based rate, marked. */
export function rateCell(byReach: number | null, byViews: number | null, viewsMarker: string): string {
  if (byReach !== null) return `${(byReach * 100).toFixed(1)}%`;
  if (byViews !== null) return `${(byViews * 100).toFixed(1)}% ${viewsMarker}`;
  return "n/a";
}

/** Per-channel breakdown; clicking a row toggles the page-level channel filter. */
export function ChannelTable({
  channels,
  activeChannel,
  onSelect,
}: {
  channels: AnalyticsResponse["channels"];
  activeChannel?: SocialChannel;
  onSelect: (channel: SocialChannel | undefined) => void;
}) {
  const t = useTranslations("analytics.channelTable");
  const locale = useLocale();

  if (channels.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-slate-200/80 dark:border-slate-800">
            <th className="text-left font-normal py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.channel")}</th>
            <th className="text-right font-normal py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.posts")}</th>
            <th className="text-right font-normal py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.views")}</th>
            <th className="text-right font-normal py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.reach")}</th>
            <th className="text-right font-normal py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.engagement")}</th>
            <th className="text-right font-normal py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 whitespace-nowrap" title={t("erBasis")}>{t("columns.er")}</th>
            <th className="text-right font-normal py-2 pl-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("columns.followers")}</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((row) => {
            const active = activeChannel === row.channel;
            return (
              <tr
                key={row.channel}
                onClick={() => onSelect(active ? undefined : row.channel)}
                className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/30 ${active ? "bg-slate-100/80 dark:bg-slate-800/50" : ""}`}
                title={active ? t("clearFilter") : t("filterTo", { channel: channelLabel(row.channel) })}
              >
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <Channel channel={row.channel} size={18} />
                    <span className="text-slate-900 dark:text-slate-100">{channelLabel(row.channel)}</span>
                  </span>
                </td>
                <td className="px-2 text-end tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {row.posts}
                </td>
                <td className="px-2 text-end tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {cell(row.views, locale)}
                </td>
                <td className="px-2 text-end tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {cell(row.reach, locale)}
                </td>
                <td className="px-2 text-end tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {cell(row.engagements, locale)}
                </td>
                <td className="whitespace-nowrap px-2 text-end tabular-nums text-slate-500 dark:text-slate-400">
                  {rateCell(row.engagementRateByReach, row.engagementRateByViews, t("byViews"))}
                </td>
                <td className="whitespace-nowrap ps-2 text-end tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {cell(row.followers, locale)}
                  {row.followerDelta !== null && row.followerDelta !== 0 && (
                    <span
                      className={`ms-1.5 text-[10.5px] ${row.followerDelta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                    >
                      {row.followerDelta > 0 ? "▲" : "▼"}{fmtCount(Math.abs(row.followerDelta), locale)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
