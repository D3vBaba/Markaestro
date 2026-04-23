"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Globe, Loader2, ArrowRight, Check, Wand2, Pencil } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import FormField from "@/components/app/FormField";
import TagInput from "@/components/app/TagInput";
import ScanProgressStepper from "@/components/app/ScanProgressStepper";
import { useProductScan } from "@/hooks/useProductScan";
import { apiPost, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const categoryLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile",
  web: "Web",
  api: "API",
  marketplace: "Marketplace",
  other: "Other",
};

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
  const [mode, setMode] = useState<Mode>("start");
  const [scanUrl, setScanUrl] = useState("");
  const { phase: scanPhase, scanning, scanned, scan: runScan, reset: resetScan } = useProductScan();

  // form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [categories, setCategories] = useState<string[]>(["saas"]);
  const [pricing, setPricing] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [tone, setTone] = useState("");

  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMode("start");
    setScanUrl("");
    resetScan();
    setName("");
    setDescription("");
    setUrl("");
    setCategories(["saas"]);
    setPricing([]);
    setTags([]);
    setPrimaryColor("");
    setSecondaryColor("");
    setAccentColor("");
    setLogoUrl("");
    setTargetAudience("");
    setTone("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleScan = async () => {
    const raw = scanUrl.trim();
    if (!raw) {
      toast.error("Enter a URL first");
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
      setPricing(
        d.pricingTier
          ? d.pricingTier.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      );
      setTags(d.tags || []);
      setPrimaryColor(d.primaryColor || "");
      setSecondaryColor(d.secondaryColor || "");
      setAccentColor(d.accentColor || "");
      setLogoUrl(d.logoUrl || "");
      setTargetAudience(d.targetAudience || "");
      setTone(d.tone || "");
      setMode("review");
    }
  };

  const startManual = () => {
    setMode("manual");
  };

  const create = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ id: string }>("/api/products", {
        name,
        description,
        url: url || "",
        categories,
        pricingTier: pricing.join(", "),
        tags,
      });
      if (!res.ok) {
        const err = res.data as { error?: string; issues?: { message: string }[] };
        toast.error(err.issues?.[0]?.message || err.error || "Failed to create product");
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
      toast.success("Product added");
      reset();
      onOpenChange(false);
      onCreated(created.id);
    } catch {
      toast.error("Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const dominant = useMemo(() => {
    return primaryColor && /^#[0-9A-Fa-f]{6}$/i.test(primaryColor) ? primaryColor : null;
  }, [primaryColor]);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="max-w-xl! w-full p-0 flex flex-col overflow-hidden">
        {dominant && mode !== "start" && (
          <div
            aria-hidden
            className="absolute top-0 left-0 right-0 h-1 z-10"
            style={{
              background: `linear-gradient(90deg, ${dominant}, ${dominant}aa 40%, transparent 100%)`,
            }}
          />
        )}

        <SheetHeader
          className="px-6 pt-6 pb-4 border-b"
          style={{ borderColor: "var(--mk-rule)" }}
        >
          <p className="mk-eyebrow">New product</p>
          <SheetTitle
            className="text-[22px] font-semibold m-0"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
          >
            Add product
          </SheetTitle>
          <SheetDescription
            className="text-[13px]"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            {mode === "start" && "Start by scanning your website, or enter details manually."}
            {mode === "scan" && "Researching your product…"}
            {mode === "manual" && "Fill out the essentials — you can add more later."}
            {mode === "review" && "Review what we found, tweak anything, then save."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
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
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "var(--mk-panel)" }}
                    >
                      <Wand2
                        className="h-4.5 w-4.5"
                        style={{ color: "var(--mk-ink-80)" }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[14px] font-semibold"
                        style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
                      >
                        Scan your website
                      </p>
                      <p
                        className="text-[12.5px] mt-0.5"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        We&apos;ll extract your name, description, brand colours, logo and tone so you can start with 90% done.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="https://yourproduct.com"
                        value={scanUrl}
                        onChange={(e) => setScanUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && scanUrl.trim()) handleScan();
                        }}
                        autoFocus
                      />
                    </div>
                    <Button onClick={handleScan} disabled={!scanUrl.trim() || scanning}>
                      {scanning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">Scan</span>
                    </Button>
                  </div>
                </div>

                <div className="relative py-1 flex items-center gap-3">
                  <span
                    className="flex-1 h-px"
                    style={{ background: "var(--mk-rule)" }}
                  />
                  <span className="mk-eyebrow">Or</span>
                  <span
                    className="flex-1 h-px"
                    style={{ background: "var(--mk-rule)" }}
                  />
                </div>

                <button
                  onClick={startManual}
                  className="w-full group rounded-xl transition-colors p-5 text-left"
                  style={{
                    background: "var(--mk-paper)",
                    border: "1px solid var(--mk-rule)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: "var(--mk-panel)",
                        border: "1px solid var(--mk-rule-soft)",
                      }}
                    >
                      <Pencil
                        className="h-4 w-4"
                        style={{ color: "var(--mk-ink-60)" }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p
                          className="text-[14px] font-semibold"
                          style={{ color: "var(--mk-ink)", letterSpacing: "-0.01em" }}
                        >
                          Enter manually
                        </p>
                        <ArrowRight
                          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                          style={{ color: "var(--mk-ink-40)" }}
                        />
                      </div>
                      <p
                        className="text-[12.5px] mt-0.5"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        Skip the scan and fill the form yourself.
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
                {scanPhase === "error" && (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setMode("start")}>
                      Try again
                    </Button>
                    <Button onClick={() => setMode("manual")}>Enter manually</Button>
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
                      className="h-5 w-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--mk-pos)" }}
                    >
                      <Check className="h-3 w-3 text-white" />
                    </div>
                    <p
                      className="text-[12px]"
                      style={{ color: "color-mix(in oklch, var(--mk-pos) 70%, var(--mk-ink))" }}
                    >
                      Scan complete — review and edit anything below.
                    </p>
                  </div>
                )}

                <FormField label="Product name">
                  <Input
                    placeholder="DripCheckr"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus={mode === "manual"}
                  />
                </FormField>
                <FormField label="Description">
                  <Textarea
                    rows={3}
                    placeholder="What does your product do?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </FormField>
                <FormField label="Website">
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="https://yourproduct.com"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </div>
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Category">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(categoryLabels).map(([val, label]) => {
                        const active = categories.includes(val);
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() =>
                              setCategories((prev) =>
                                active
                                  ? prev.length > 1
                                    ? prev.filter((c) => c !== val)
                                    : prev
                                  : [...prev, val],
                              )
                            }
                            className={cn(
                              "px-2 py-1 rounded-md border text-[11px] transition-all",
                              active
                                ? "border-foreground bg-foreground text-background font-medium"
                                : "border-border/60 text-muted-foreground hover:border-foreground/30",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </FormField>
                  <FormField label="Pricing">
                    <TagInput
                      tags={pricing}
                      onChange={setPricing}
                      placeholder="Free, Pro $29/mo…"
                    />
                  </FormField>
                </div>

                <FormField label="Tags">
                  <TagInput tags={tags} onChange={setTags} placeholder="analytics, ai, b2b…" />
                </FormField>

                {(primaryColor || secondaryColor || accentColor || logoUrl || targetAudience || tone) && (
                  <div
                    className="rounded-xl p-4 space-y-3"
                    style={{
                      background: "var(--mk-surface)",
                      border: "1px solid var(--mk-rule)",
                    }}
                  >
                    <p className="mk-eyebrow">Brand intelligence</p>
                    {logoUrl && (
                      <div className="flex items-center gap-3">
                        <img
                          src={logoUrl}
                          alt="Logo"
                          className="h-12 w-12 rounded-lg object-contain border border-border/40 bg-white"
                        />
                        <p className="text-xs text-muted-foreground">Logo detected from site</p>
                      </div>
                    )}
                    {(primaryColor || secondaryColor || accentColor) && (
                      <div className="flex items-center gap-2">
                        {[primaryColor, secondaryColor, accentColor]
                          .filter((c) => c && /^#[0-9A-Fa-f]{6}$/i.test(c))
                          .map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div
                                className="h-6 w-6 rounded-md border border-border/40"
                                style={{ backgroundColor: c }}
                              />
                              <span className="text-[11px] font-mono text-muted-foreground">{c}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {targetAudience && (
                      <FormField label="Target audience">
                        <Input
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                        />
                      </FormField>
                    )}
                    {tone && (
                      <FormField label="Brand tone">
                        <Input value={tone} onChange={(e) => setTone(e.target.value)} />
                      </FormField>
                    )}
                    <p className="text-[10px] text-muted-foreground/70">
                      You can fine-tune all of this after creating the product.
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {(mode === "review" || mode === "manual") && (
          <div
            className="px-6 py-3 border-t flex items-center justify-between gap-2"
            style={{
              borderColor: "var(--mk-rule)",
              background: "var(--mk-surface)",
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("start")}
              className="h-9 text-[13px]"
              style={{ color: "var(--mk-ink-60)" }}
            >
              Start over
            </Button>
            <Button
              onClick={create}
              disabled={saving || !name.trim()}
              className="rounded-lg h-9 text-[13px]"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {saving ? "Creating…" : "Create product"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
