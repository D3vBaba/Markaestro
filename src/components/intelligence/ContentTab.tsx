"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import PlatformPreview from "@/components/app/PlatformPreview";
import Select from "@/components/app/Select";
import { apiPost } from "@/lib/api-client";
import { userFacingError } from "@/lib/user-facing-errors";
import { channelLabel } from "@/components/mk/channels";
import { cn } from "@/lib/utils";
import { ChannelDot, DraftButton, EmptyState, KindBadge, Section, TabHeader, TrustBadge } from "./shared";
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
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 hover:underline disabled:opacity-60 dark:text-violet-300"
      >
        <Lightbulb className="h-3 w-3" aria-hidden="true" />
        {loading ? t("loading") : t("button")}
      </button>
      {open && explanation && (
        <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 p-3 text-[12px] leading-relaxed dark:border-violet-900/60 dark:bg-violet-950/30">
          <div className="mb-1.5"><TrustBadge kind="generated" /></div>
          <p className="text-slate-800 dark:text-slate-200">{explanation.summary}</p>
          {explanation.factors.length > 0 && (
            <div className="mt-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t("factors")}</p>
              <ul className="mt-1 space-y-1">
                {explanation.factors.map((factor) => (
                  <li key={factor.label} className="text-slate-700 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{factor.label}:</span> {factor.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {explanation.tryNext && (
            <p className="mt-2 text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{t("tryNext")}:</span> {explanation.tryNext}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, productId, objectiveMetric, compact }: { post: PostRow; productId: string; objectiveMetric: string; compact?: boolean }) {
  const t = useTranslations("intelligence");
  const fmt = useIntelligenceFormat();
  const media = post.mediaUrls?.length ? post.mediaUrls : post.thumbnailUrl ? [post.thumbnailUrl] : [];
  const date = fmt.date(post.publishedAt);
  const patterns = post.fingerprint;
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-slate-200/80 p-3 dark:border-slate-800/80">
      <div className="flex items-center justify-between gap-2">
        <ChannelDot platform={post.platform} />
        <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">
          {date ? t("content.published", { date }) : post.username ? `@${post.username}` : ""}
        </span>
      </div>

      {!compact && (post.content || media.length > 0) ? (
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
      ) : (
        <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-600 dark:text-slate-400">
          {post.content || t("content.mediaOnly")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          <span className="capitalize">{fmt.metricName(objectiveMetric)}</span>:{" "}
          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{fmt.metric(post.objectiveValue)}</span>
        </span>
        <span>{t("metrics.views")}: <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{fmt.metric(post.views)}</span></span>
        <span>{t("metrics.engagements")}: <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{fmt.metric(post.engagements)}</span></span>
        {post.engagementRate !== null && (
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">{t("content.engagementRate", { value: (post.engagementRate * 100).toFixed(1) })}</span>
        )}
      </div>

      {patterns ? (
        <div className="flex flex-wrap gap-1.5">
          {patterns.pillar && <KindBadge tone="slate">{t("content.patterns.pillar")}: {patterns.pillar}</KindBadge>}
          {patterns.hook && <KindBadge tone="slate">{t("content.patterns.hook")}: {patterns.hook.slice(0, 48)}</KindBadge>}
          {patterns.kind && <KindBadge tone="slate">{t("content.patterns.format")}: {patterns.kind}</KindBadge>}
        </div>
      ) : (
        <p className="text-[10.5px] text-slate-400 dark:text-slate-500">{t("content.patterns.pending")}</p>
      )}

      <div className="mt-auto space-y-2 border-t border-slate-100 pt-2.5 dark:border-slate-800/80">
        <WhyItWorked productId={productId} post={post} />
        <div className="flex flex-wrap items-center gap-2">
          <DraftButton productId={productId} source={{ type: "post", id: post.id }} platform={post.platform} label={t("content.remix")} variant="outline" />
          {post.externalUrl && (
            <a
              href={post.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
      <TabHeader topic="content" title={t("howItWorks.content.title")} body={t("howItWorks.content.intro")} />

      {source.length === 0 ? (
        <EmptyState title={t("empty.contentTitle")} body={t("empty.contentBody")} />
      ) : (
        <Section
          trust="measured"
          title={t("content.title")}
          help="explain"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t("content.sortBy")}</label>
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
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("empty.contentBody")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {top.map((post) => (
                <PostCard key={post.id} post={post} productId={productId} objectiveMetric={objectiveMetric} />
              ))}
            </div>
          )}
        </Section>
      )}

      {lowest.length > 0 && (
        <Section trust="measured" title={t("content.lowestTitle")} subtitle={t("content.lowestBody")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {lowest.map((post) => (
              <PostCard key={post.id} post={post} productId={productId} objectiveMetric={objectiveMetric} compact />
            ))}
          </div>
        </Section>
      )}

      {data.phases?.learning && (
        <Section
          trust="calculated"
          title={t("timing.title")}
          subtitle={t("timing.subtitle", { metric: fmt.metricName(data.timing?.metric || objectiveMetric) })}
        >
          {!data.timing?.windows.length ? (
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {data.timing?.limitations[0] === "no_window_with_five"
                ? t("timing.no_window_with_five")
                : t("timing.needs_dated_posts", {
                  metric: fmt.metricName(data.timing?.metric || objectiveMetric),
                  dated: data.timing?.datedPosts ?? data.readiness?.datedPosts ?? 0,
                })}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {data.timing.windows.map((window, index) => (
                  <div key={window.bucket} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-mono text-[11px]", index === 0 ? "text-emerald-600" : "text-slate-400")}>{index + 1}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{fmt.window(window.weekday, window.hour)}</span>
                      <span className="text-slate-400">{t("timing.observations", { count: window.observations })}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 dark:text-slate-400">
                        {t("timing.estimate", { value: fmt.metric(window.estimate === null ? null : Math.round(window.estimate)), metric: fmt.metricName(data.timing?.metric) })}
                      </span>
                      {window.liftPercent !== null && (
                        <span className={cn("font-mono font-bold tabular-nums", window.liftPercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                          {window.liftPercent >= 0
                            ? t("timing.liftUp", { value: Math.round(window.liftPercent) })
                            : t("timing.liftDown", { value: Math.round(window.liftPercent) })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
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
