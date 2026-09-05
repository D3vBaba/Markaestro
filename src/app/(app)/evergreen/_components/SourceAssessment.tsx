"use client";

import { useLocale, useTranslations } from "next-intl";
import { channelLabel } from "@/components/mk/channels";
import { evergreenMetricKeys, type EvergreenEligibility } from "@/lib/evergreen/eligibility";
import { evergreenBenchmarkReferences } from "@/lib/evergreen/benchmarks";

export default function SourceAssessment({ assessment }: { assessment: EvergreenEligibility }) {
  const t = useTranslations("content.evergreenTab.assessment");
  const locale = useLocale();
  const references = evergreenBenchmarkReferences.filter((r) => assessment.channels.some((c) => c === r.channel));
  return (
    <div className="space-y-3 rounded-xl border border-border p-4 text-[13px]">
      <p className="m-0 font-medium">{t("needsReview")} · {t("insufficient")}</p>
      <p className="m-0 text-muted-foreground">{t("manualHint")}</p>
      <p className="m-0 text-muted-foreground">{t("unavailable")}: {t("benchmarkReason")}</p>
      {assessment.observations.map((row) => (
        <div key={row.channel} className="space-y-1">
          <p className="m-0 font-medium">{channelLabel(row.channel)}</p>
          <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1">
            {evergreenMetricKeys.map((key) => (
              <div key={key} className="flex gap-1">
                <dt className="text-muted-foreground">{t(`metrics.${key}`)}</dt>
                <dd className="m-0 tabular-nums">{row.metrics[key] === null ? "n/a" : row.metrics[key].toLocaleString(locale)}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-xs text-muted-foreground">{row.capturedAt ? t("captured", { date: new Date(row.capturedAt).toLocaleString(locale) }) : t("unknownCapture")}</p>
        </div>
      ))}
      <details>
        <summary className="cursor-pointer font-medium">{t("references")}</summary>
        <p className="my-2 text-muted-foreground">{t("referenceHint")}</p>
        {references.length ? (
          <ul className="m-0 list-none space-y-3 p-0">
            {references.map((r) => (
              <li key={`${r.channel}-${r.format}`}>
                <a className="underline" href={r.url} target="_blank" rel="noreferrer">Socialinsider · {r.period} · {channelLabel(r.channel)} · {t(`formats.${r.format}`)}</a>
                <p className="m-0">{t("average", { value: r.percent.toLocaleString(locale, { maximumFractionDigits: 2 }) })}</p>
                <p className="m-0 text-xs text-muted-foreground">{r.formula}</p>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-muted-foreground">{t("noReference")}</p>}
      </details>
    </div>
  );
}
