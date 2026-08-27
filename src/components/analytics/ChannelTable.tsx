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
      <div className="py-8 text-center text-[13px]" style={{ color: "var(--mk-ink-60)" }}>
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--mk-rule)" }}>
            <th className="text-left font-normal py-2 pr-3 mk-eyebrow">{t("columns.channel")}</th>
            <th className="text-right font-normal py-2 px-2 mk-eyebrow">{t("columns.posts")}</th>
            <th className="text-right font-normal py-2 px-2 mk-eyebrow">{t("columns.views")}</th>
            <th className="text-right font-normal py-2 px-2 mk-eyebrow">{t("columns.reach")}</th>
            <th className="text-right font-normal py-2 px-2 mk-eyebrow">{t("columns.engagement")}</th>
            <th className="text-right font-normal py-2 px-2 mk-eyebrow whitespace-nowrap">{t("columns.erReach")}</th>
            <th className="text-right font-normal py-2 pl-2 mk-eyebrow">{t("columns.followers")}</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((row) => {
            const active = activeChannel === row.channel;
            return (
              <tr
                key={row.channel}
                onClick={() => onSelect(active ? undefined : row.channel)}
                className="cursor-pointer transition-colors hover:bg-muted/40"
                title={active ? t("clearFilter") : t("filterTo", { channel: channelLabel(row.channel) })}
                style={{
                  borderBottom: "1px solid var(--mk-rule-soft)",
                  background: active ? "color-mix(in oklch, var(--mk-ink) 4%, transparent)" : undefined,
                }}
              >
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <Channel channel={row.channel} size={18} />
                    <span style={{ color: "var(--mk-ink)" }}>{channelLabel(row.channel)}</span>
                  </span>
                </td>
                <td className="text-right px-2 font-mono mk-figure" style={{ color: "var(--mk-ink)" }}>
                  {row.posts}
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
                  {row.engagementRateByReach === null
                    ? "n/a"
                    : `${(row.engagementRateByReach * 100).toFixed(1)}%`}
                </td>
                <td className="text-right pl-2 font-mono mk-figure whitespace-nowrap" style={{ color: "var(--mk-ink)" }}>
                  {cell(row.followers, locale)}
                  {row.followerDelta !== null && row.followerDelta !== 0 && (
                    <span
                      className="text-[10.5px] ml-1.5"
                      style={{ color: row.followerDelta > 0 ? "var(--mk-pos)" : "var(--mk-neg)" }}
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
