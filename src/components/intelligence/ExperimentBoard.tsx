"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, FlaskConical, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Select from "@/components/app/Select";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import ImageCropDialog from "@/components/app/ImageCropDialog";
import LivePostEmbed from "@/components/intelligence/LivePostEmbed";
import { apiPost, apiDelete, apiUpload } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import { socialChannels, type SocialChannel } from "@/lib/schemas";
import { channelLabel } from "@/components/mk/channels";
import { getSocialChannelConfig } from "@/lib/social/channel-catalog";
import { getSharedMediaLimit, isVideoMediaUrl } from "@/lib/social/post-validation";
import { cn } from "@/lib/utils";
import { EmptyState, INSET, KindBadge, Section, TYPE } from "./shared";
import { useIntelligenceFormat } from "./format";

export type ExperimentItem = {
  id: string;
  name: string;
  status: string;
  hypothesis?: string;
  metric?: string;
  platform?: string;
  durationDays?: number;
  startsAt?: string;
  endsAt?: string;
  targetSamplePerArm?: number;
  armAPostId?: string;
  armBPostId?: string;
  armAPostIds?: string[];
  armBPostIds?: string[];
  result?: {
    status: string;
    effectPercent?: number | null;
    armAValue?: number | null;
    armBValue?: number | null;
  } | null;
  productId: string;
  schemaVersion?: number;
};

type LinkedPost = {
  id: string;
  content: string;
  mediaUrls: string[];
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  channel: string | null;
};

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string) {
  const date = new Date(value);
  return date.toISOString();
}

function defaultSchedule(hoursFromNow: number) {
  return toLocalInputValue(new Date(Date.now() + hoursFromNow * 60 * 60 * 1000));
}

