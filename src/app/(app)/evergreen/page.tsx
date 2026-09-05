"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/app/PageHeader";
import Section from "@/components/app/Section";
import EmptyState from "@/components/app/EmptyState";
import BrandSwitcher from "@/components/app/BrandSwitcher";
import { StatGrid, StatTile } from "@/components/app/StatTile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { channelLabel } from "@/components/mk/channels";
import { fmtCount } from "@/components/mk/format";
import { apiGet, apiPatch, getApiWorkspaceId, subscribeApiWorkspaceId } from "@/lib/api-client";
import type { SourceCandidate } from "@/app/(app)/content/_components/SourcePostPicker";
import QueueCard from "./_components/QueueCard";
import CreateQueueSheet from "./_components/CreateQueueSheet";
import { messageFrom, type EarnedSummary, type Queue, type ReviewRow } from "./_components/types";

const STORAGE_KEY = "markaestro_default_product";
type Product = { id: string; name: string };

function EvergreenPageContent() {
  const workspaceId = useSyncExternalStore(subscribeApiWorkspaceId, getApiWorkspaceId, () => "default");
  return <EvergreenWorkspace key={workspaceId} workspaceId={workspaceId} />;
}

function EvergreenWorkspace({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("content.evergreenTab");
  const params = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void apiGet<{ products: Product[] }>("/api/products", workspaceId).then((res) => {
      if (cancelled) return;
      if (!res.ok) { toast.error(t("loadFailed")); return; }
      const list = res.data.products || [];
      setProducts(list);
      const fromUrl = params.get("brand");
      const saved = localStorage.getItem(`${STORAGE_KEY}:${workspaceId}`);
      const pick = [fromUrl, saved].find((id) => id && list.some((p) => p.id === id)) ?? list[0]?.id ?? "";
      setProductId(pick);
    });
    return () => { cancelled = true; };
  }, [workspaceId, params, t]);

  const changeProduct = (id: string) => {
    setProductId(id);
    localStorage.setItem(`${STORAGE_KEY}:${workspaceId}`, id);
  };

  return <EvergreenBrand key={productId} workspaceId={workspaceId} productId={productId} products={products} changeProduct={changeProduct} initialSourceId={params.get("brand") === productId ? params.get("source") : null} />;
}

