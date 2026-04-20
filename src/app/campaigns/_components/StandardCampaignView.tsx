"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Target, Save, Calendar as CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import ProductPicker from "@/app/content/_components/ProductPicker";
import MediaUploader from "./MediaUploader";
import ConfirmDeleteDialog from "@/components/app/ConfirmDeleteDialog";
import { apiPut, apiDelete } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type StandardCampaign = {
  id: string;
  name: string;
  channel?: string;
  status: string;
  type?: string;
  productId?: string;
  targetAudience?: string;
  cta?: string;
  body?: string;
  subject?: string;
  scheduledAt?: string | null;
  mediaUrls?: string[];
  createdAt?: string;
  updatedAt?: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-50 text-rose-700",
};

function toLocalDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Form = {
  name: string;
  channel: string;
  status: string;
  productId: string;
  targetAudience: string;
  cta: string;
  body: string;
  subject: string;
  scheduledAt: string;
  mediaUrls: string[];
};

function toForm(c: StandardCampaign): Form {
  return {
    name: c.name || "",
    channel: c.channel || "facebook",
    status: c.status || "draft",
    productId: c.productId || "",
    targetAudience: c.targetAudience || "",
    cta: c.cta || "",
    body: c.body || "",
    subject: c.subject || "",
    scheduledAt: toLocalDateTime(c.scheduledAt),
    mediaUrls: c.mediaUrls || [],
  };
}

function hasChanges(a: Form, b: Form) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export default function StandardCampaignView({ campaign }: { campaign: StandardCampaign }) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<Form>(() => toForm(campaign));
  const [form, setForm] = useState<Form>(() => toForm(campaign));
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(campaign.updatedAt || null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const next = toForm(campaign);
    setBaseline(next);
    setForm(next);
    setLastSavedAt(campaign.updatedAt || null);
  }, [campaign]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const dirty = hasChanges(form, baseline);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        channel: form.channel,
        status: form.status,
        productId: form.productId || "",
        targetAudience: form.targetAudience,
        cta: form.cta,
        body: form.body,
        subject: form.subject,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        mediaUrls: form.mediaUrls,
      };
      const res = await apiPut<StandardCampaign>(`/api/campaigns/${campaign.id}`, body);
      if (res.ok) {
        toast.success("Saved");
        setBaseline({ ...form });
        setLastSavedAt(new Date().toISOString());
      } else {
        const errData = res.data as { error?: string; issues?: { message: string }[] };
        toast.error(errData.issues?.[0]?.message || errData.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [campaign.id, form]);

  const handleReset = () => setForm(baseline);

  const handleDelete = async () => {
    const res = await apiDelete(`/api/campaigns/${campaign.id}`);
    if (res.ok) {
      toast.success("Deleted");
      router.push("/campaigns");
    } else {
      const err = res.data as { error?: string };
      toast.error(err.error || "Failed to delete");
    }
  };

  return (
    <>
      <div className="mb-8">
        <button
          onClick={() => router.push("/campaigns")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to campaigns
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-2xl bg-foreground text-background flex items-center justify-center shrink-0">
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Single-post campaign
                </p>
                <Badge variant="outline" className={cn("border-0 text-[10px] capitalize", statusColors[form.status] || "")}>
                  {form.status}
                </Badge>
              </div>
              <h1 className="text-2xl font-normal tracking-tight font-[family-name:var(--font-display)] truncate">
                {form.name || "Untitled campaign"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {dirty
                ? "Unsaved changes"
                : lastSavedAt
                  ? `Saved · ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "All changes saved"}
            </span>
            {dirty && (
              <Button variant="ghost" onClick={handleReset} className="rounded-xl text-muted-foreground">
                Discard
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving || !dirty} className="rounded-xl gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: editable form */}
        <div className="lg:col-span-3 space-y-6">
          <Section title="Foundation" hint="The what and the who">
            <FormField label="Campaign name">
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="h-11 rounded-lg"
              />
            </FormField>

            <ProductPicker value={form.productId} onChange={(v) => set("productId", v)} />

            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Channel">
                <Select value={form.channel} onChange={(e) => set("channel", e.target.value)}>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="sms">SMS</option>
                </Select>
              </FormField>
              <FormField label="Status">
                <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </FormField>
            </div>
          </Section>

          <Section title="Creative" hint="Voice, CTA, copy">
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Target audience">
                <Input
                  value={form.targetAudience}
                  onChange={(e) => set("targetAudience", e.target.value)}
                  placeholder="Dormant trial users"
                  className="h-11 rounded-lg"
                />
              </FormField>
              <FormField label="Call to action">
                <Input
                  value={form.cta}
                  onChange={(e) => set("cta", e.target.value)}
                  placeholder="Start free trial"
                  className="h-11 rounded-lg"
                />
              </FormField>
            </div>

            {form.channel === "sms" || form.channel === "email" ? (
              <FormField label="Subject">
                <Input
                  value={form.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  className="h-11 rounded-lg"
                />
              </FormField>
            ) : null}

            <FormField label="Post copy" description="Optional — final post text, if you're writing it by hand.">
              <Textarea
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
                className="min-h-[140px] text-sm rounded-lg resize-y"
                placeholder="Write your post copy, or generate one from the Content page."
              />
            </FormField>
          </Section>

          <Section title="Media" hint="Photos to attach">
            <MediaUploader
              value={form.mediaUrls}
              onChange={(v) => set("mediaUrls", v)}
              max={10}
              description="PNG, JPG, or WebP · up to 5 MB each · max 10"
            />
          </Section>

          <Section title="Schedule" hint="When it goes live">
            <FormField label="Scheduled at" description="Leave blank to keep as draft.">
              <Input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => set("scheduledAt", e.target.value)}
                className="h-11 rounded-lg"
              />
            </FormField>
          </Section>

          <div className="flex items-center justify-between pt-4 border-t border-border/40">
            <Button variant="ghost" onClick={() => setDeleteOpen(true)} className="text-destructive hover:text-destructive rounded-xl">
              Delete campaign
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty} className="rounded-xl gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
          </div>
        </div>

        {/* Right: preview */}
        <div className="lg:col-span-2">
          <motion.div
            layout
            className="sticky top-6 rounded-2xl border border-border/40 bg-card overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between bg-muted/20">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Preview</p>
              <span className="text-[10px] capitalize text-muted-foreground">{form.channel}</span>
            </div>
            <div className="p-5 space-y-4">
              {form.mediaUrls.length > 0 ? (
                <div className={cn(
                  "grid gap-1 rounded-xl overflow-hidden",
                  form.mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2",
                )}>
                  {form.mediaUrls.slice(0, 4).map((url) => (
                    <img key={url} src={url} alt="" className="w-full aspect-square object-cover" />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/50 aspect-[4/3] flex items-center justify-center bg-muted/10">
                  <p className="text-xs text-muted-foreground">No media yet</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {form.body || (
                    <span className="text-muted-foreground italic">Post copy appears here…</span>
                  )}
                </p>
                {form.cta && (
                  <div className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground rounded-full bg-muted px-2.5 py-1">
                    {form.cta}
                  </div>
                )}
              </div>

              {form.scheduledAt && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-2 border-t border-border/30">
                  <CalendarIcon className="h-3 w-3" />
                  Scheduled {new Date(form.scheduledAt).toLocaleString()}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entity="campaign"
        name={campaign.name}
        onConfirm={handleDelete}
      />
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/40 bg-card">
      <header className="px-5 py-4 border-b border-border/40 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{hint}</p>}
      </header>
      <div className="p-5 space-y-5">{children}</div>
    </section>
  );
}
