"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
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
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--mk-ink-40)" }}>
          {t("media")}
        </span>
        <span className="text-[11px]" style={{ color: "var(--mk-ink-40)" }}>
          {mediaUrls.length}/{mediaLimit}
        </span>
      </div>

      {mediaUrls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {mediaUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: "var(--mk-rule-soft)" }}>
              {isVideoMediaUrl(url) ? (
                <video src={url} className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
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
              className="aspect-square rounded-lg border-2 border-dashed text-xs"
              style={{ borderColor: "var(--mk-rule-soft)", color: "var(--mk-ink-40)" }}
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
          className="w-full rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors"
          style={{ borderColor: "var(--mk-rule-soft)", color: "var(--mk-ink-60)" }}
        >
          <p className="text-[12px]">{allowVideo ? t("dropImagesOrVideos") : t("dropImages")}</p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--mk-ink-40)" }}>
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

function ExperimentDetail({ experimentId }: { experimentId: string }) {
  const t = useTranslations("intelligence.experiments");
  const detail = useApiQuery<{
    experiment: ExperimentItem;
    posts: { a: LinkedPost | null; b: LinkedPost | null };
  }>(`/api/intelligence/experiments/${experimentId}`);

  if (detail.loading && !detail.data) {
    return <p className="text-[12px]" style={{ color: "var(--mk-ink-40)" }}>{t("loadingDetail")}</p>;
  }
  if (!detail.data) {
    return <p className="text-[12px]" style={{ color: "var(--mk-ink-40)" }}>{t("detailFailed")}</p>;
  }

  const { experiment, posts } = detail.data;
  const endsLabel = experiment.endsAt ? new Date(experiment.endsAt).toLocaleString() : "n/a";

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: "var(--mk-ink-60)" }}>
        <span>{t("platformLabel", { platform: channelLabel(experiment.platform || "") })}</span>
        <span>{t("endsLabel", { when: endsLabel })}</span>
        {experiment.result?.status && (
          <span className="font-semibold" style={{ color: "var(--mk-ink)" }}>
            {t(`status.${experiment.result.status as "winner_a"}`)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LivePostEmbed
          armLabel="A"
          platform={experiment.platform || posts.a?.channel || "instagram"}
          content={posts.a?.content || ""}
          mediaUrls={posts.a?.mediaUrls || []}
          externalUrl={posts.a?.externalUrl}
        />
        <LivePostEmbed
          armLabel="B"
          platform={experiment.platform || posts.b?.channel || "instagram"}
          content={posts.b?.content || ""}
          mediaUrls={posts.b?.mediaUrls || []}
          externalUrl={posts.b?.externalUrl}
        />
      </div>
      {experiment.result && typeof experiment.result.effectPercent === "number" && (
        <p className="text-[12px]" style={{ color: "var(--mk-ink-60)" }}>
          {t("effect", { value: Math.round(experiment.result.effectPercent) })}
          {experiment.result.armAValue != null && experiment.result.armBValue != null
            ? ` · A=${experiment.result.armAValue} · B=${experiment.result.armBValue}`
            : ""}
        </p>
      )}
    </div>
  );
}

export default function ExperimentBoard({
  productId,
  experiments,
}: {
  productId: string;
  experiments: ExperimentItem[];
}) {
  const t = useTranslations("intelligence.experiments");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [platform, setPlatform] = useState<(typeof socialChannels)[number]>("instagram");
  const [durationDays, setDurationDays] = useState(7);
  const [armAContent, setArmAContent] = useState("");
  const [armBContent, setArmBContent] = useState("");
  const [armAMedia, setArmAMedia] = useState<string[]>([]);
  const [armBMedia, setArmBMedia] = useState<string[]>([]);
  const [armAWhen, setArmAWhen] = useState(defaultSchedule(2));
  const [armBWhen, setArmBWhen] = useState(defaultSchedule(6));
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExperimentItem | null>(null);
  // `undefined` = nothing chosen yet (first experiment opens), `null` = collapsed by the user.
  const [chosenExpandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const expandedId = chosenExpandedId === undefined ? experiments[0]?.id ?? null : chosenExpandedId;

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
    <div className="space-y-5">
      <p className="text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>
        {t("pairedWorkflow")}
      </p>

      <div className="grid gap-3 rounded-2xl border p-4" style={{ borderColor: "var(--mk-rule-soft)" }}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("name")} aria-label={t("name")} />
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            {socialChannels.map((channel) => (
              <option key={channel} value={channel}>{channelLabel(channel)}</option>
            ))}
          </Select>
        </div>
        <Input
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder={t("hypothesis")}
          aria-label={t("hypothesis")}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select value={String(durationDays)} onChange={(e) => setDurationDays(Number(e.target.value))}>
            <option value="3">{t("durationOption", { days: 3 })}</option>
            <option value="7">{t("durationOption", { days: 7 })}</option>
            <option value="14">{t("durationOption", { days: 14 })}</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--mk-rule-soft)" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--mk-ink-60)" }}>{t("armCompose", { arm: "A" })}</p>
            <Textarea rows={4} value={armAContent} onChange={(e) => setArmAContent(e.target.value)} placeholder={t("captionPlaceholder")} />
            <ArmMediaField platform={platform} mediaUrls={armAMedia} onChange={setArmAMedia} />
            <Input type="datetime-local" value={armAWhen} onChange={(e) => setArmAWhen(e.target.value)} aria-label={t("scheduleA")} />
          </div>
          <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--mk-rule-soft)" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--mk-ink-60)" }}>{t("armCompose", { arm: "B" })}</p>
            <Textarea rows={4} value={armBContent} onChange={(e) => setArmBContent(e.target.value)} placeholder={t("captionPlaceholder")} />
            <ArmMediaField platform={platform} mediaUrls={armBMedia} onChange={setArmBMedia} />
            <Input type="datetime-local" value={armBWhen} onChange={(e) => setArmBWhen(e.target.value)} aria-label={t("scheduleB")} />
          </div>
        </div>

        {mediaRequired && (
          <p className="text-[12px]" style={{ color: "var(--mk-ink-60)" }}>{t("mediaRequiredHint")}</p>
        )}

        <Button type="button" className="h-9 w-fit rounded-lg text-[13px]" disabled={!canCreate || creating} onClick={() => void create()}>
          {creating && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
          {creating ? t("creating") : t("createPaired")}
        </Button>
      </div>

      {experiments.length === 0 ? (
        <p className="text-[13px] leading-5" style={{ color: "var(--mk-ink-60)" }}>{t("emptyPaired")}</p>
      ) : (
        <div className="space-y-3">
          {experiments.map((item) => {
            const open = expandedId === item.id;
            const statusKey = (item.result?.status || item.status) as "draft" | "scheduled" | "running" | "complete" | "archived" | "winner_a" | "winner_b" | "inconclusive";
            return (
              <div key={item.id} className="rounded-xl border px-4 py-3.5" style={{ borderColor: "var(--mk-rule-soft)" }}>
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => setExpandedId(open ? null : item.id)}
                  >
                    <div className="truncate text-[13px] font-semibold" style={{ color: "var(--mk-ink)" }}>{item.name}</div>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--mk-ink-60)" }}>
                      {item.platform ? channelLabel(item.platform) : "n/a"}
                      {item.hypothesis ? ` · ${item.hypothesis}` : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] uppercase" style={{ color: "var(--mk-ink-40)" }}>
                      {t(`status.${statusKey}`)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete(item);
                      }}
                    >
                      {t("delete")}
                    </Button>
                  </div>
                </div>
                {open && <ExperimentDetail experimentId={item.id} />}
              </div>
            );
          })}
        </div>
      )}

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
