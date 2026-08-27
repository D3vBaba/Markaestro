"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const METRIC_KEYS = ["reach", "views", "engagements", "followers_gained", "clicks", "leads", "installs", "purchases", "conversions", "custom"] as const;

/** Locale-aware number, percent, date, and posting-window formatting shared by the tabs. */
export function useIntelligenceFormat() {
  const locale = useLocale();
  const t = useTranslations("intelligence");
  return useMemo(() => {
    const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    const wholeFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const hourFormat = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

    const weekday = (short: string): string => (
      (WEEKDAY_KEYS as readonly string[]).includes(short) ? t(`weekdays.${short as (typeof WEEKDAY_KEYS)[number]}`) : short
    );
    const hour = (value: string | number): string => {
      const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return String(value);
      return hourFormat.format(new Date(Date.UTC(2026, 0, 5, parsed, 0, 0)));
    };

    return {
      locale,
      /** Compact count; null renders as n/a, never 0. */
      metric(value: number | null | undefined): string {
        if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
        return compact.format(value);
      },
      whole(value: number | null | undefined): string {
        if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
        return wholeFormat.format(value);
      },
      /** Ratio (0.034) rendered as a percent string (3.4%). */
      rate(value: number | null | undefined): string {
        if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
        return `${oneDecimal.format(value * 100)}%`;
      },
      /** Signed percent from a percent value (12.3 -> +12%). */
      signedPercent(value: number | null | undefined): string {
        if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
        const rounded = Math.round(value);
        return `${rounded > 0 ? "+" : ""}${wholeFormat.format(rounded)}%`;
      },
      date(value: string | null | undefined): string | null {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? dateFormat.format(parsed) : null;
      },
      dateTime(value: string | null | undefined): string | null {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? dateTimeFormat.format(parsed) : null;
      },
      weekday,
      hour,
      /** "Tuesday at 3:00 PM" from `Tue` + `15`. */
      window(weekdayShort: string, hourValue: string | number): string {
        return t("timing.window", { weekday: weekday(weekdayShort), hour: hour(hourValue) });
      },
      metricName(metric: string | null | undefined): string {
        if (!metric || !(METRIC_KEYS as readonly string[]).includes(metric)) return metric || "";
        return t(`objective.metrics.${metric as (typeof METRIC_KEYS)[number]}`);
      },
    };
  }, [locale, t]);
}
