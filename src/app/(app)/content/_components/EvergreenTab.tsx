"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, ChevronDown, ChevronUp, Pause, Play, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

type PublishedPost = {
  id: string;
  content: string;
  channel: string;
  publishedAt?: string | null;
};

type Evidence = {
  metric: "engagements" | "views";
  value: number;
  explanation: string;
};

type Queue = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  intervalDays: number;
  nextRunAt: string | null;
  reviewPolicy: "approve_future_runs" | "review_each_run";
  activationEvidence: Evidence | null;
  runCount: number;
  pauseReason: string | null;
};

type Preview = {
  eligibility: {
    eligible: boolean;
    reasons: string[];
    evidence: Evidence | null;
  };
  recommendation: {
    intervalDays: number;
    timeZone: string;
    localHour: number;
    localMinute: number;
    scheduleMode: "fixed" | "learned";
    explanation: string;
  };
};

type Analytics = {
  lifetime: {
    views: number | null;
    reach: number | null;
    engagements: number | null;
    platformClicks: number | null;
    trackedLinkClicks: number;
    attributedConversions: number;
    measuredOccurrences: number;
  };
  runs: {
    total: number;
    published: number;
    evaluated: number;
    underperforming: number;
    failed: number;
    skipped: number;
    needsReview: number;
  };
  recentRuns: Array<{
    runId: string;
    occurrencePostId: string | null;
    plannedAt: string;
    status: string;
    performanceIndex: number | null;
    reason: string | null;
  }>;
};

function messageFrom(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const value = data as { userMessage?: unknown; message?: unknown };
    if (typeof value.userMessage === "string") return value.userMessage;
    if (typeof value.message === "string") return value.message;
  }
  return fallback;
}

