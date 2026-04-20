"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, Images, Zap, Target } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import ProductPicker from "@/app/content/_components/ProductPicker";
import WizardStepper from "./WizardStepper";
import MediaUploader from "./MediaUploader";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type CampaignType = "standard" | "pipeline";
type MediaMode = "ai" | "own";

const steps = [
  { key: "basics", label: "Foundation", hint: "What & who" },
  { key: "content", label: "Creative", hint: "Voice & visuals" },
  { key: "schedule", label: "Cadence", hint: "When & how often" },
];

const socialChannels = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
];

const cadenceOptions = [
  { value: "daily", label: "Daily", hint: "Every day" },
  { value: "3x_week", label: "3× / week", hint: "Mon · Wed · Fri" },
  { value: "2x_week", label: "2× / week", hint: "Tue · Thu" },
  { value: "weekly", label: "Weekly", hint: "Mondays" },
];

export default function CampaignWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string, type: CampaignType) => void;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<CampaignType>("standard");
  const [submitting, setSubmitting] = useState(false);

  // Shared
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [mediaMode, setMediaMode] = useState<MediaMode>("ai");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [creativeBrief, setCreativeBrief] = useState("");

  // Standard
  const [channel, setChannel] = useState("facebook");
  const [targetAudience, setTargetAudience] = useState("");
  const [cta, setCta] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Pipeline
  const [channels, setChannels] = useState<string[]>(["facebook"]);
  const [cadence, setCadence] = useState("3x_week");
  const [postCount, setPostCount] = useState(20);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [postTimeHourUTC, setPostTimeHourUTC] = useState(10);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setType("standard");
      setName(""); setProductId(""); setMediaMode("ai"); setMediaUrls([]); setCreativeBrief("");
      setChannel("facebook"); setTargetAudience(""); setCta(""); setScheduledAt("");
      setChannels(["facebook"]); setCadence("3x_week"); setPostCount(20); setPostTimeHourUTC(10);
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setStartDate(d.toISOString().slice(0, 10));
    }
  }, [open]);

  const toggleChannel = (ch: string) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));

  const canContinue = useMemo(() => {
    if (step === 0) {
      if (!name.trim()) return false;
      if (type === "pipeline" && !productId) return false;
      return true;
    }
    if (step === 1) {
      if (type === "pipeline" && channels.length === 0) return false;
      if (mediaMode === "own" && mediaUrls.length === 0) return false;
      return true;
    }
    return true;
  }, [step, name, type, productId, channels, mediaMode, mediaUrls]);

  const handleNext = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      if (type === "standard") {
        const res = await apiPost<{ id: string }>("/api/campaigns", {
          name: name.trim(),
          channel,
          type: "standard",
          productId: productId || undefined,
          targetAudience: targetAudience.trim(),
          cta: cta.trim(),
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          mediaUrls,
        });
        if (res.ok) {
          toast.success("Campaign created");
          onCreated(res.data.id, "standard");
          onOpenChange(false);
        } else {
          const errData = res.data as { error?: string; issues?: { message: string }[] };
          toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create");
        }
      } else {
        const res = await apiPost<{ id: string }>("/api/campaigns", {
          name: name.trim(),
          type: "pipeline",
          channel: channels[0],
          productId,
          mediaUrls,
          pipeline: {
            channels,
            cadence,
            postCount,
            startDate: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
            stages: ["awareness", "interest", "consideration", "trial", "activation", "retention"],
            postTimeHourUTC,
          },
        });
        if (res.ok) {
          toast.success("Pipeline created");
          onCreated(res.data.id, "pipeline");
          onOpenChange(false);
        } else {
          const errData = res.data as { error?: string; issues?: { message: string }[] };
          toast.error(errData.issues?.[0]?.message || errData.error || "Failed to create pipeline");
        }
      }
    } catch {
      toast.error("Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <SheetTitle className="font-[family-name:var(--font-display)] text-2xl font-normal tracking-tight">
            New Campaign
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {type === "pipeline"
              ? "A multi-stage adoption pipeline, researched and generated."
              : "A single, focused post or message on one channel."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-6 pt-4 pb-2 border-b border-border/40 bg-muted/10">
          <WizardStepper steps={steps} current={step} onStepClick={(i) => i < step && setStep(i)} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="space-y-6"
            >
              {step === 0 && (
                <StepBasics
                  type={type}
                  onTypeChange={setType}
                  name={name}
                  onNameChange={setName}
                  productId={productId}
                  onProductIdChange={setProductId}
                />
              )}

              {step === 1 && (
                <StepContent
                  type={type}
                  channel={channel}
                  onChannelChange={setChannel}
                  channels={channels}
                  toggleChannel={toggleChannel}
                  targetAudience={targetAudience}
                  onTargetAudienceChange={setTargetAudience}
                  cta={cta}
                  onCtaChange={setCta}
                  mediaMode={mediaMode}
                  onMediaModeChange={setMediaMode}
                  mediaUrls={mediaUrls}
                  onMediaUrlsChange={setMediaUrls}
                  creativeBrief={creativeBrief}
                  onCreativeBriefChange={setCreativeBrief}
                />
              )}

              {step === 2 && (
                <StepSchedule
                  type={type}
                  scheduledAt={scheduledAt}
                  onScheduledAtChange={setScheduledAt}
                  cadence={cadence}
                  onCadenceChange={setCadence}
                  postCount={postCount}
                  onPostCountChange={setPostCount}
                  startDate={startDate}
                  onStartDateChange={setStartDate}
                  postTimeHourUTC={postTimeHourUTC}
                  onPostTimeHourUTCChange={setPostTimeHourUTC}
                  review={{ name, type, channels, channel, productId, mediaMode, mediaUrls, creativeBrief }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="px-6 py-4 border-t border-border/40 bg-background/80 backdrop-blur-sm flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={step === 0 ? () => onOpenChange(false) : handleBack}
            className="rounded-xl"
          >
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
              </>
            )}
          </Button>

          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all",
                  i === step ? "w-6 bg-foreground" : i < step ? "w-1.5 bg-foreground/60" : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>

          {step < steps.length - 1 ? (
            <Button onClick={handleNext} disabled={!canContinue} className="rounded-xl">
              Next <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={submitting || !canContinue} className="rounded-xl">
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Creating…</>
              ) : (
                <>Create {type === "pipeline" ? "Pipeline" : "Campaign"}</>
              )}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Step 1: Foundation ────────────────────────────────────────────

function StepBasics({
  type, onTypeChange, name, onNameChange, productId, onProductIdChange,
}: {
  type: CampaignType;
  onTypeChange: (t: CampaignType) => void;
  name: string;
  onNameChange: (v: string) => void;
  productId: string;
  onProductIdChange: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-3">
        <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Campaign type
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TypeCard
            active={type === "standard"}
            onClick={() => onTypeChange("standard")}
            icon={<Target className="h-5 w-5" />}
            title="Single post"
            hint="A one-off message. Standard & fast."
          />
          <TypeCard
            active={type === "pipeline"}
            onClick={() => onTypeChange("pipeline")}
            icon={<Zap className="h-5 w-5" />}
            title="Pipeline"
            hint="Research-driven, multi-stage funnel."
          />
        </div>
      </div>

      <FormField label="Campaign name">
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={type === "pipeline" ? "Q2 User Adoption" : "Spring Reactivation"}
          className="h-11 rounded-lg"
        />
      </FormField>

      <ProductPicker value={productId} onChange={onProductIdChange} />
      {type === "standard" && !productId && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Optional for standard campaigns — pick one to unlock brand voice & image framing.
        </p>
      )}
    </>
  );
}

function TypeCard({
  active, onClick, icon, title, hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative rounded-xl border p-4 text-left transition-all overflow-hidden group",
        active
          ? "border-foreground bg-foreground text-background shadow-sm"
          : "border-border/60 hover:border-foreground/40 hover:bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center",
          active ? "bg-background/15 text-background" : "bg-muted text-muted-foreground",
        )}>
          {icon}
        </div>
        {active && (
          <motion.span
            layoutId="type-indicator"
            className="h-1.5 w-1.5 rounded-full bg-background"
          />
        )}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className={cn(
        "text-[11px] mt-0.5 leading-relaxed",
        active ? "text-background/70" : "text-muted-foreground",
      )}>
        {hint}
      </p>
    </button>
  );
}

// ── Step 2: Content ───────────────────────────────────────────────

function StepContent({
  type, channel, onChannelChange, channels, toggleChannel,
  targetAudience, onTargetAudienceChange, cta, onCtaChange,
  mediaMode, onMediaModeChange, mediaUrls, onMediaUrlsChange,
  creativeBrief, onCreativeBriefChange,
}: {
  type: CampaignType;
  channel: string;
  onChannelChange: (v: string) => void;
  channels: string[];
  toggleChannel: (v: string) => void;
  targetAudience: string;
  onTargetAudienceChange: (v: string) => void;
  cta: string;
  onCtaChange: (v: string) => void;
  mediaMode: MediaMode;
  onMediaModeChange: (v: MediaMode) => void;
  mediaUrls: string[];
  onMediaUrlsChange: (urls: string[]) => void;
  creativeBrief: string;
  onCreativeBriefChange: (v: string) => void;
}) {
  return (
    <>
      {type === "standard" ? (
        <FormField label="Channel">
          <Select value={channel} onChange={(e) => onChannelChange(e.target.value)}>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="sms">SMS</option>
          </Select>
        </FormField>
      ) : (
        <div className="space-y-3">
          <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Channels
          </label>
          <div className="grid grid-cols-3 gap-2">
            {socialChannels.map((ch) => {
              const active = channels.includes(ch.value);
              return (
                <label
                  key={ch.value}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-all",
                    active
                      ? "border-foreground bg-foreground/5"
                      : "border-border/60 hover:border-foreground/40",
                  )}
                >
                  <Checkbox checked={active} onCheckedChange={() => toggleChannel(ch.value)} />
                  {ch.label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Visuals
        </label>
        <div className="grid grid-cols-2 gap-2">
          <MediaModeCard
            active={mediaMode === "ai"}
            onClick={() => onMediaModeChange("ai")}
            icon={<Sparkles className="h-4 w-4" />}
            title="AI generated"
            hint={type === "pipeline" ? "One image per post, researched" : "Let AI create images"}
          />
          <MediaModeCard
            active={mediaMode === "own"}
            onClick={() => onMediaModeChange("own")}
            icon={<Images className="h-4 w-4" />}
            title="Your media"
            hint={type === "pipeline" ? "Cycle your uploads through posts" : "Use uploaded photos"}
          />
        </div>

        {mediaMode === "own" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <MediaUploader
                value={mediaUrls}
                onChange={onMediaUrlsChange}
                max={type === "pipeline" ? 30 : 10}
                description={
                  type === "pipeline"
                    ? "Upload a pool — each post cycles through one of these."
                    : "Upload images to attach to this post."
                }
              />
            </div>
          </motion.div>
        )}
      </div>

      {type === "standard" ? (
        <>
          <FormField label="Target audience" description="Who is this for?">
            <Input
              value={targetAudience}
              onChange={(e) => onTargetAudienceChange(e.target.value)}
              placeholder="Dormant trial users"
              className="h-11 rounded-lg"
            />
          </FormField>
          <FormField label="Call to action" description="What should they do?">
            <Input
              value={cta}
              onChange={(e) => onCtaChange(e.target.value)}
              placeholder="Start free trial"
              className="h-11 rounded-lg"
            />
          </FormField>
        </>
      ) : (
        <FormField
          label="Creative brief"
          description="Optional — guides tone, hooks, angles. No invented facts."
        >
          <Textarea
            value={creativeBrief}
            onChange={(e) => onCreativeBriefChange(e.target.value)}
            placeholder="Lead with founder story. Avoid discount messaging. UK English."
            className="min-h-[90px] text-sm rounded-lg resize-y"
            maxLength={4000}
          />
        </FormField>
      )}
    </>
  );
}

function MediaModeCard({
  active, onClick, icon, title, hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
        active ? "border-foreground bg-foreground/5" : "border-border/60 hover:border-foreground/40",
      )}
    >
      <div className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
      )}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
      </div>
    </button>
  );
}

// ── Step 3: Schedule & review ─────────────────────────────────────

function StepSchedule({
  type, scheduledAt, onScheduledAtChange,
  cadence, onCadenceChange, postCount, onPostCountChange,
  startDate, onStartDateChange, postTimeHourUTC, onPostTimeHourUTCChange,
  review,
}: {
  type: CampaignType;
  scheduledAt: string;
  onScheduledAtChange: (v: string) => void;
  cadence: string;
  onCadenceChange: (v: string) => void;
  postCount: number;
  onPostCountChange: (v: number) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  postTimeHourUTC: number;
  onPostTimeHourUTCChange: (v: number) => void;
  review: {
    name: string; type: CampaignType; channels: string[]; channel: string;
    productId: string; mediaMode: MediaMode; mediaUrls: string[]; creativeBrief: string;
  };
}) {
  return (
    <>
      {type === "standard" ? (
        <FormField label="Scheduled for" description="Leave blank to save as draft.">
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
            className="h-11 rounded-lg"
          />
        </FormField>
      ) : (
        <>
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Cadence
            </label>
            <div className="grid grid-cols-2 gap-2">
              {cadenceOptions.map((opt) => {
                const active = cadence === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onCadenceChange(opt.value)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-all",
                      active ? "border-foreground bg-foreground/5" : "border-border/60 hover:border-foreground/40",
                    )}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <FormField
            label={`Posts: ${postCount}`}
            description="Distributed across awareness → retention."
          >
            <Slider
              value={[postCount]}
              onValueChange={([v]) => onPostCountChange(v)}
              min={3}
              max={30}
              step={1}
              className="mt-2"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start date">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="h-11 rounded-lg"
              />
            </FormField>
            <FormField label={`Post time · ${String(postTimeHourUTC).padStart(2, "0")}:00 UTC`}>
              <Slider
                min={0}
                max={23}
                step={1}
                value={[postTimeHourUTC]}
                onValueChange={([v]) => onPostTimeHourUTCChange(v)}
                className="mt-3.5"
              />
            </FormField>
          </div>
        </>
      )}

      <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-2.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Summary
        </p>
        <ReviewRow label="Type" value={review.type === "pipeline" ? "Pipeline" : "Single post"} />
        <ReviewRow label="Name" value={review.name || "—"} />
        <ReviewRow
          label="Channels"
          value={
            review.type === "pipeline"
              ? review.channels.join(", ") || "—"
              : review.channel
          }
        />
        <ReviewRow
          label="Visuals"
          value={
            review.mediaMode === "ai"
              ? "AI generated"
              : `${review.mediaUrls.length} uploaded`
          }
        />
        {review.type === "pipeline" && (
          <ReviewRow
            label="Schedule"
            value={`${postCount} posts · ${cadenceOptions.find((c) => c.value === cadence)?.label} · from ${startDate}`}
          />
        )}
        {review.type === "standard" && scheduledAt && (
          <ReviewRow label="Scheduled" value={new Date(scheduledAt).toLocaleString()} />
        )}
      </div>
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right truncate">{value}</span>
    </div>
  );
}