function ArmMediaField({
  platform,
  mediaUrls,
  onChange,
}: {
  platform: SocialChannel;
  mediaUrls: string[];
  onChange: (urls: string[]) => void;
}) {
  const t = useTranslations("content.createTab");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingCropFiles, setPendingCropFiles] = useState<File[]>([]);
  const config = getSocialChannelConfig(platform);
  const mediaLimit = getSharedMediaLimit([platform]) || 1;
  const allowVideo = Boolean(config?.mediaKinds.includes("video"));

  async function uploadFiles(filesToUpload: File[]) {
    if (filesToUpload.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.all(
        filesToUpload.map(async (file) => {
          const isVideo = file.type.startsWith("video/");
          const maxSize = isVideo ? 250 * 1024 * 1024 : 10 * 1024 * 1024;
          if (file.size > maxSize) {
            toast.error(t("toasts.fileTooLarge", { size: isVideo ? "250" : "10" }));
            return null;
          }
          const fd = new FormData();
          fd.append(isVideo ? "video" : "image", file);
          const res = await apiUpload<{ ok: boolean; url: string }>("/api/media/upload", fd);
          if (!res.ok) {
            toast.error(userFacingError(res.data, t("toasts.fileUploadFailed"), {
              SUBSCRIPTION_REQUIRED: t("toasts.subscriptionRequired"),
              QUOTA_EXCEEDED_MEDIA_UPLOADS: t("toasts.uploadQuotaExceeded"),
              REQUEST_TIMEOUT: t("toasts.uploadTimedOut"),
            }));
            return null;
          }
          return res.data.url;
        }),
      );
      const uploaded = results.filter((u): u is string => !!u);
      if (uploaded.length > 0) {
        onChange([...mediaUrls, ...uploaded].slice(0, mediaLimit));
        toast.success(t("toasts.filesUploaded", { count: uploaded.length }));
      }
    } catch {
      toast.error(t("toasts.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handlePick(files: File[]) {
    if (files.length === 0) return;
    const containsVideo = files.some((file) => file.type.startsWith("video/"));
    if (containsVideo && !allowVideo) {
      toast.error(t("toasts.videoNotSupported"));
      return;
    }
    if (containsVideo && files.length > 1) {
      toast.error(t("toasts.videoAlone"));
      return;
    }
    const available = mediaLimit - mediaUrls.length;
    if (available <= 0) {
      toast.error(t("toasts.maxMedia", { count: mediaLimit }));
      return;
    }
    const selected = files.slice(0, available);
    const images = selected.filter((file) => file.type.startsWith("image/"));
    if (images.length > 0) {
      setPendingCropFiles(images);
      return;
    }
    await uploadFiles(selected);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={TYPE.meta}>{t("media")}</span>
        <span className={cn(TYPE.hint, "tabular-nums")}>{mediaUrls.length}/{mediaLimit}</span>
      </div>

      {mediaUrls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {mediaUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800/80">
              {isVideoMediaUrl(url) ? (
                <video src={url} className="h-full w-full object-cover" />
              ) : (
                <img src={url} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => onChange(mediaUrls.filter((_, idx) => idx !== i))}
                className="absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                aria-label={t("removeMedia")}
              >
                ×
              </button>
            </div>
          ))}
          {mediaUrls.length < mediaLimit && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-700"
              disabled={uploading}
            >
              {t("addMedia")}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full rounded-xl border-2 border-dashed border-slate-200 px-3 py-4 text-center text-slate-500 transition-colors hover:border-slate-300 dark:border-slate-700 dark:text-slate-400"
        >
          <p className="text-xs">{allowVideo ? t("dropImagesOrVideos") : t("dropImages")}</p>
          <p className={cn("mt-1", TYPE.hint)}>
            {t("mediaCountHint", {
              count: mediaLimit,
              hint: allowVideo ? t("mediaHintVideo") : t("mediaHintImage"),
            })}
          </p>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={allowVideo ? "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) void handlePick(files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || mediaUrls.length >= mediaLimit}
      >
        {uploading ? (
          <>
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            {t("uploading")}
          </>
        ) : (
          t("upload")
        )}
      </Button>

      <ImageCropDialog
        files={pendingCropFiles}
        channels={[platform]}
        onCancel={() => setPendingCropFiles([])}
        onConfirm={(cropped) => {
          setPendingCropFiles([]);
          void uploadFiles(cropped);
        }}
      />
    </div>
  );
}

const STATUS_TONE: Record<string, "slate" | "blue" | "amber" | "emerald"> = {
  draft: "slate",
  scheduled: "blue",
  running: "amber",
  complete: "emerald",
  archived: "slate",
  winner_a: "emerald",
  winner_b: "emerald",
  inconclusive: "slate",
};

type StatusKey = "draft" | "scheduled" | "running" | "complete" | "archived" | "winner_a" | "winner_b" | "inconclusive";

function statusOf(item: ExperimentItem): StatusKey {
  return (item.result?.status || item.status) as StatusKey;
}

function ExperimentDetail({ experimentId }: { experimentId: string }) {
  const t = useTranslations("intelligence.experiments");
  const fmt = useIntelligenceFormat();
  const detail = useApiQuery<{
    experiment: ExperimentItem;
    posts: { a: LinkedPost | null; b: LinkedPost | null };
  }>(`/api/intelligence/experiments/${experimentId}`);

  if (detail.loading && !detail.data) {
    return <p className={cn("mt-4", TYPE.hint)}>{t("loadingDetail")}</p>;
  }
  if (!detail.data) {
    return <p className={cn("mt-4", TYPE.hint)}>{t("detailFailed")}</p>;
  }

  const { experiment, posts } = detail.data;
  const result = experiment.result;
  const status = statusOf(experiment);
  const metric = fmt.metricName(experiment.metric || "views");
  const ends = fmt.dateTime(experiment.endsAt);
  const hasValues = result && result.armAValue != null && result.armBValue != null;
  const effect = result && typeof result.effectPercent === "number" ? Math.round(result.effectPercent) : null;
  const leading = status === "winner_a" ? "A" : status === "winner_b" ? "B" : null;

  return (
    <div className="mt-4 space-y-4">
      {experiment.status === "complete" ? (
        <div className={cn("p-4", INSET)}>
          <p className={TYPE.strong}>{t(`result.${status === "winner_a" || status === "winner_b" ? status : "inconclusive"}`)}</p>
          <p className={cn("mt-1", TYPE.hint)}>
            {effect !== null
              ? t("resultDetail", { effect: `${effect > 0 ? "+" : ""}${effect}`, metric })
              : t("resultMissing", { metric })}
            {" "}
            {t("resultCaveat")}
          </p>
        </div>
      ) : (
        <p className={cn("px-3 py-2", INSET, TYPE.hint)}>
          {ends ? t("runningUntil", { when: ends, metric }) : t("scheduledNote", { metric })}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LivePostEmbed
          armLabel="A"
          platform={experiment.platform || posts.a?.channel || "instagram"}
          content={posts.a?.content || ""}
          mediaUrls={posts.a?.mediaUrls || []}
          externalUrl={posts.a?.externalUrl}
          value={hasValues ? `${fmt.metric(result.armAValue)} ${metric}` : undefined}
          leading={leading === "A"}
        />
        <LivePostEmbed
          armLabel="B"
          platform={experiment.platform || posts.b?.channel || "instagram"}
          content={posts.b?.content || ""}
          mediaUrls={posts.b?.mediaUrls || []}
          externalUrl={posts.b?.externalUrl}
          value={hasValues ? `${fmt.metric(result.armBValue)} ${metric}` : undefined}
          leading={leading === "B"}
        />
      </div>
    </div>
  );
}

function ArmComposer({
  arm,
  platform,
  content,
  onContent,
  media,
  onMedia,
  when,
  onWhen,
  scheduleLabel,
}: {
  arm: "A" | "B";
  platform: SocialChannel;
  content: string;
  onContent: (value: string) => void;
  media: string[];
  onMedia: (urls: string[]) => void;
  when: string;
  onWhen: (value: string) => void;
  scheduleLabel: string;
}) {
  const t = useTranslations("intelligence.experiments");
  return (
    <div className={cn("space-y-3 p-4", INSET)}>
      <div className="flex items-center justify-between">
        <p className={TYPE.strong}>{t("armCompose", { arm })}</p>
        <span className={TYPE.meta}>{arm === "A" ? t("armControl") : t("armVariant")}</span>
      </div>
      <Textarea rows={4} value={content} onChange={(e) => onContent(e.target.value)} placeholder={t("captionPlaceholder")} className="rounded-xl bg-white text-[13px] dark:bg-slate-900" />
      <ArmMediaField platform={platform} mediaUrls={media} onChange={onMedia} />
      <div>
        <label className={TYPE.meta}>{scheduleLabel}</label>
        <Input type="datetime-local" value={when} onChange={(e) => onWhen(e.target.value)} aria-label={scheduleLabel} className="mt-1 rounded-xl bg-white dark:bg-slate-900" />
      </div>
    </div>
  );
}

export default function ExperimentBoard({
  productId,
  experiments,
  loading,
  focusExperimentId,
}: {
  productId: string;
  experiments: ExperimentItem[];
  loading?: boolean;
  focusExperimentId?: string | null;
}) {
  const t = useTranslations("intelligence.experiments");
  const fmt = useIntelligenceFormat();
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [platform, setPlatform] = useState<(typeof socialChannels)[number]>("instagram");
  const [durationDays, setDurationDays] = useState(7);
  const [armAContent, setArmAContent] = useState("");
  const [armBContent, setArmBContent] = useState("");
  const [armAMedia, setArmAMedia] = useState<string[]>([]);
  const [armBMedia, setArmBMedia] = useState<string[]>([]);
  const [armAWhen, setArmAWhen] = useState(defaultSchedule(2));
  const [armBWhen, setArmBWhen] = useState(defaultSchedule(26));
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExperimentItem | null>(null);
  // `undefined` = the user has not chosen (open the focused or newest one), `null` = collapsed.
  const [chosenComposer, setComposer] = useState<boolean | undefined>(undefined);
  const [chosenExpandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const focused = focusExperimentId && experiments.some((item) => item.id === focusExperimentId) ? focusExperimentId : null;
  const expandedId = chosenExpandedId === undefined ? focused ?? experiments[0]?.id ?? null : chosenExpandedId;
  const composerOpen = chosenComposer === undefined ? experiments.length === 0 && !loading : chosenComposer;
  const focusRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (focused && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);

  const mediaRequired = Boolean(getSocialChannelConfig(platform)?.mediaRequired);

  // Drop media that would exceed the new platform's limit when the channel
  // changes. Adjusting during render keeps this to one pass (no effect).
  const [mediaLimitPlatform, setMediaLimitPlatform] = useState(platform);
  if (mediaLimitPlatform !== platform) {
    const limit = getSharedMediaLimit([platform]) || 1;
    setMediaLimitPlatform(platform);
    setArmAMedia((prev) => prev.slice(0, limit));
    setArmBMedia((prev) => prev.slice(0, limit));
  }

  const canCreate = useMemo(() => {
    const mediaOk = !mediaRequired || (armAMedia.length > 0 && armBMedia.length > 0);
    return Boolean(
      name.trim()
      && hypothesis.trim()
      && armAContent.trim()
      && armBContent.trim()
      && armAWhen
      && armBWhen
      && mediaOk,
    );
  }, [name, hypothesis, armAContent, armBContent, armAWhen, armBWhen, armAMedia, armBMedia, mediaRequired]);

  async function create() {
    if (mediaRequired && (armAMedia.length === 0 || armBMedia.length === 0)) {
      toast.error(t("mediaRequired"));
      return;
    }
    setCreating(true);
    try {
      const response = await apiPost("/api/intelligence/experiments", {
        productId,
        name: name.trim(),
        hypothesis: hypothesis.trim(),
        platform,
        metric: "views",
        durationDays,
        targetSamplePerArm: 1,
        armA: {
          content: armAContent.trim(),
          mediaUrls: armAMedia,
          scheduledAt: fromLocalInputValue(armAWhen),
          label: "A",
        },
        armB: {
          content: armBContent.trim(),
          mediaUrls: armBMedia,
          scheduledAt: fromLocalInputValue(armBWhen),
          label: "B",
        },
      }, undefined, { timeoutMs: 60_000 });
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("createFailed")));
        return;
      }
      toast.success(t("createdPaired"));
      setName("");
      setHypothesis("");
      setArmAContent("");
      setArmBContent("");
      setArmAMedia([]);
      setArmBMedia([]);
      setComposer(false);
      invalidateQueries("/api/intelligence/experiments");
      const created = (response.data as { experiment?: { id?: string } })?.experiment?.id;
      if (created) setExpandedId(created);
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function remove(experiment: ExperimentItem) {
    const response = await apiDelete(`/api/intelligence/experiments/${experiment.id}`);
    if (!response.ok) {
      toast.error(userFacingError(response.data, t("deleteFailed")));
      throw new Error("delete_failed");
    }
    toast.success(t("deleted"));
    if (expandedId === experiment.id) setExpandedId(null);
    invalidateQueries("/api/intelligence/experiments");
    invalidateQueries("/api/intelligence/overview");
    invalidateQueries("/api/inbox");
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Section
        trust="measured"
        title={t("title")}
        subtitle={t("subtitle")}
        help="experiments"
        action={
          <Button
            type="button"
            size="sm"
            variant={composerOpen ? "outline" : "default"}
            className="h-8 gap-1.5 rounded-xl text-xs font-semibold"
            onClick={() => setComposer(!composerOpen)}
          >
            {composerOpen ? <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {composerOpen ? t("closeComposer") : t("newExperiment")}
          </Button>
        }
      >
        {composerOpen && (
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={TYPE.meta}>{t("name")}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} aria-label={t("name")} className="mt-1 rounded-xl" />
              </div>
              <div>
                <label className={TYPE.meta}>{t("platform")}</label>
                <Select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} className="mt-1">
                  {socialChannels.map((channel) => (
                    <option key={channel} value={channel}>{channelLabel(channel)}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className={TYPE.meta}>{t("hypothesis")}</label>
                <Input
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                  placeholder={t("hypothesisPlaceholder")}
                  aria-label={t("hypothesis")}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <label className={TYPE.meta}>{t("window")}</label>
                <Select value={String(durationDays)} onChange={(e) => setDurationDays(Number(e.target.value))} className="mt-1">
                  <option value="3">{t("durationOption", { days: 3 })}</option>
                  <option value="7">{t("durationOption", { days: 7 })}</option>
                  <option value="14">{t("durationOption", { days: 14 })}</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ArmComposer arm="A" platform={platform} content={armAContent} onContent={setArmAContent} media={armAMedia} onMedia={setArmAMedia} when={armAWhen} onWhen={setArmAWhen} scheduleLabel={t("scheduleA")} />
              <ArmComposer arm="B" platform={platform} content={armBContent} onContent={setArmBContent} media={armBMedia} onMedia={setArmBMedia} when={armBWhen} onWhen={setArmBWhen} scheduleLabel={t("scheduleB")} />
            </div>

            <ul className={cn("space-y-1 px-3 py-2.5", INSET, TYPE.hint)}>
              <li>{t("tipOneChange")}</li>
              <li>{t("tipSameSlot")}</li>
              <li>{t("tipDecision")}</li>
              {mediaRequired && <li>{t("mediaRequiredHint")}</li>}
            </ul>

            <Button type="button" className="h-9 w-fit rounded-xl text-xs font-semibold" disabled={!canCreate || creating} onClick={() => void create()}>
              {creating && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              {creating ? t("creating") : t("createPaired")}
            </Button>
          </div>
        )}

        {loading ? (
          <p className={cn(composerOpen && "mt-5", TYPE.hint)}>{t("loadingDetail")}</p>
        ) : experiments.length === 0 ? (
          !composerOpen && (
            <EmptyState icon={FlaskConical} title={t("emptyTitle")} body={t("emptyPaired")} />
          )
        ) : (
          <ul className={cn("divide-y divide-slate-100 dark:divide-slate-800/80", composerOpen && "mt-6 border-t border-slate-100 pt-2 dark:border-slate-800/80")}>
            {experiments.map((item) => {
              const open = expandedId === item.id;
              const status = statusOf(item);
              const ends = fmt.dateTime(item.endsAt);
              return (
                <li key={item.id} ref={item.id === focused ? focusRef : undefined} className="scroll-mt-24 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-start"
                      onClick={() => setExpandedId(open ? null : item.id)}
                      aria-expanded={open}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <KindBadge tone={STATUS_TONE[status] || "slate"}>{t(`status.${status}`)}</KindBadge>
                        <span className={cn("truncate", TYPE.cardTitle)}>{item.name || t("untitledExperiment")}</span>
                      </div>
                      <p className={cn("mt-1", TYPE.hint)}>
                        {item.platform ? channelLabel(item.platform) : "n/a"}
                        {item.hypothesis ? ` · ${item.hypothesis}` : ""}
                        {ends ? ` · ${t("endsLabel", { when: ends })}` : ""}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDelete(item);
                        }}
                      >
                        {t("delete")}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : item.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label={open ? t("collapse") : t("expand")}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {open && <ExperimentDetail experimentId={item.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        entity="experiment"
        name={pendingDelete?.name || t("untitledExperiment")}
        warning={t("deleteWarning")}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await remove(pendingDelete);
        }}
      />
    </div>
  );
}
