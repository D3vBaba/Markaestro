"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, ShieldCheck, Wand } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import Notice from "@/components/app/Notice";
import Select from "@/components/app/Select";
import FormField from "@/components/app/FormField";
import SourcePostPicker, { type SourceCandidate } from "@/app/(app)/content/_components/SourcePostPicker";
import { Channel } from "@/components/mk/Channel";
import { channelLabel } from "@/components/mk/channels";
import { apiGet, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { messageFrom, type Preview } from "./types";

type ChannelInfo = {
  channel: string;
  state: "ready" | "needs_setup" | "disconnected";
  destinations: Array<{ destinationId: string | null; label: string | null; state: string }>;
};
type Variant = { angle: "new_hook" | "shorter" | "question" | "different_cta"; caption: string };
type Duplicate = { caption: string; postId: string; channel: string; publishedAt: string | null };

export default function CreateQueueSheet({
  open,
  onOpenChange,
  productId,
  candidates,
  candidatesLoading,
  initialSourceId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  candidates: SourceCandidate[];
  candidatesLoading: boolean;
  initialSourceId?: string | null;
  onCreated: () => Promise<void> | void;
}) {
  const t = useTranslations("content.evergreenTab");
  const locale = useLocale();
  const [sourcePostId, setSourcePostId] = useState(initialSourceId ?? "");
  const [pickerOpen, setPickerOpen] = useState(!initialSourceId);
  const [name, setName] = useState("");
  const [captions, setCaptions] = useState<string[]>([""]);
  const [suggested, setSuggested] = useState<Variant[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [intervalDays, setIntervalDays] = useState(30);
  const [reviewPolicy, setReviewPolicy] = useState<"approve_future_runs" | "review_each_run">("approve_future_runs");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => candidates.find((c) => c.id === sourcePostId) ?? null, [candidates, sourcePostId]);
  const sourceChannels = selected?.channels ?? [];

  useEffect(() => {
    if (!open) return;
    void apiGet<{ channels: ChannelInfo[] }>(`/api/social/channels?productId=${encodeURIComponent(productId)}`)
      .then((res) => { if (res.ok) setChannels(res.data.channels); });
  }, [open, productId]);

  // Seed captions, name and channels from the chosen post once it is known.
  // Adjusted during render (not in an effect) so the first paint after a pick
  // already shows the seeded form; candidates can arrive after mount.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (selected && seededFor !== selected.id) {
    setSeededFor(selected.id);
    setCaptions([selected.content]);
    setName((current) => current || t("defaultName", { channel: channelLabel(selected.channel) }));
    setSelectedChannels(selected.channels);
    setSuggested([]);
    setDuplicates([]);
  }

  useEffect(() => {
    if (!sourcePostId || !open) return;
    let cancelled = false;
    void apiPost<Preview>("/api/evergreen-queues/preview", { sourcePostId }).then((res) => {
      if (cancelled) return;
      if (!res.ok) { toast.error(messageFrom(res.data, t("previewFailed"))); return; }
      setPreview(res.data);
      setIntervalDays(res.data.recommendation.intervalDays);
    });
    return () => { cancelled = true; };
  }, [sourcePostId, open, t]);

  const checkDuplicates = async (values: string[]) => {
    const live = values.map((v) => v.trim()).filter(Boolean);
    if (live.length === 0) { setDuplicates([]); return; }
    const res = await apiPost<{ duplicates: Duplicate[] }>("/api/evergreen-queues/duplicates", { productId, captions: live });
    if (res.ok) setDuplicates(res.data.duplicates);
  };

  const suggestCaptions = async () => {
    if (!sourcePostId) return;
    setSuggesting(true);
    const res = await apiPost<{ variants: Variant[] }>("/api/evergreen-queues/variants", { sourcePostId });
    setSuggesting(false);
    if (!res.ok) { toast.error(messageFrom(res.data, t("createFlow.suggestFailed"))); return; }
    setSuggested(res.data.variants);
  };

  const applyVariant = (variant: Variant) => {
    setSuggested((current) => current.filter((v) => v !== variant));
    setCaptions((current) => {
      const next = current.filter((v) => v.trim()).concat(variant.caption);
      void checkDuplicates(next);
      return next;
    });
  };

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) => current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]);
  };

  const extraChannels = channels.filter((c) => c.state === "ready" && !sourceChannels.includes(c.channel));
  const readyDestinations = (channel: string) => (channels.find((c) => c.channel === channel)?.destinations ?? []).filter((d) => d.state === "ready" && d.destinationId);
  const missingDestination = selectedChannels.filter((c) => !sourceChannels.includes(c) && !destinations[c] && readyDestinations(c).length !== 1);

  const create = async () => {
    const variants = captions.map((v) => v.trim()).filter(Boolean);
    if (!sourcePostId || !name.trim() || variants.length === 0) return;
    setSaving(true);
    const recommendation = preview?.recommendation;
    const timeZone = recommendation?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const channelDestinations: Record<string, string> = {};
    for (const channel of selectedChannels) {
      if (sourceChannels.includes(channel)) continue;
      const chosen = destinations[channel] ?? readyDestinations(channel)[0]?.destinationId ?? "";
      if (chosen) channelDestinations[channel] = chosen;
    }
    const res = await apiPost("/api/evergreen-queues", {
      productId,
      sourcePostId,
      name: name.trim(),
      channels: selectedChannels,
      channelDestinations,
      intervalDays,
      timeZone,
      localHour: recommendation?.localHour ?? 10,
      localMinute: recommendation?.localMinute ?? 0,
      scheduleMode: recommendation?.scheduleMode ?? "fixed",
      reviewPolicy,
      variants: variants.map((caption) => ({ caption, enabled: true })),
    });
    setSaving(false);
    if (!res.ok) { toast.error(messageFrom(res.data, t("createFailed"))); return; }
    toast.success(t("created"));
    onOpenChange(false);
    await onCreated();
  };

  const canCreate = Boolean(sourcePostId && name.trim() && captions.some((v) => v.trim()) && preview?.eligibility.eligible && selectedChannels.length > 0 && missingDestination.length === 0 && !saving);
  const step = (label: string) => <p className="m-0 text-sm font-semibold text-foreground">{label}</p>;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("createFlow.title")}</SheetTitle>
          <SheetDescription>{t("createFlow.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5 sm:px-6">
          <section className="space-y-3">
            {step(t("createFlow.sourceStep"))}
            <p className="m-0 text-[13px] text-muted-foreground">{t("sourceHint")}</p>
            {selected && !pickerOpen ? (
              <div className="flex items-center gap-3 rounded-xl border border-mk-accent bg-mk-accent-soft/60 p-3">
                <Channel channel={selected.channel} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs text-muted-foreground">{t("selectedSource")} · {channelLabel(selected.channel)}</p>
                  <p className="m-0 mt-0.5 line-clamp-2 text-[13px] leading-5 text-foreground">{selected.content}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>{t("changeSource")}</Button>
              </div>
            ) : (
              <SourcePostPicker candidates={candidates} value={sourcePostId} onChange={(id) => { setSourcePostId(id); setPickerOpen(false); }} loading={candidatesLoading} />
            )}
            {preview && (
              <Notice tone={preview.eligibility.eligible ? "positive" : "warning"} icon={ShieldCheck} title={preview.eligibility.eligible ? t("eligible") : t("notEligible")}>
                {preview.eligibility.evidence?.explanation || preview.eligibility.reasons.map((r) => t(`picker.reasons.${r}`)).join(" ")}
              </Notice>
            )}
          </section>

          {sourcePostId && (
            <>
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {step(t("createFlow.captionsStep"))}
                    <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{t("createFlow.suggestHint")}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={suggesting} onClick={() => void suggestCaptions()}>
                    <Wand className="size-3.5" />
                    {suggesting ? t("createFlow.suggesting") : t("createFlow.suggestCaptions")}
                  </Button>
                </div>
                {suggested.length > 0 && (
                  <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0">
                    {suggested.map((variant) => (
                      <li key={variant.caption} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <Badge variant="accent">{t(`createFlow.angles.${variant.angle}`)}</Badge>
                          <p className="m-0 mt-1.5 whitespace-pre-line text-[13px] leading-5 text-mk-ink-80">{variant.caption}</p>
                        </div>
                        <Button type="button" size="xs" variant="outline" onClick={() => applyVariant(variant)}>{t("createFlow.useVariant")}</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-3">
                  {captions.map((caption, index) => {
                    const dup = duplicates.find((d) => d.caption === caption.trim());
                    return (
                      <div key={index} className="space-y-1.5">
                        <div className="flex gap-2">
                          <Textarea
                            aria-label={t("variantNumber", { number: index + 1 })}
                            className={cn("min-h-24 flex-1", dup && "border-mk-warn")}
                            value={caption}
                            onChange={(e) => setCaptions((current) => current.map((v, i) => (i === index ? e.target.value : v)))}
                            onBlur={() => void checkDuplicates(captions)}
                          />
                          {captions.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setCaptions((current) => current.filter((_, i) => i !== index))}>{t("removeVariant")}</Button>
                          )}
                        </div>
                        {dup && (
                          <p className="m-0 text-xs text-mk-warn">
                            {t("createFlow.duplicateWarning", { date: dup.publishedAt ? new Date(dup.publishedAt).toLocaleDateString(locale, { month: "short", day: "numeric" }) : "" })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCaptions((current) => [...current, ""])}>
                    <Plus className="size-3.5" />{t("addVariant")}
                  </Button>
                </div>
              </section>

              <section className="space-y-3">
                {step(t("createFlow.channelsTitle"))}
                <p className="m-0 text-[13px] text-muted-foreground">{t("createFlow.channelsHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {[...sourceChannels, ...extraChannels.map((c) => c.channel)].map((channel) => {
                    const on = selectedChannels.includes(channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleChannel(channel)}
                        className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors", on ? "border-mk-accent bg-mk-accent-soft text-foreground" : "border-border bg-card text-mk-ink-80 hover:bg-muted")}
                      >
                        <Channel channel={channel} size={16} />
                        {channelLabel(channel)}
                      </button>
                    );
                  })}
                </div>
                {selectedChannels.filter((c) => !sourceChannels.includes(c) && readyDestinations(c).length > 1).map((channel) => (
                  <FormField key={channel} label={channelLabel(channel)}>
                    <Select value={destinations[channel] ?? ""} onChange={(e) => setDestinations((d) => ({ ...d, [channel]: e.target.value }))}>
                      <option value="">{t("choosePost")}</option>
                      {readyDestinations(channel).map((d) => <option key={d.destinationId!} value={d.destinationId!}>{d.label ?? d.destinationId}</option>)}
                    </Select>
                  </FormField>
                ))}
              </section>

              <section className="space-y-4">
                {step(t("createFlow.scheduleStep"))}
                <div className="grid gap-5 pt-1 sm:grid-cols-2">
                  <FormField label={t("queueName")} htmlFor="eg-name">
                    <Input id="eg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                  </FormField>
                  <FormField label={t("interval")} htmlFor="eg-interval">
                    <Input id="eg-interval" type="number" min={7} max={365} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} />
                  </FormField>
                  <FormField label={t("reviewPolicy")} htmlFor="eg-review">
                    <Select id="eg-review" value={reviewPolicy} onChange={(e) => setReviewPolicy(e.target.value as typeof reviewPolicy)}>
                      <option value="approve_future_runs">{t("approveFuture")}</option>
                      <option value="review_each_run">{t("reviewEach")}</option>
                    </Select>
                  </FormField>
                </div>
                {preview?.recommendation && <p className="m-0 text-[13px] text-muted-foreground">{preview.recommendation.explanation}</p>}
              </section>
            </>
          )}
        </div>

        <SheetFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button disabled={!canCreate} onClick={() => void create()}>{saving ? t("saving") : t("create")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
