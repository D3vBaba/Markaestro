"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Compass, Lightbulb, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiPost, apiPut } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import { KpiCard } from "@/components/analytics/KpiCard";
import { channelColor, channelLabel } from "@/components/mk/channels";
import AudienceProfileEditor from "@/components/intelligence/AudienceProfileEditor";
import ExperimentBoard, { type ExperimentItem } from "@/components/intelligence/ExperimentBoard";
import PlatformPreview from "@/components/app/PlatformPreview";

export type IntelligenceOverview = {
  products: Array<{ id: string; name: string }>;
  productId: string | null;
  profile: { objective?: string; primaryTimezone?: string; targetMarkets?: Array<{ code: string; label?: string; weight: number }> } | null;
  phases?: { foundation: boolean; learning: boolean; growth: boolean; advanced: boolean; experiments?: boolean; strategist?: boolean };
  totals: null | {
    posts: number;
    views: number | null;
    reach: number | null;
    clicks: number | null;
    conversions: number | null;
    coverage: Record<string, number>;
  };
  channels: Array<{ platform: string; posts: number; views: number | null; engagements: number | null }>;
  topContent: Array<{
    id: string;
    platform: string;
    content: string | null;
    views: number | null;
    engagements: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    username?: string | null;
    mediaUrls?: string[];
    thumbnailUrl?: string | null;
    externalUrl?: string | null;
  }>;
  measuredPosts?: Array<{
    id: string;
    platform: string;
    content: string | null;
    views: number | null;
    engagements: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    username?: string | null;
    mediaUrls?: string[];
    thumbnailUrl?: string | null;
    externalUrl?: string | null;
  }>;
  alignment?: { score: number | null; coverage: number; dimensions: Record<string, number | null> } | null;
  timing?: { accountSpecific: boolean; windows: Array<{ bucket: string; observations: number; estimate: number | null }>; limitations: string[] } | null;
  drift?: { title: string; summary: string } | null;
  learnings: Array<{ id: string; title?: string; summary?: string; status?: string; strength?: string; observations?: number }>;
  opportunities: Array<{ id: string; title?: string; recommendation?: string; status?: string }>;
};

