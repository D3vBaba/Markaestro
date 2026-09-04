"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ExternalLink, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import PlatformPreview from "@/components/app/PlatformPreview";
import Select from "@/components/app/Select";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/app/Pagination";
import { PostThumbnail } from "@/components/mk/PostThumbnail";
import { apiPost } from "@/lib/api-client";
import { userFacingError } from "@/lib/user-facing-errors";
import { channelLabel } from "@/components/mk/channels";
import { cn } from "@/lib/utils";
import { DraftButton, EmptyState, INSET, KindBadge, Section, TYPE, TrustBadge } from "./shared";
import { useIntelligenceFormat } from "./format";
import { CohortsSection, PillarCoverageSection } from "./Cohorts";
import type { IntelligenceOverview, PostExplanation, PostRow } from "./types";

type SortKey = "objective" | "views" | "engagements";
const PAGE_SIZE = 6;
const METRIC_LABEL_KEYS = ["posts", "views", "reach", "engagements", "clicks", "conversions"] as const;

/** "Engagements" rather than "engagements (likes, comments, shares, saves)" where space is tight. */
function shortMetricLabel(t: (key: string) => string, longName: string, metric: string): string {
  return (METRIC_LABEL_KEYS as readonly string[]).includes(metric) ? t(`metrics.${metric}`) : longName.split(" (")[0];
}

function sortValue(post: PostRow, key: SortKey): number {
  const value = key === "objective" ? post.objectiveValue ?? post.views : key === "views" ? post.views : post.engagements;
  return value ?? Number.NEGATIVE_INFINITY;
}

