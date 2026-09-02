"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ExternalLink, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import PlatformPreview from "@/components/app/PlatformPreview";
import Select from "@/components/app/Select";
import { apiPost } from "@/lib/api-client";
import { userFacingError } from "@/lib/user-facing-errors";
import { channelLabel } from "@/components/mk/channels";
import { cn } from "@/lib/utils";
import { ChannelDot, DraftButton, EmptyState, INSET, KindBadge, Section, TYPE, TrustBadge } from "./shared";
import { useIntelligenceFormat } from "./format";
import type { IntelligenceOverview, PostExplanation, PostRow } from "./types";

type SortKey = "objective" | "views" | "engagements";

function sortValue(post: PostRow, key: SortKey): number {
  const value = key === "objective" ? post.objectiveValue ?? post.views : key === "views" ? post.views : post.engagements;
  return value ?? Number.NEGATIVE_INFINITY;
}

function WhyItWorked({ productId, post }: { productId: string; post: PostRow }) {
  const t = useTranslations("intelligence.content.why");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<PostExplanation | null>(null);
  const measured = post.views !== null || post.engagements !== null;

  async function load() {
    if (explanation) {
      setOpen((value) => !value);
      return;
    }
    setLoading(true);
    setOpen(true);
    try {
      const response = await apiPost<{ explanation: PostExplanation }>(
        `/api/intelligence/posts/${encodeURIComponent(post.id)}/explain`,
        { productId, locale },
        undefined,
        { timeoutMs: 60_000 },
      );
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("failed"), { VALIDATION_POST_NOT_MEASURED: t("notMeasured") }));
        setOpen(false);
        return;
      }
      setExplanation(response.data.explanation);
    } catch {
      toast.error(t("failed"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  if (!measured) return null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:underline disabled:opacity-60 dark:text-violet-300"
      >
        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
        {loading ? t("loading") : t("button")}
      </button>
      {open && explanation && (
        <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 p-3 dark:border-violet-900/60 dark:bg-violet-950/30">
          <div className="mb-1.5"><TrustBadge kind="generated" /></div>
          <p className={TYPE.body}>{explanation.summary}</p>
          {explanation.factors.length > 0 && (
            <div className="mt-2">
              <p className={TYPE.meta}>{t("factors")}</p>
              <ul className="mt-1 space-y-1">
                {explanation.factors.map((factor) => (
                  <li key={factor.label} className={TYPE.hint}>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{factor.label}:</span> {factor.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {explanation.tryNext && (
            <p className={cn("mt-2", TYPE.hint)}>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{t("tryNext")}:</span> {explanation.tryNext}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={TYPE.meta}>{label}</p>
      <p className={cn(TYPE.figure, emphasis ? "text-lg" : "text-sm text-slate-700 dark:text-slate-200")}>{value}</p>
    </div>
  );
}

function PostCard({ post, productId, objectiveMetric, rank }: { post: PostRow; productId: string; objectiveMetric: string; rank?: number }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const [preview, setPreview] = useState(false);
  const media = post.mediaUrls?.length ? post.mediaUrls : post.thumbnailUrl ? [post.thumbnailUrl] : [];
  const date = fmt.date(post.publishedAt);
  const patterns = post.fingerprint;
  const canPreview = Boolean(post.content || media.length > 0);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200/80 p-4 dark:border-slate-800/80">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {typeof rank === "number" && <span className={cn("w-5 shrink-0 text-xs tabular-nums", rank === 1 ? "font-bold text-emerald-600" : "text-slate-400")}>{rank}</span>}
          <ChannelDot platform={post.platform} />
        </div>
        <span className={cn("truncate", TYPE.hint)}>
          {date ? t("content.published", { date }) : post.username ? `@${post.username}` : ""}
        </span>
      </div>

      <p className={cn("line-clamp-3 whitespace-pre-line", TYPE.body)}>{post.content || t("content.mediaOnly")}</p>

      <div className="grid grid-cols-3 gap-3">
        <Metric label={fmt.metricName(objectiveMetric)} value={fmt.metric(post.objectiveValue)} emphasis />
        <Metric label={t("metrics.views")} value={fmt.metric(post.views)} />
        <Metric label={t("metrics.engagements")} value={fmt.metric(post.engagements)} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {post.engagementRate !== null && (
          <KindBadge tone="emerald">{t("content.engagementRate", { value: (post.engagementRate * 100).toFixed(1) })}</KindBadge>
        )}
        {patterns ? (
          <>
            {patterns.pillar && <KindBadge tone="slate">{t("content.patterns.pillar")}: {patterns.pillar}</KindBadge>}
            {patterns.hook && <KindBadge tone="slate">{t("content.patterns.hook")}: {patterns.hook.slice(0, 48)}</KindBadge>}
            {patterns.kind && <KindBadge tone="slate">{t("content.patterns.format")}: {patterns.kind}</KindBadge>}
          </>
        ) : (
          <span className={TYPE.hint}>{t("content.patterns.pending")}</span>
        )}
      </div>

      {preview && canPreview && (
        <PlatformPreview
          compact
          content={post.content || t("content.mediaOnly")}
          channel={post.platform}
          mediaUrls={media}
          username={post.username}
          metrics={{
            views: post.views,
            likes: post.likes ?? null,
            comments: post.comments ?? null,
            shares: post.shares ?? null,
            saves: post.saves ?? null,
          }}
        />
      )}

      <div className="mt-auto space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800/80">
        <WhyItWorked productId={productId} post={post} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <DraftButton productId={productId} source={{ type: "post", id: post.id }} platform={post.platform} label={t("content.remix")} variant="outline" />
          {canPreview && (
            <button
              type="button"
              onClick={() => setPreview((value) => !value)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", preview && "rotate-180")} aria-hidden="true" />
              {preview ? t("content.hidePreview") : t("content.showPreview")}
            </button>
          )}
          {post.externalUrl && (
            <a
              href={post.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {t("content.viewLive")}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function ContentTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const source = data.measuredPosts?.length ? data.measuredPosts : data.topContent;
  // Rank by the objective when at least one post reports it; otherwise views.
  const [sort, setSort] = useState<SortKey>(() => (source.some((post) => post.objectiveValue !== null) ? "objective" : "views"));
  const [platform, setPlatform] = useState("");
  const objectiveMetric = data.objective?.metric || "views";
  const timingMetric = fmt.metricName(data.timing?.metric || objectiveMetric);
  const platforms = useMemo(() => [...new Set(source.map((post) => post.platform))], [source]);
  const rows = useMemo(() => {
    const filtered = platform ? source.filter((post) => post.platform === platform) : source;
    return [...filtered].sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  }, [source, platform, sort]);
  const measuredRows = rows.filter((post) => sortValue(post, sort) !== Number.NEGATIVE_INFINITY);
  const top = measuredRows.slice(0, 12);
  const lowest = measuredRows.length >= 8 ? measuredRows.slice(-4).reverse() : [];

  return (
    <div className="space-y-4 sm:space-y-5">
      {source.length === 0 ? (
        <EmptyState title={t("empty.contentTitle")} body={t("empty.contentBody")} next={t("empty.contentNext")} />
      ) : (
        <Section
          trust="measured"
          title={t("content.title")}
          subtitle={t("content.subtitle")}
          help="content"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className={TYPE.meta}>{t("content.sortBy")}</label>
              <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="h-8 text-xs">
                <option value="objective">{t("content.sortObjective", { metric: fmt.metricName(objectiveMetric) })}</option>
                <option value="views">{t("content.sortViews")}</option>
                <option value="engagements">{t("content.sortEngagements")}</option>
              </Select>
              <Select value={platform} onChange={(event) => setPlatform(event.target.value)} className="h-8 text-xs">
                <option value="">{t("content.allPlatforms")}</option>
                {platforms.map((item) => (
                  <option key={item} value={item}>{channelLabel(item)}</option>
                ))}
              </Select>
            </div>
          }
        >
          {top.length === 0 ? (
            <p className={TYPE.hint}>{t("empty.contentBody")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {top.map((post, index) => (
                <PostCard key={post.id} post={post} productId={productId} objectiveMetric={objectiveMetric} rank={index + 1} />
              ))}
            </div>
          )}
        </Section>
      )}

      {lowest.length > 0 && (
        <Section trust="measured" title={t("content.lowestTitle")} subtitle={t("content.lowestBody")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {lowest.map((post) => (
              <PostCard key={post.id} post={post} productId={productId} objectiveMetric={objectiveMetric} />
            ))}
          </div>
        </Section>
      )}

      {data.phases?.learning && (
        <Section trust="calculated" title={t("timing.title")} subtitle={t("timing.subtitle", { metric: timingMetric })}>
          {!data.timing?.windows.length ? (
            <p className={TYPE.hint}>
              {data.timing?.limitations[0] === "no_window_with_five"
                ? t("timing.no_window_with_five")
                : t("timing.needs_dated_posts", {
                  metric: timingMetric,
                  dated: data.timing?.datedPosts ?? data.readiness?.datedPosts ?? 0,
                })}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {data.timing.windows.map((window, index) => (
                  <div key={window.bucket} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn("w-4 text-xs tabular-nums", index === 0 ? "font-bold text-emerald-600" : "text-slate-400")}>{index + 1}</span>
                      <span className={TYPE.strong}>{fmt.window(window.weekday, window.hour)}</span>
                      <span className={TYPE.hint}>{t("timing.observations", { count: window.observations })}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={TYPE.hint}>
                        {t("timing.estimate", { value: fmt.metric(window.estimate === null ? null : Math.round(window.estimate)), metric: timingMetric })}
                      </span>
                      {window.liftPercent !== null && (
                        <span className={cn("text-sm", TYPE.figure, window.liftPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                          {window.liftPercent >= 0
                            ? t("timing.liftUp", { value: Math.round(window.liftPercent) })
                            : t("timing.liftDown", { value: Math.round(window.liftPercent) })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className={cn("px-3 py-2", INSET, TYPE.hint)}>
                {t("timing.timezone", { timeZone: data.timing.timeZone })}
                {data.timing.accountMean !== null && (
                  <> · {t("timing.accountMean", { value: fmt.metric(Math.round(data.timing.accountMean)), metric: fmt.metricName(data.timing.metric) })}</>
                )}
              </p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