function Section({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl p-5 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{eyebrow}</div>
          {title && (
            <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
              {title}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function TabGuide({ tab }: { tab: "overview" | "audience" | "content" | "opportunities" | "playbook" | "advanced" }) {
  const t = useTranslations("intelligence.guide");
  return (
    <div className="rounded-2xl border border-blue-200/60 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t(`${tab}.title`)}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{t(`${tab}.body`)}</p>
    </div>
  );
}

function WorkflowSteps({ tab }: { tab: "opportunities" | "playbook" }) {
  const t = useTranslations(`intelligence.workflow.${tab}`);
  const steps = [t("step1"), t("step2"), t("step3")];
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3.5 dark:border-slate-800/80 dark:bg-slate-900/40">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t("title")}</p>
      <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        {steps.map((step) => (
          <li key={step} className="flex gap-2">
            <span className="shrink-0 font-semibold text-blue-600 dark:text-blue-400">•</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState({
  title,
  body,
  icon: Icon,
}: {
  title: string;
  body: string;
  icon?: typeof Compass;
}) {
  return (
    <div className="rounded-2xl px-6 py-14 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800">
      {Icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200/50 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 shadow-2xs">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {body}
      </p>
    </div>
  );
}

function DecisionButtons({
  path,
  productId,
  status: initialStatus,
  kind = "opportunity",
}: {
  path: string;
  productId: string;
  status?: string;
  kind?: "opportunity" | "learning";
}) {
  const t = useTranslations("intelligence.actions");
  const d = useTranslations("intelligence.decisions");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus || "proposed");

  useEffect(() => {
    setStatus(initialStatus || "proposed");
  }, [initialStatus]);

  const decided = status === "accepted" || status === "dismissed" || status === "pinned";

  async function decide(decision: "accepted" | "dismissed" | "pinned") {
    setBusy(decision);
    const response = await apiPut(`${path}?productId=${encodeURIComponent(productId)}`, { decision });
    if (!response.ok) {
      toast.error(userFacingError(response.data, t("saveFailed")));
      setBusy(null);
      return;
    }
    setStatus(decision);
    toast.success(
      decision === "accepted"
        ? t("acceptedToast")
        : decision === "pinned"
          ? t("pinnedToast")
          : t("dismissedToast"),
    );
    invalidateQueries("/api/intelligence/overview");
    setBusy(null);
  }

  if (decided) {
    return (
      <div className="mt-4">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            background:
              status === "accepted"
                ? "color-mix(in srgb, var(--mk-pos) 12%, var(--mk-paper))"
                : status === "pinned"
                  ? "color-mix(in srgb, var(--mk-accent) 12%, var(--mk-paper))"
                  : "var(--mk-panel)",
            color:
              status === "accepted"
                ? "var(--mk-pos)"
                : status === "pinned"
                  ? "var(--mk-accent)"
                  : "var(--mk-ink-60)",
            border: "1px solid var(--mk-rule-soft)",
          }}
        >
          {t(`status.${status}`)}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {kind === "learning" ? d("learningHint") : d("hint")}
      </p>
      <div className="flex flex-wrap gap-2.5">
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
        disabled={busy !== null}
        onClick={() => void decide("accepted")}
      >
        {d("accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-xl text-xs font-semibold border-slate-200 dark:border-slate-700"
        disabled={busy !== null}
        onClick={() => void decide("pinned")}
      >
        {d("pin")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl text-xs font-semibold text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        disabled={busy !== null}
        onClick={() => void decide("dismissed")}
      >
        {d("dismiss")}
      </Button>
      </div>
    </div>
  );
}

function ChannelDot({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: channelColor(platform) }}
      />
      <span className="truncate font-semibold text-xs text-slate-800 dark:text-slate-200">
        {channelLabel(platform)}
      </span>
    </span>
  );
}


export default function IntelligenceWorkspace({
  data,
}: {
  data: IntelligenceOverview;
  productId: string;
}) {
  const t = useTranslations("intelligence");
  const number = new Intl.NumberFormat();
  const phases = data.phases || { foundation: true, learning: false, growth: false, advanced: false };

  if (data.totals?.posts === 0) {
    return <EmptyState title={t("empty.overviewTitle")} body={t("empty.overviewBody")} />;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabGuide tab="overview" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={t("metrics.posts")} value={data.totals?.posts ?? 0} />
        <KpiCard
          label={t("metrics.views")}
          value={data.totals?.views ?? null}
          sub={data.totals?.coverage.views !== undefined ? t("coverage", { value: data.totals.coverage.views }) : undefined}
        />
        <KpiCard
          label={t("metrics.reach")}
          value={data.totals?.reach ?? null}
          sub={data.totals?.coverage.reach !== undefined ? t("coverage", { value: data.totals.coverage.reach }) : undefined}
        />
        <KpiCard
          label={t("metrics.clicks")}
          value={data.totals?.clicks ?? null}
          sub={data.totals?.coverage.clicks !== undefined ? t("coverage", { value: data.totals.coverage.clicks }) : undefined}
        />
      </div>

      {phases.learning && data.alignment && (
        <Section eyebrow={t("labels.calculated")} title={t("alignment.title")}>
          {data.alignment.score === null ? (
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("alignment.empty")}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold font-mono text-slate-900 dark:text-slate-100">
                  {data.alignment.score}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {t("coverage", { value: data.alignment.coverage })}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {Object.entries(data.alignment.dimensions).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                    <span className="capitalize text-slate-600 dark:text-slate-400 font-medium">{name}</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {value === null ? "n/a" : value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section eyebrow={t("labels.calculated")} title={t("platforms.title")}>
        {data.channels.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("platforms.empty")}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <div
              className="hidden grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] gap-3 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 sm:grid"
            >
              <span>{t("platforms.colPlatform")}</span>
              <span className="text-end">{t("metrics.posts")}</span>
              <span className="text-end">{t("metrics.views")}</span>
              <span className="text-end">{t("platforms.colEngagements")}</span>
            </div>
            {data.channels.map((channel) => (
              <div
                key={channel.platform}
                className="grid grid-cols-1 gap-1 py-3 text-xs sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] sm:items-center sm:gap-3"
              >
                <ChannelDot platform={channel.platform} />
                <div className="flex justify-between sm:block sm:text-end">
                  <span className="sm:hidden text-xs text-slate-400">{t("metrics.posts")}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">{channel.posts}</span>
                </div>
                <div className="flex justify-between sm:block sm:text-end">
                  <span className="sm:hidden text-xs text-slate-400">{t("metrics.views")}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                    {channel.views === null ? "n/a" : number.format(channel.views)}
                  </span>
                </div>
                <div className="flex justify-between sm:block sm:text-end">
                  <span className="sm:hidden text-xs text-slate-400">{t("platforms.colEngagements")}</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                    {channel.engagements === null ? "n/a" : number.format(channel.engagements)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function IntelligenceAudienceTab({ productId, data }: { productId: string; data: IntelligenceOverview }) {
  const t = useTranslations("intelligence");
  const phases = data.phases || { learning: false, growth: false, advanced: false, foundation: true };
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [creating, setCreating] = useState(false);
  const links = useApiQuery<{ links: Array<{ code: string; label: string; destination: string }> }>(
    phases.learning ? `/api/intelligence/tracked-links?productId=${encodeURIComponent(productId)}` : null,
  );

  return (
    <div className="space-y-6">
      <TabGuide tab="audience" />
      <Section eyebrow={t("labels.measured")} title={t("audience.title")}>
        <AudienceProfileEditor productId={productId} variant="advanced" />
      </Section>

      {phases.growth && data.drift && (
        <Section eyebrow={t("labels.calculated")} title={data.drift.title}>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{data.drift.summary}</p>
        </Section>
      )}

      {phases.learning && (
        <Section eyebrow={t("labels.measured")} title={t("links.title")}>
          {(!links.data?.links.length) && (
            <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("links.empty")}</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("links.label")}
              aria-label={t("links.label")}
              className="rounded-xl"
            />
            <Input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder={t("links.destination")}
              aria-label={t("links.destination")}
              className="rounded-xl"
            />
            <Button
              type="button"
              className="h-9 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
              disabled={!label || !destination || creating}

              onClick={async () => {
                setCreating(true);
                await apiPost("/api/intelligence/tracked-links", { productId, label, destination });
                setLabel("");
                setDestination("");
                invalidateQueries("/api/intelligence/tracked-links");
                setCreating(false);
              }}
            >
              {t("links.create")}
            </Button>
          </div>
          {(links.data?.links.length ?? 0) > 0 && (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/80">
              {links.data?.links.map((link) => (
                <div key={link.code} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{link.label}</span>
                  <span className="font-mono text-xs text-slate-400">/r/{link.code}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}


export function IntelligenceContentTab({ data }: { data: IntelligenceOverview }) {
  const t = useTranslations("intelligence");
  const number = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  function formatMetric(value: number | null | undefined) {
    if (value === null || value === undefined) return "n/a";
    return number.format(value);
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabGuide tab="content" />
      {data.topContent.length === 0 ? (
        <EmptyState title={t("empty.contentTitle")} body={t("empty.contentBody")} />
      ) : (
        <Section eyebrow={t("labels.measured")} title={t("content.title")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.topContent.map((post) => {
              const media = post.mediaUrls?.length
                ? post.mediaUrls
                : post.thumbnailUrl
                  ? [post.thumbnailUrl]
                  : [];
              return (
                <article
                  key={post.id}
                  className="flex min-w-0 flex-col gap-2.5 rounded-2xl border p-3"
                  style={{ borderColor: "var(--mk-rule-soft)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <ChannelDot platform={post.platform} />
                    {post.username ? (
                      <span className="truncate text-[11px] font-medium" style={{ color: "var(--mk-ink-60)" }}>
                        @{post.username}
                      </span>
                    ) : null}
                  </div>

                  {post.content || media.length > 0 ? (
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
                    <p className="text-[13px]" style={{ color: "var(--mk-ink-40)" }}>{t("content.mediaOnly")}</p>
                  )}

                  <div className="mt-auto space-y-1.5 border-t pt-2.5" style={{ borderColor: "var(--mk-rule-soft)" }}>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]" style={{ color: "var(--mk-ink-60)" }}>
                      <span>{t("metrics.views")}: <span className="font-mono font-semibold" style={{ color: "var(--mk-ink)" }}>{formatMetric(post.views)}</span></span>
                      <span>{t("content.likes")}: <span className="font-mono font-semibold" style={{ color: "var(--mk-ink)" }}>{formatMetric(post.likes)}</span></span>
                      <span>{t("content.comments")}: <span className="font-mono font-semibold" style={{ color: "var(--mk-ink)" }}>{formatMetric(post.comments)}</span></span>
                      <span>{t("content.shares")}: <span className="font-mono font-semibold" style={{ color: "var(--mk-ink)" }}>{formatMetric(post.shares)}</span></span>
                    </div>
                    {post.externalUrl ? (
                      <a
                        href={post.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-80"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("content.viewLive")}
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </Section>
      )}

      {data.phases?.learning && (
        <Section eyebrow={t("labels.calculated")} title={t("timing.title")}>
          {!data.timing?.windows.length ? (
            <p className="text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>
              {data.timing?.limitations[0] || t("timing.empty")}
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--mk-rule-soft)" }}>
              {data.timing.windows.map((window) => (
                <div key={window.bucket} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                  <span className="font-medium" style={{ color: "var(--mk-ink)" }}>{window.bucket}</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--mk-ink-40)" }}>
                    {window.observations} · {window.estimate == null ? "n/a" : number.format(Math.round(window.estimate))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

export function IntelligenceOpportunitiesTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const campaigns = useApiQuery<{ campaigns: Array<{ id: string; name: string; status: string; productId: string }> }>(
    data.phases?.growth ? "/api/intelligence/campaigns" : null,
  );

  if (!data.phases?.growth) {
    return (
      <div className="space-y-4 sm:space-y-5">
        <TabGuide tab="opportunities" />
        <EmptyState icon={Compass} title={t("empty.opportunitiesTitle")} body={t("empty.opportunitiesBody")} />
      </div>
    );
  }

  const brandCampaigns = (campaigns.data?.campaigns || []).filter((item) => item.productId === productId);

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabGuide tab="opportunities" />
      <WorkflowSteps tab="opportunities" />
      {data.opportunities.length === 0 ? (
        <EmptyState icon={Compass} title={t("empty.opportunitiesTitle")} body={t("empty.opportunitiesBody")} />
      ) : (
        data.opportunities.map((item) => (
          <Section key={item.id} eyebrow={t("labels.recommended")} title={item.title}>
            <p className="text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>{item.recommendation}</p>
            <DecisionButtons
              path={`/api/intelligence/recommendations/${item.id}/decision`}
              productId={productId}
              status={item.status}
              kind="opportunity"
            />
          </Section>
        ))
      )}

      <Section eyebrow={t("labels.calculated")} title={t("campaigns.title")}>
        {brandCampaigns.length === 0 && (
          <p className="mb-4 text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>{t("campaigns.empty")}</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("campaigns.name")}
            aria-label={t("campaigns.name")}
            className="flex-1"
          />
          <Button
            type="button"
            className="h-9 rounded-lg text-[13px]"
            disabled={!name || creating}
            onClick={async () => {
              setCreating(true);
              await apiPost("/api/intelligence/campaigns", {
                productId,
                name,
                objective: data.profile?.objective || "awareness",
                platforms: ["instagram"],
              });
              setName("");
              invalidateQueries("/api/intelligence/campaigns");
              setCreating(false);
            }}
          >
            {t("campaigns.create")}
          </Button>
        </div>
        {brandCampaigns.length > 0 && (
          <div className="mt-4 divide-y" style={{ borderColor: "var(--mk-rule-soft)" }}>
            {brandCampaigns.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="font-medium" style={{ color: "var(--mk-ink)" }}>{item.name}</span>
                <span className="font-mono text-[11px] uppercase" style={{ color: "var(--mk-ink-40)", letterSpacing: "0.08em" }}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function IntelligencePlaybookTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");

  if (!data.phases?.learning || data.learnings.length === 0) {
    return (
      <div className="space-y-4 sm:space-y-5">
        <TabGuide tab="playbook" />
        <EmptyState icon={Lightbulb} title={t("empty.playbookTitle")} body={t("empty.playbookBody")} />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabGuide tab="playbook" />
      <WorkflowSteps tab="playbook" />
      {data.learnings.map((item) => (
        <Section
          key={item.id}
          eyebrow={item.strength ? item.strength.replaceAll("_", " ") : t("labels.calculated")}
          title={item.title}
        >
          <p className="text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>{item.summary}</p>
          {item.observations !== undefined && (
            <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}>
              n={item.observations}
            </p>
          )}
          <DecisionButtons
            path={`/api/intelligence/learnings/${item.id}/decision`}
            productId={productId}
            status={item.status}
            kind="learning"
          />
        </Section>
      ))}
    </div>
  );
}

export function IntelligenceAdvancedTab({ data, productId }: { data: IntelligenceOverview; productId: string }) {
  const t = useTranslations("intelligence");
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<{ answer: string; tool: string; limitations: string[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const experimentsQuery = useApiQuery<{ experiments: ExperimentItem[] }>(
    data.phases?.experiments ? "/api/intelligence/experiments" : null,
  );

  if (!data.phases?.advanced) return null;

  const brandExperiments = (experimentsQuery.data?.experiments || []).filter((item) => item.productId === productId);

  return (
    <div className="space-y-4 sm:space-y-5">
      <TabGuide tab="advanced" />
      {data.phases.experiments && (
        <Section eyebrow={t("labels.calculated")} title={t("experiments.title")}>
          <ExperimentBoard productId={productId} experiments={brandExperiments} />
        </Section>
      )}

      {data.phases.strategist !== false && (
        <Section eyebrow={t("labels.recommended")} title={t("ask.title")}>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("ask.placeholder")}
            rows={3}
            aria-label={t("ask.title")}
          />
          <Button
            className="mt-3 h-9 rounded-lg text-[13px]"
            type="button"
            disabled={!question.trim() || asking}
            onClick={async () => {
              setAsking(true);
              setAskResult(null);
              try {
                const response = await apiPost<{ answer: string; tool: string; limitations: string[] }>(
                  "/api/intelligence/strategist",
                  { productId, question },
                  undefined,
                  { timeoutMs: 90_000 },
                );
                if (!response.ok) {
                  toast.error(userFacingError(response.data, t("ask.failed"), {
                    REQUEST_TIMEOUT: t("ask.timeout"),
                    QUOTA_EXCEEDED: t("ask.quota"),
                    FEATURE_NOT_AVAILABLE: t("ask.unavailable"),
                  }));
                  return;
                }
                setAskResult(response.data);
              } catch {
                toast.error(t("ask.failed"));
              } finally {
                setAsking(false);
              }
            }}
          >
            {asking ? t("ask.asking") : t("ask.submit")}
          </Button>
          {askResult && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--mk-rule-soft)" }}>
              <p className="mk-eyebrow">{t("ask.tool", { tool: askResult.tool })}</p>
              <p className="mt-2 text-[13px] leading-5 whitespace-pre-wrap" style={{ color: "var(--mk-ink)" }}>
                {askResult.answer}
              </p>
              {askResult.limitations.map((item) => (
                <p key={item} className="mt-1.5 text-[12px] leading-4" style={{ color: "var(--mk-ink-40)" }}>{item}</p>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

export { EmptyState, Section, Skeleton };