export default function EvergreenTab({ productId }: { productId?: string }) {
  const t = useTranslations("content.evergreenTab");
  const [queues, setQueues] = useState<Queue[]>([]);
  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sourcePostId, setSourcePostId] = useState("");
  const [name, setName] = useState("");
  const [captions, setCaptions] = useState([""]);
  const [intervalDays, setIntervalDays] = useState(30);
  const [reviewPolicy, setReviewPolicy] = useState<"approve_future_runs" | "review_each_run">("approve_future_runs");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [analyticsByQueue, setAnalyticsByQueue] = useState<Record<string, Analytics>>({});
  const [analyticsLoadingId, setAnalyticsLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setQueues([]);
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [queueResult, postResult] = await Promise.all([
      apiGet<{ queues: Queue[] }>(`/api/evergreen-queues?productId=${encodeURIComponent(productId)}`),
      apiGet<{ posts: PublishedPost[] }>(`/api/posts?status=published&limit=100&productId=${encodeURIComponent(productId)}`),
    ]);
    if (queueResult.ok) setQueues(queueResult.data.queues.filter((queue) => queue.status !== "archived"));
    if (postResult.ok) setPosts(postResult.data.posts || []);
    if (!queueResult.ok || !postResult.ok) toast.error(t("loadFailed"));
    setLoading(false);
  }, [productId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === sourcePostId) ?? null,
    [posts, sourcePostId],
  );

  const chooseSource = async (postId: string) => {
    setSourcePostId(postId);
    setPreview(null);
    const post = posts.find((candidate) => candidate.id === postId);
    if (post) {
      setCaptions([post.content]);
      if (!name) setName(t("defaultName", { channel: post.channel }));
    }
    if (!postId) return;
    const result = await apiPost<Preview>("/api/evergreen-queues/preview", { sourcePostId: postId });
    if (!result.ok) {
      toast.error(messageFrom(result.data, t("previewFailed")));
      return;
    }
    setPreview(result.data);
    setIntervalDays(result.data.recommendation.intervalDays);
  };

  const createQueue = async () => {
    const variants = captions.map((value) => value.trim()).filter(Boolean);
    if (!productId || !sourcePostId || !name.trim() || variants.length === 0) return;
    setSaving(true);
    const recommendation = preview?.recommendation;
    const timeZone = recommendation?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const result = await apiPost<{ queue: Queue }>("/api/evergreen-queues", {
      productId,
      sourcePostId,
      name: name.trim(),
      intervalDays,
      timeZone,
      localHour: recommendation?.localHour ?? 10,
      localMinute: recommendation?.localMinute ?? 0,
      scheduleMode: recommendation?.scheduleMode ?? "fixed",
      reviewPolicy,
      variants: variants.map((variantCaption) => ({ caption: variantCaption, enabled: true })),
    });
    if (!result.ok) {
      toast.error(messageFrom(result.data, t("createFailed")));
      setSaving(false);
      return;
    }
    toast.success(t("created"));
    setShowCreate(false);
    setSourcePostId("");
    setName("");
    setCaptions([""]);
    setPreview(null);
    setSaving(false);
    await load();
  };

  const transition = async (queue: Queue, action: "activate" | "pause" | "resume" | "archive") => {
    setWorkingId(queue.id);
    const result = action === "archive"
      ? await apiDelete(`/api/evergreen-queues/${queue.id}`)
      : await apiPost(`/api/evergreen-queues/${queue.id}/${action}`, {});
    if (!result.ok) toast.error(messageFrom(result.data, t("actionFailed")));
    else toast.success(t(`actions.${action}Success`));
    setWorkingId(null);
    await load();
  };

  const toggleDetails = async (queueId: string) => {
    if (expandedId === queueId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(queueId);
    if (analyticsByQueue[queueId]) return;
    setAnalyticsLoadingId(queueId);
    const result = await apiGet<{ analytics: Analytics }>(`/api/evergreen-queues/${queueId}/analytics`);
    if (result.ok) setAnalyticsByQueue((current) => ({ ...current, [queueId]: result.data.analytics }));
    else toast.error(messageFrom(result.data, t("analytics.loadFailed")));
    setAnalyticsLoadingId(null);
  };

  const metric = (value: number | null) => value == null ? t("analytics.unavailable") : value.toLocaleString();

  if (!productId) return <p className="py-16 text-center text-sm text-muted-foreground">{t("selectBrand")}</p>;
  if (loading) return <p className="py-16 text-center text-sm text-muted-foreground">{t("loading")}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" />{t("title")}</div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)}><Plus className="mr-2 h-4 w-4" />{t("newQueue")}</Button>
      </div>

      {showCreate && (
        <div className="grid gap-4 rounded-2xl border bg-card p-5 lg:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">
            {t("sourcePost")}
            <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={sourcePostId} onChange={(event) => void chooseSource(event.target.value)}>
              <option value="">{t("choosePost")}</option>
              {posts.map((post) => <option key={post.id} value={post.id}>{post.content.slice(0, 90) || post.channel}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            {t("queueName")}
            <input className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>
          <div className="space-y-2 lg:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("variants")}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setCaptions((current) => [...current, ""])}>
                <Plus className="mr-2 h-3.5 w-3.5" />{t("addVariant")}
              </Button>
            </div>
            {captions.map((variantCaption, index) => (
              <div key={index} className="flex gap-2">
                <textarea
                  aria-label={t("variantNumber", { number: index + 1 })}
                  className="min-h-24 flex-1 rounded-md border bg-background p-3 text-sm"
                  value={variantCaption}
                  onChange={(event) => setCaptions((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))}
                />
                {captions.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCaptions((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                    {t("removeVariant")}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <label className="space-y-1.5 text-sm font-medium">
            {t("interval")}
            <input type="number" min={7} max={365} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            {t("reviewPolicy")}
            <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={reviewPolicy} onChange={(event) => setReviewPolicy(event.target.value as typeof reviewPolicy)}>
              <option value="approve_future_runs">{t("approveFuture")}</option>
              <option value="review_each_run">{t("reviewEach")}</option>
            </select>
          </label>
          {preview && (
            <div className={`rounded-xl border p-4 text-sm lg:col-span-2 ${preview.eligibility.eligible ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />{preview.eligibility.eligible ? t("eligible") : t("notEligible")}</div>
              <p className="mt-1">{preview.eligibility.evidence?.explanation || preview.eligibility.reasons.join(" ")}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 lg:col-span-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
            <Button disabled={saving || !preview?.eligibility.eligible || !selectedPost || !name.trim() || !captions.some((value) => value.trim())} onClick={() => void createQueue()}>{saving ? t("saving") : t("create")}</Button>
          </div>
        </div>
      )}

      {queues.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {queues.map((queue) => (
            <article key={queue.id} className="rounded-2xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold">{queue.name}</h3><p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{t(`statuses.${queue.status}`)}</p></div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{t("everyDays", { count: queue.intervalDays })}</span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />{queue.nextRunAt ? t("nextRun", { date: new Date(queue.nextRunAt).toLocaleString() }) : t("notScheduled")}</p>
                <p>{t("runs", { count: queue.runCount })}</p>
                {queue.activationEvidence && <p>{queue.activationEvidence.explanation}</p>}
                {queue.pauseReason && <p className="text-amber-700">{t("pausedReason", { reason: queue.pauseReason })}</p>}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {queue.status === "draft" && <Button size="sm" disabled={workingId === queue.id} onClick={() => void transition(queue, "activate")}><Play className="mr-2 h-4 w-4" />{t("actions.activate")}</Button>}
                {queue.status === "active" && <Button size="sm" variant="outline" disabled={workingId === queue.id} onClick={() => void transition(queue, "pause")}><Pause className="mr-2 h-4 w-4" />{t("actions.pause")}</Button>}
                {queue.status === "paused" && <Button size="sm" disabled={workingId === queue.id} onClick={() => void transition(queue, "resume")}><Play className="mr-2 h-4 w-4" />{t("actions.resume")}</Button>}
                <Button size="sm" variant="ghost" disabled={workingId === queue.id} onClick={() => void transition(queue, "archive")}>{t("actions.archive")}</Button>
                <Button size="sm" variant="ghost" aria-expanded={expandedId === queue.id} onClick={() => void toggleDetails(queue.id)}>
                  <BarChart3 className="mr-2 h-4 w-4" />{t("analytics.details")}
                  {expandedId === queue.id ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
                </Button>
              </div>
              {expandedId === queue.id && (
                <div className="mt-5 border-t pt-4">
                  {analyticsLoadingId === queue.id ? (
                    <p className="text-sm text-muted-foreground">{t("analytics.loading")}</p>
                  ) : analyticsByQueue[queue.id] ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {([
                          ["views", metric(analyticsByQueue[queue.id].lifetime.views)],
                          ["engagements", metric(analyticsByQueue[queue.id].lifetime.engagements)],
                          ["trackedClicks", analyticsByQueue[queue.id].lifetime.trackedLinkClicks.toLocaleString()],
                          ["conversions", analyticsByQueue[queue.id].lifetime.attributedConversions.toLocaleString()],
                          ["measured", analyticsByQueue[queue.id].lifetime.measuredOccurrences.toLocaleString()],
                          ["needsReview", analyticsByQueue[queue.id].runs.needsReview.toLocaleString()],
                        ] as const).map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-muted/60 p-3">
                            <p className="text-lg font-semibold text-foreground">{value}</p>
                            <p className="text-xs text-muted-foreground">{t(`analytics.${label}`)}</p>
                          </div>
                        ))}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">{t("analytics.recentRuns")}</h4>
                        {analyticsByQueue[queue.id].recentRuns.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground">{t("analytics.noRuns")}</p>
                        ) : (
                          <ul className="mt-2 divide-y rounded-lg border">
                            {analyticsByQueue[queue.id].recentRuns.map((run) => (
                              <li key={run.runId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                                <div>
                                  <p className="font-medium text-foreground">{new Date(run.plannedAt).toLocaleString()}</p>
                                  <p className="mt-0.5 text-muted-foreground">{run.reason || t("analytics.noOutcome")}</p>
                                </div>
                                <span className="rounded-full bg-muted px-2 py-1 uppercase tracking-wide">{run.status.replaceAll("_", " ")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