function EvergreenBrand({ workspaceId, productId, products, changeProduct, initialSourceId }: {
  workspaceId: string;
  productId: string;
  products: Product[];
  changeProduct: (id: string) => void;
  initialSourceId: string | null;
}) {
  const t = useTranslations("content.evergreenTab");
  const tBar = useTranslations("content.page.productBar");
  const locale = useLocale();
  const [queues, setQueues] = useState<Queue[]>([]);
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState<EarnedSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(productId));
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(Boolean(initialSourceId));
  const [createSource, setCreateSource] = useState<string | null>(initialSourceId);
  const [createKey, setCreateKey] = useState(0);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    const q = encodeURIComponent(productId);
    void Promise.all([
      apiGet<{ queues: Queue[] }>(`/api/evergreen-queues?productId=${q}`, workspaceId),
      apiGet<{ candidates: SourceCandidate[] }>(`/api/evergreen-queues/candidates?productId=${q}`, workspaceId),
      apiGet<{ reviews: ReviewRow[] }>(`/api/evergreen-queues/reviews?productId=${q}`, workspaceId),
      apiGet<{ summary: EarnedSummary }>(`/api/evergreen-queues/summary?productId=${q}&days=30`, workspaceId),
    ]).then(([queueRes, candidateRes, reviewRes, summaryRes]) => {
      if (cancelled) return;
      setQueues(queueRes.ok ? queueRes.data.queues.filter((queue) => queue.status !== "archived") : []);
      setCandidates(candidateRes.ok ? candidateRes.data.candidates : []);
      setReviews(reviewRes.ok ? reviewRes.data.reviews : []);
      setSummary(summaryRes.ok ? summaryRes.data.summary : null);
      if ([queueRes, candidateRes, reviewRes, summaryRes].some((res) => !res.ok)) toast.error(t("loadFailed"));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [workspaceId, productId, revision, t]);

  const load = () => {
    setLoading(true);
    setRevision((current) => current + 1);
  };

  const review = async (row: ReviewRow, action: "approve" | "skip") => {
    setReviewBusy(row.runId);
    const res = await apiPatch(`/api/evergreen-queues/${row.queueId}/runs/${row.runId}`, { action }, workspaceId);
    setReviewBusy(null);
    if (!res.ok) { toast.error(messageFrom(res.data, t("reviews.failed"))); return; }
    toast.success(action === "approve" ? t("reviews.approved") : t("reviews.skipped"));
    load();
  };

  const metric = (value: number | null | undefined) => (value == null ? "n/a" : fmtCount(value, locale));

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("assessment.pageSubtitle")}
        action={
          <>
            <BrandSwitcher label={tBar("brand")} emptyLabel={tBar("noBrandSelected")} products={products} value={productId} onChange={changeProduct} />
            <Button size="sm" disabled={!productId} onClick={() => { setCreateSource(null); setCreateKey((k) => k + 1); setCreateOpen(true); }}>
              <Plus className="size-4" />{t("newQueue")}
            </Button>
          </>
        }
      />

      {!productId ? (
        <EmptyState icon={Repeat} title={t("selectBrand")} />
      ) : (
        <div className="space-y-10">
          {reviews.length > 0 && (
            <Section title={t("reviews.title")} description={t("reviews.subtitle")} bordered>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {reviews.map((row) => (
                  <li key={row.runId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <PostThumbnail src={row.thumbnailUrl} mediaUrl={row.mediaUrl} channel={row.channel} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{row.queueName}</span>
                        <span>{t("reviews.plannedFor", { date: new Date(row.plannedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })}</span>
                        {row.channels.map((c) => <Badge key={c} variant="secondary">{channelLabel(c)}</Badge>)}
                      </div>
                      <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-5 text-foreground">{row.content}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button size="sm" disabled={reviewBusy === row.runId} onClick={() => void review(row, "approve")}>{t("reviews.approve")}</Button>
                      <Button size="sm" variant="outline" asChild><Link href="/content?tab=drafts">{t("reviews.edit")}</Link></Button>
                      <Button size="sm" variant="ghost" disabled={reviewBusy === row.runId} onClick={() => void review(row, "skip")}>{t("reviews.skip")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t("queues.title")}>
            {loading && queues.length === 0 ? (
              <div className="grid gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
            ) : queues.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title={t("empty")}
                action={<Button onClick={() => { setCreateSource(null); setCreateKey((k) => k + 1); setCreateOpen(true); }}><Plus className="size-4" />{t("newQueue")}</Button>}
              />
            ) : (
              <div className="grid gap-4">
                {queues.map((queue) => <QueueCard key={`${queue.id}-${queue.version}`} queue={queue} onChanged={load} />)}
              </div>
            )}
          </Section>

          <Section title={t("summary.title")} description={summary ? t("summary.window", { days: summary.days }) : undefined}>
            {loading && !summary ? (
              <Skeleton className="h-28 w-full rounded-xl" />
            ) : summary && summary.occurrences > 0 ? (
              <div className="space-y-4">
                <StatGrid columns={4}>
                  <StatTile label={t("summary.occurrences")} value={String(summary.occurrences)} />
                  <StatTile label={t("summary.views")} value={metric(summary.evergreen.views)} />
                  <StatTile label={t("summary.engagements")} value={metric(summary.evergreen.engagements)} />
                  <StatTile label={t("summary.clicks")} value={String(summary.evergreen.trackedLinkClicks)} sub={`${summary.evergreen.attributedConversions} ${t("summary.conversions").toLowerCase()}`} />
                </StatGrid>
                <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
                  {(["evergreen", "fresh"] as const).map((kind) => (
                    <div key={kind} className="bg-card px-5 py-4">
                      <p className="mk-label m-0">{t("summary.perPost")}</p>
                      <p className="m-0 mt-1 text-sm font-semibold text-foreground">{kind === "evergreen" ? t("summary.evergreenLabel") : t("summary.freshLabel")}</p>
                      <p className="mk-figure m-0 mt-1 text-lg font-semibold text-foreground">
                        {metric(summary.perPost[kind].views)} <span className="text-xs font-medium text-muted-foreground">{t("summary.views").toLowerCase()}</span>
                        <span className="mx-2 text-mk-ink-20">·</span>
                        {summary.perPost[kind].engagements ?? "n/a"} <span className="text-xs font-medium text-muted-foreground">{t("summary.engagements").toLowerCase()}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="m-0 rounded-xl border border-border bg-card px-5 py-6 text-[13px] text-muted-foreground">{t("summary.empty")}</p>
            )}
          </Section>


        </div>
      )}

      {productId && (
        <CreateQueueSheet
          key={createKey}
          open={createOpen}
          onOpenChange={setCreateOpen}
          productId={productId}
          candidates={candidates}
          candidatesLoading={loading}
          initialSourceId={createSource}
          onCreated={load}
        />
      )}
    </>
  );
}

export default function EvergreenPage() {
  return (
    <Suspense fallback={null}>
      <EvergreenPageContent />
    </Suspense>
  );
}
