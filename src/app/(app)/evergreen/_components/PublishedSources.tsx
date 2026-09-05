"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/app/Section";
import { Button } from "@/components/ui/button";
import SourcePostPicker, { type SourceCandidate } from "@/app/(app)/content/_components/SourcePostPicker";

/** Source data is useful before any queue exists and regardless of recommendation availability. */
export default function PublishedSources({ candidates, loading, failed, onRetry, onReview }: {
  candidates: SourceCandidate[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onReview: (id: string) => void;
}) {
  const t = useTranslations("content.evergreenTab.library");
  const measured = candidates.filter((c) => c.assessment.measurementStatus === "available").length;
  return (
    <Section title={t("title")} description={t("description")}>
      {failed && !loading ? (
        <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="m-0">{t("failed")}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {!loading && candidates.length > 0 && <p className="m-0 text-sm text-muted-foreground">{t("counts", { count: candidates.length, measured })}</p>}
          <SourcePostPicker candidates={candidates} loading={loading} value="" mode="browse" onChange={onReview} />
        </div>
      )}
    </Section>
  );
}
