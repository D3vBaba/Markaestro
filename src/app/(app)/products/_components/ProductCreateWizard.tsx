"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Loader2, ArrowRight, Check, Pencil } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import FormField from "@/components/app/FormField";
import CategorySelect from "./CategorySelect";
import ScanProgressStepper from "@/components/app/ScanProgressStepper";
import { useProductScan } from "@/hooks/useProductScan";
import { apiPost, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import { userFacingError } from "@/lib/user-facing-errors";
import AudienceProfileFields, { browserTimezone } from "@/components/intelligence/AudienceProfileFields";
import {
  defaultAudienceProfile,
  type AudienceIntelligenceProfile,
} from "@/lib/intelligence/schemas";
import { useIntelligencePreviewAccess } from "@/hooks/useIntelligencePreviewAccess";

type Mode = "start" | "scan" | "manual" | "review";

export default function ProductCreateWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (productId: string) => void;
}) {
  const t = useTranslations("products.createWizard");
  const canAccessIntelligence = useIntelligencePreviewAccess();
  const [mode, setMode] = useState<Mode>("start");
  const [scanUrl, setScanUrl] = useState("");
  const {
    phase: scanPhase,
    scanning,
    scanned,
    scan: runScan,
    cancel: cancelScan,
    reset: resetScan,
  } = useProductScan();

  // form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [categories, setCategories] = useState<string[]>(["saas"]);
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [tone, setTone] = useState("");
  const [previewImage, setPreviewImage] = useState("");
  const [audienceProfile, setAudienceProfile] = useState<AudienceIntelligenceProfile>(() => defaultAudienceProfile({
    primaryTimezone: browserTimezone(),
  }));

  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMode("start");
    setScanUrl("");
    resetScan();
    setName("");
    setDescription("");
    setUrl("");
    setCategories(["saas"]);
    setPrimaryColor("");
    setSecondaryColor("");
    setAccentColor("");
    setLogoUrl("");
    setTargetAudience("");
    setTone("");
    setPreviewImage("");
    setAudienceProfile(defaultAudienceProfile({ primaryTimezone: browserTimezone() }));
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleScan = async () => {
    const raw = scanUrl.trim();
    if (!raw) {
      toast.error(t("toasts.enterUrl"));
      return;
    }
    const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setMode("scan");
    const d = await runScan(full);
    if (d) {
      setName(d.name || "");
      setDescription(d.description || "");
      setUrl(full);
      setCategories(d.category ? [d.category] : ["saas"]);
      setPrimaryColor(d.primaryColor || "");
      setSecondaryColor(d.secondaryColor || "");
      setAccentColor(d.accentColor || "");
      setLogoUrl(d.logoUrl || "");
      setTargetAudience(d.targetAudience || "");
      setTone(d.tone || "");
      setPreviewImage(d.previewImage || "");
      setMode("review");
    }
  };

  const startManual = () => {
    setMode("manual");
  };

  const create = async () => {
    if (!name.trim()) {
      toast.error(t("toasts.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ id: string }>("/api/products", {
        name,
        description,
        url: url || "",
        categories,
      });
      if (!res.ok) {
        toast.error(userFacingError(res.data, t("toasts.createFailed")));
        return;
      }
      const created = res.data;
      // Persist brand voice + identity if we have anything worth saving
      const hasIdentity = logoUrl || primaryColor || secondaryColor || accentColor;
      const hasVoice = targetAudience || tone;
      if (hasIdentity || hasVoice) {
        apiPut(`/api/products/${created.id}/brand-voice`, {
          tone,
          style: "",
          keywords: [],
          avoidWords: [],
          cta: "",
          sampleVoice: "",
          targetAudience,
          brandIdentity: {
            logoUrl,
            primaryColor,
            secondaryColor,
            accentColor,
          },
        }).catch(() => {});
      }
      if (canAccessIntelligence) {
        apiPut(`/api/products/${created.id}/intelligence-profile`, audienceProfile).catch(() => {});
      }
      toast.success(t("toasts.brandAdded"));
      reset();
      onOpenChange(false);
      onCreated(created.id);
    } catch {
      toast.error(t("toasts.createFailed"));
    } finally {
      setSaving(false);
    }
  };


  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-4 pb-4 pt-5 sm:px-6">
          <SheetTitle
            className="m-0 text-lg font-semibold tracking-tight text-foreground"
          >
            {t("title")}
          </SheetTitle>
          <SheetDescription
            className="text-[13px] text-muted-foreground"
          >
            {mode === "start" && t("descriptions.start")}
            {mode === "scan" && t("descriptions.scan")}
            {mode === "manual" && t("descriptions.manual")}
            {mode === "review" && t("descriptions.review")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          <AnimatePresence mode="wait">
            {mode === "start" && (
              <motion.div
                key="start"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div
                  className="rounded-xl p-5 space-y-4"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[14px] font-semibold text-foreground"
                      >
                        {t("scanCard.title")}
                      </p>
                      <p
                        className="text-[12.5px] mt-0.5 text-muted-foreground"
                      >
                        {t("scanCard.body")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        className="ps-9"
                        placeholder={t("scanCard.urlPlaceholder")}
                        value={scanUrl}
                        onChange={(e) => setScanUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && scanUrl.trim()) handleScan();
                        }}
                        autoFocus
                      />
                    </div>
                    <Button onClick={handleScan} disabled={!scanUrl.trim() || scanning} className="h-10 sm:h-9">
                      {scanning && <Loader2 className="size-4 animate-spin me-1.5" />}
                      <span>{t("scanCard.scan")}</span>
                    </Button>
                  </div>
                </div>

                <div className="relative py-1 flex items-center gap-3">
                  <span
                    className="flex-1 h-px bg-border"
                  />
                  <span className="mk-eyebrow">{t("or")}</span>
                  <span
                    className="flex-1 h-px bg-border"
                  />
                </div>

                <button
                  onClick={startManual}
                  className="w-full group rounded-xl transition-colors p-5 text-start"
                  style={{
                    background: "var(--mk-paper)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="size-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: "var(--mk-panel)",
                        border: "1px solid var(--mk-rule-soft)",
                      }}
                    >
                      <Pencil
                        className="size-4 text-muted-foreground"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p
                          className="text-[14px] font-semibold text-foreground"
                        >
                          {t("manualCard.title")}
                        </p>
                        <ArrowRight
                          className="size-3.5 transition-transform group-hover:translate-x-0.5 text-mk-ink-40"
                        />
                      </div>
                      <p
                        className="text-[12.5px] mt-0.5 text-muted-foreground"
                      >
                        {t("manualCard.body")}
                      </p>
                    </div>
                  </div>
                </button>
              </motion.div>
            )}

            {mode === "scan" && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <ScanProgressStepper phase={scanPhase} url={scanUrl} />
                {scanning && (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        cancelScan();
                        setMode("start");
                      }}
                      className="h-10 sm:h-9 text-muted-foreground"
                    >
                      {t("cancelScan")}
                    </Button>
                  </div>
                )}
                {scanPhase === "error" && (
                  <div className="space-y-3">
                    <p
                      className="text-[12.5px] text-muted-foreground"
                    >
                      {t("scanError.body", { url: scanUrl })}
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setMode("start")}
                        className="h-10 sm:h-9 text-muted-foreground"
                      >
                        {t("scanError.editUrl")}
                      </Button>
                      <Button variant="outline" onClick={handleScan} className="h-10 sm:h-9">
                        {t("scanError.retry")}
                      </Button>
                      <Button onClick={() => setMode("manual")} className="h-10 sm:h-9">{t("scanError.enterManually")}</Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {(mode === "review" || mode === "manual") && (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {mode === "review" && scanned && (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{
                      background: "color-mix(in oklch, var(--mk-pos) 12%, var(--mk-paper))",
                      border: "1px solid color-mix(in oklch, var(--mk-pos) 22%, var(--mk-rule))",
                    }}
                  >
                    <div
                      className="size-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--mk-pos)" }}
                    >
                      <Check className="size-3 text-white" />
                    </div>
                    <p
                      className="text-[12px]"
                      style={{ color: "color-mix(in oklch, var(--mk-pos) 70%, var(--mk-ink))" }}
                    >
                      {t("scanComplete")}
                    </p>
                  </div>
                )}

                <FormField label={t("fields.brandName")}>
                  <Input
                    placeholder={t("fields.brandNamePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus={mode === "manual"}
                  />
                </FormField>
                <FormField label={t("fields.description")}>
                  <Textarea
                    rows={3}
                    placeholder={t("fields.descriptionPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </FormField>
                <FormField label={t("fields.website")}>
                  <div className="relative">
                    <Globe className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      className="ps-9"
                      placeholder={t("fields.websitePlaceholder")}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </div>
                </FormField>

                <FormField label={t("fields.category")}>
                  <CategorySelect
                    value={categories[0] || ""}
                    onChange={(v) => setCategories([v])}
                  />
                </FormField>

                {(primaryColor || secondaryColor || accentColor || logoUrl || targetAudience || tone || previewImage) && (
                  <div
                    className="rounded-xl p-4 space-y-3"
                    style={{
                      background: "var(--mk-surface)",
                      border: "1px solid var(--mk-rule)",
                    }}
                  >
                    <p className="mk-eyebrow">{t("brandIntelligence")}</p>
                    {previewImage && (
                      <img
                        src={previewImage}
                        alt={t("sitePreview")}
                        className="w-full rounded-lg border border-border object-cover"
                        style={{ aspectRatio: "16 / 10" }}
                      />
                    )}
                    {logoUrl && (
                      <div className="flex items-center gap-3">
                        <img
                          src={logoUrl}
                          alt="Logo"
                          className="size-12 rounded-lg object-contain border border-border bg-card"
                        />
                        <p className="text-xs text-muted-foreground">{t("logoDetected")}</p>
                      </div>
                    )}
                    {(primaryColor || secondaryColor || accentColor) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {[primaryColor, secondaryColor, accentColor]
                          .filter((c) => c && /^#[0-9A-Fa-f]{6}$/i.test(c))
                          .map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div
                                className="size-6 rounded-md border border-border"
                                style={{ backgroundColor: c }}
                              />
                              <span className="text-[11px] font-mono text-muted-foreground">{c}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {targetAudience && (
                      <FormField label={t("targetAudience")}>
                        <Input
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                        />
                      </FormField>
                    )}
                    {tone && (
                      <FormField label={t("brandTone")}>
                        <Input value={tone} onChange={(e) => setTone(e.target.value)} />
                      </FormField>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("fineTuneNote")}
                    </p>
                  </div>
                )}

                {canAccessIntelligence && (
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{
                    background: "var(--mk-surface)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <p className="mk-eyebrow">{t("audienceSetup")}</p>
                  <p className="text-[12px] text-muted-foreground">{t("audienceSetupBody")}</p>
                  <AudienceProfileFields
                    value={audienceProfile}
                    onChange={setAudienceProfile}
                    variant="setup"
                  />
                </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {(mode === "review" || mode === "manual") && (
          <div
            className="px-4 sm:px-6 py-3 border-t flex flex-wrap items-center justify-between gap-2 border-border bg-background"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("start")}
              className="h-10 sm:h-9 text-muted-foreground"
            >
              {t("startOver")}
            </Button>
            <Button
              onClick={create}
              disabled={saving || !name.trim()}
              className="h-10 sm:h-9"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin me-1.5" /> : null}
              {saving ? t("creating") : t("createBrand")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