function useExplanation(productId: string, post: PostRow) {
  const t = useTranslations("intelligence.content.why");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<PostExplanation | null>(null);

  async function load(): Promise<boolean> {
    if (explanation) return true;
    setLoading(true);
    try {
      const response = await apiPost<{ explanation: PostExplanation }>(
        `/api/intelligence/posts/${encodeURIComponent(post.id)}/explain`,
        { productId, locale },
        undefined,
        { timeoutMs: 60_000 },
      );
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("failed"), { VALIDATION_POST_NOT_MEASURED: t("notMeasured") }));
        return false;
      }
      setExplanation(response.data.explanation);
      return true;
    } catch {
      toast.error(t("failed"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { loading, explanation, load };
}

function Explanation({ explanation }: { explanation: PostExplanation }) {
  const t = useTranslations("intelligence.content.why");
  return (
    <div className={cn("p-4", INSET)}>
      <div className="mb-2"><TrustBadge kind="generated" /></div>
      <p className={cn("m-0", TYPE.body)}>{explanation.summary}</p>
      {explanation.factors.length > 0 && (
        <dl className="m-0 mt-3 grid gap-2 sm:grid-cols-2">
          {explanation.factors.map((factor) => (
            <div key={factor.label} className="rounded-lg bg-card px-3 py-2">
              <dt className="text-xs font-semibold text-foreground">{factor.label}</dt>
              <dd className={cn("m-0 mt-0.5", TYPE.hint)}>{factor.detail}</dd>
            </div>
          ))}
        </dl>
      )}
      {explanation.tryNext && (
        <p className={cn("m-0 mt-3", TYPE.body)}>
          <span className="font-semibold text-foreground">{t("tryNext")}: </span>{explanation.tryNext}
        </p>
      )}
    </div>
  );
}

/**
 * One ranked post. Reads as a row: rank, channel, caption, then the three
 * figures in fixed columns so the eye can scan down the list. Everything
 * secondary (why it worked, preview, actions) lives under a disclosure.
 */
function PostRowItem({
  post,
  productId,
  objectiveMetric,
  rank,
}: {
  post: PostRow;
  productId: string;
  objectiveMetric: string;
  rank?: number;
}) {
  const t = useTranslations("intelligence");
  const tWhy = useTranslations("intelligence.content.why");
  const fmt = useIntelligenceFormat();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const { loading, explanation, load } = useExplanation(productId, post);
  const media = post.mediaUrls?.length ? post.mediaUrls : post.thumbnailUrl ? [post.thumbnailUrl] : [];
  const date = fmt.date(post.publishedAt);
  const patterns = post.fingerprint;
  const canPreview = Boolean(post.content || media.length > 0);
  const measured = post.views !== null || post.engagements !== null;
  const objectiveLabel = shortMetricLabel(t, fmt.metricName(objectiveMetric), objectiveMetric);
  // The objective column only earns its place when it is not already views or engagements.
  const metricCells: Array<[string, string, boolean]> = [
    ...(objectiveMetric === "views" || objectiveMetric === "engagements"
      ? []
      : [[objectiveLabel, fmt.metric(post.objectiveValue), true] as [string, string, boolean]]),
    [t("metrics.views"), fmt.metric(post.views), objectiveMetric === "views"],
    [t("metrics.engagements"), fmt.metric(post.engagements), objectiveMetric === "engagements"],
  ];

  return (
    <li className="px-5 py-5 sm:px-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="flex min-w-0 gap-3">
          {typeof rank === "number" ? (
            <span className={cn("mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums", rank <= 3 ? "font-semibold text-foreground" : "text-mk-ink-40")}>
              {rank}
            </span>
          ) : null}
          <PostThumbnail src={post.thumbnailUrl} mediaUrl={media[0] ?? null} channel={post.platform} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{channelLabel(post.platform)}</span>
              {post.username ? <span>@{post.username}</span> : null}
              {date ? <span>{t("content.published", { date })}</span> : null}
            </div>
            <p className={cn("m-0 mt-1 line-clamp-2 whitespace-pre-line", TYPE.body)}>{post.content || t("content.mediaOnly")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {post.engagementRate !== null && (
                <KindBadge tone="emerald">{t("content.engagementRate", { value: (post.engagementRate * 100).toFixed(1) })}</KindBadge>
              )}
              {patterns?.pillar && <KindBadge tone="slate">{patterns.pillar}</KindBadge>}
              {patterns?.kind && <KindBadge tone="slate">{patterns.kind}</KindBadge>}
            </div>
          </div>
        </div>

        <dl className={cn("m-0 grid gap-4 md:shrink-0", metricCells.length === 3 ? "grid-cols-3 md:w-[300px]" : "grid-cols-2 md:w-[220px]")}>
          {metricCells.map(([label, value, emphasis]) => (
            <div key={String(label)} className="min-w-0">
              <dt className="mk-label truncate" title={String(label)}>{label}</dt>
              <dd className={cn("m-0 mt-0.5", TYPE.figure, emphasis ? "text-lg" : "text-sm text-mk-ink-80")}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <DraftButton productId={productId} source={{ type: "post", id: post.id }} platform={post.platform} label={t("content.remix")} variant="outline" />
        {measured && (
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={async () => {
              if (open && explanation) { setOpen(false); return; }
              if (await load()) setOpen(true);
            }}
          >
            <Lightbulb className="size-3.5" />
            {loading ? tWhy("loading") : tWhy("button")}
          </Button>
        )}
        {canPreview && (
          <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)}>
            <ChevronDown className={cn("size-3.5 transition-transform", preview && "rotate-180")} />
            {preview ? t("content.hidePreview") : t("content.showPreview")}
          </Button>
        )}
        {post.externalUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a href={post.externalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              {t("content.viewLive")}
            </a>
          </Button>
        )}
      </div>

      {open && explanation ? <div className="mt-3"><Explanation explanation={explanation} /></div> : null}

      {preview && canPreview && (
        <div className="mt-3 max-w-md">
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
        </div>
      )}
    </li>
  );
}

function PostList({
  posts,
  productId,
  objectiveMetric,
  ranked = false,
  offset = 0,
}: {
  posts: PostRow[];
  productId: string;
  objectiveMetric: string;
  ranked?: boolean;
  offset?: number;
}) {
  return (
    <ul className="m-0 -mx-5 list-none divide-y divide-border border-y border-border p-0 sm:-mx-6">
      {posts.map((post, index) => (
        <PostRowItem
          key={post.id}
          post={post}
          productId={productId}
          objectiveMetric={objectiveMetric}
          rank={ranked ? offset + index + 1 : undefined}
        />
      ))}
    </ul>
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
  const ranked = measuredRows.slice(0, 24);
  const [page, setPage] = useState(1);
  const [pagedFor, setPagedFor] = useState(`${sort}|${platform}`);
  if (pagedFor !== `${sort}|${platform}`) { setPagedFor(`${sort}|${platform}`); setPage(1); }
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const top = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const lowest = measuredRows.length >= 8 ? measuredRows.slice(-4).reverse() : [];
  const patternsPending = source.length > 0 && source.every((post) => !post.fingerprint);

  return (
    <div className="space-y-6">
      {source.length === 0 ? (
        <EmptyState title={t("empty.contentTitle")} body={t("empty.contentBody")} next={t("empty.contentNext")} />
      ) : (
        <Section
          trust="measured"
          title={t("content.title")}
          subtitle={patternsPending ? t("content.patterns.pending") : t("content.subtitle")}
          help="content"
          action={
            <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
              <Select size="sm" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="w-auto max-sm:min-w-0 max-sm:flex-1" aria-label={t("content.sortBy")}>
                <option value="objective">{t("content.sortObjective", { metric: shortMetricLabel(t, fmt.metricName(objectiveMetric), objectiveMetric) })}</option>
                <option value="views">{t("content.sortViews")}</option>
                <option value="engagements">{t("content.sortEngagements")}</option>
              </Select>
              <Select size="sm" value={platform} onChange={(event) => setPlatform(event.target.value)} className="w-auto max-sm:min-w-0 max-sm:flex-1">
                <option value="">{t("content.allPlatforms")}</option>
                {platforms.map((item) => (
                  <option key={item} value={item}>{channelLabel(item)}</option>
                ))}
              </Select>
            </div>
          }
        >
          {top.length === 0 ? (
            <p className={cn("m-0", TYPE.hint)}>{t("empty.contentBody")}</p>
          ) : (
            <>
              <PostList posts={top} productId={productId} objectiveMetric={objectiveMetric} ranked offset={(page - 1) * PAGE_SIZE} />
              {totalPages > 1 && <div className="pt-2"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div>}
            </>
          )}
        </Section>
      )}

      {lowest.length > 0 && (
        <Section trust="measured" title={t("content.lowestTitle")} subtitle={t("content.lowestBody")}>
          <PostList posts={lowest} productId={productId} objectiveMetric={objectiveMetric} />
        </Section>
      )}

      {data.phases?.learning && data.cohorts && source.length > 0 && (
        <CohortsSection cohorts={data.cohorts} measuredCount={source.filter((post) => post.views !== null || post.engagements !== null).length} />
      )}

      {data.phases?.learning && source.length > 0 && (data.pillars?.length || data.profile?.contentPillars?.length) ? (
        <PillarCoverageSection pillars={data.pillars ?? []} />
      ) : null}

      {data.phases?.learning && (
        <Section trust="calculated" title={t("timing.title")} subtitle={t("timing.subtitle", { metric: timingMetric })}>
          {!data.timing?.windows.length ? (
            <p className={cn("m-0", TYPE.hint)}>
              {data.timing?.limitations[0] === "no_window_with_five"
                ? t("timing.no_window_with_five")
                : t("timing.needs_dated_posts", {
                  metric: timingMetric,
                  dated: data.timing?.datedPosts ?? data.readiness?.datedPosts ?? 0,
                })}
            </p>
          ) : (
            <>
              <ol className="m-0 -mx-5 list-none divide-y divide-border border-t border-border p-0 sm:-mx-6">
                {data.timing.windows.map((window, index) => (
                  <li key={window.bucket} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-6">
                    <span className={cn("text-xs tabular-nums", index === 0 ? "font-semibold text-foreground" : "text-mk-ink-40")}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className={cn("m-0", TYPE.strong)}>{fmt.window(window.weekday, window.hour)}</p>
                      <p className={cn("m-0 mt-0.5", TYPE.hint)}>
                        {t("timing.observations", { count: window.observations })}
                        {" · "}
                        {t("timing.estimate", { value: fmt.metric(window.estimate === null ? null : Math.round(window.estimate)), metric: timingMetric })}
                      </p>
                    </div>
                    {window.liftPercent !== null && (
                      <span className={cn("text-sm", TYPE.figure, window.liftPercent >= 0 ? "text-mk-pos" : "text-mk-neg")}>
                        {window.liftPercent >= 0
                          ? t("timing.liftUp", { value: Math.round(window.liftPercent) })
                          : t("timing.liftDown", { value: Math.round(window.liftPercent) })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              <p className={cn("m-0 mt-4", TYPE.hint)}>
                {t("timing.timezone", { timeZone: data.timing.timeZone })}
                {data.timing.accountMean !== null && (
                  <> · {t("timing.accountMean", { value: fmt.metric(Math.round(data.timing.accountMean)), metric: fmt.metricName(data.timing.metric) })}</>
                )}
              </p>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
