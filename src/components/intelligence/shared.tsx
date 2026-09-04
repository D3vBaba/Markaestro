"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Compass, ExternalLink, HelpCircle, Lightbulb, PenLine, Tags, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FeatureGate } from "@/components/app/FeatureGate";
import { apiPost, apiPut } from "@/lib/api-client";
import { invalidateQueries } from "@/hooks/useApiQuery";
import { userFacingError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import type { DecisionStatus, DraftResult, IntelligencePhases, TrustKind } from "./types";

export type HowItWorksTopic =
  | "page"
  | "overview"
  | "audience"
  | "content"
  | "opportunities"
  | "playbook"
  | "experiments"
  | "drafts"
  | "explain"
  | "links"
  | "ask";

/* ────────────────────────── type scale ──────────────────────────
 * Five text sizes for the whole folder. Every tab composes from these so the
 * page reads as one voice: 11px meta, 12px hint, 13px body, 14px card title,
 * 16px section title. Figures are sans tabular numerals, never monospace.
 */
export const TYPE = {
  meta: "text-xs font-medium text-muted-foreground",
  hint: "text-xs leading-4 text-muted-foreground",
  body: "text-[13px] leading-5 text-mk-ink-80",
  strong: "text-[13px] font-semibold text-foreground",
  cardTitle: "text-sm font-semibold leading-5 text-foreground",
  sectionTitle: "text-sm font-semibold text-foreground",
  figure: "mk-figure font-semibold text-foreground",
} as const;

/** The panel surface. Inner items never repeat it; they use rows or insets. */
export const SURFACE = "rounded-xl bg-card border border-border";
/** A quiet tinted block inside a panel (evidence, notes). */
export const INSET = "rounded-lg bg-muted/60";

/* ────────────────────────── trust labels ────────────────────────── */

const TRUST_ORDER: TrustKind[] = ["measured", "calculated", "predicted", "recommended", "declared", "generated"];

const TRUST_STYLES: Record<TrustKind, string> = {
  measured: "bg-mk-pos-soft text-mk-pos",
  calculated: "bg-mk-accent-soft text-mk-accent",
  predicted: "bg-mk-warn-soft text-mk-warn",
  recommended: "bg-mk-accent-soft text-mk-accent",
  declared: "bg-muted text-mk-ink-80",
  generated: "bg-mk-accent-soft text-mk-accent",
};

export function TrustBadge({ kind, className }: { kind: TrustKind; className?: string }) {
  const t = useTranslations("intelligence");
  return (
    <span
      title={t(`labelHints.${kind}`)}
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-4",
        TRUST_STYLES[kind],
        className,
      )}
    >
      {t(`labels.${kind}`)}
    </span>
  );
}

/** Tap-able legend for the six trust labels; hover titles do not exist on touch. */
export function TrustLegendButton({ className }: { className?: string }) {
  const t = useTranslations("intelligence");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(toolbarButton, className)}>
        <Tags className="size-3.5" aria-hidden="true" />
        {t("legend.button")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("legend.title")}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">{t("legend.intro")}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border">
            {TRUST_ORDER.map((kind) => (
              <li key={kind} className="flex items-start gap-3 py-2.5">
                <TrustBadge kind={kind} className="mt-0.5 shrink-0" />
                <p className={TYPE.body}>{t(`labelHints.${kind}`)}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>{t("howItWorks.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ────────────────────────── how it works ────────────────────────── */

const toolbarButton = "inline-flex h-9 sm:h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98]";

export function HowItWorksDialog({
  topic,
  open,
  onOpenChange,
}: {
  topic: HowItWorksTopic;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("intelligence.howItWorks");
  const steps = t.raw(`${topic}.steps`) as string[];
  const inputs = t.raw(`${topic}.inputs`) as string[];
  const never = t.raw(`${topic}.never`) as string[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{t(`${topic}.title`)}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{t(`${topic}.intro`)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-[13px]">
          <section>
            <p className={TYPE.meta}>{t("stepsTitle")}</p>
            <ol className="mt-2 space-y-2">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="leading-relaxed text-mk-ink-80">{step}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className={cn(INSET, "p-3")}>
              <p className={TYPE.meta}>{t("inputsTitle")}</p>
              <ul className="mt-2 space-y-1.5 text-mk-ink-80">
                {inputs.map((item) => (
                  <li key={item} className="flex gap-2"><span className="text-mk-pos">•</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <div className={cn(INSET, "p-3")}>
              <p className={TYPE.meta}>{t("neverTitle")}</p>
              <ul className="mt-2 space-y-1.5 text-mk-ink-80">
                {never.map((item) => (
                  <li key={item} className="flex gap-2"><span className="text-mk-neg">•</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HowItWorksButton({
  topic,
  size = "sm",
  className,
}: {
  topic: HowItWorksTopic;
  size?: "sm" | "xs";
  className?: string;
}) {
  const t = useTranslations("intelligence.howItWorks");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(toolbarButton, "shrink-0 whitespace-nowrap", size === "xs" && "h-7 px-2 text-[11px]", className)}
      >
        <HelpCircle className={size === "sm" ? "size-3.5" : "size-3"} aria-hidden="true" />
        {t("button")}
      </button>
      <HowItWorksDialog topic={topic} open={open} onOpenChange={setOpen} />
    </>
  );
}

/* ────────────────────────── layout ────────────────────────── */

export function Section({
  trust,
  eyebrow,
  title,
  subtitle,
  children,
  action,
  help,
  className,
  as: Heading = "h2",
}: {
  trust?: TrustKind;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  help?: HowItWorksTopic;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <section className={cn("min-w-0 p-5 sm:p-6", SURFACE, className)}>
      {(trust || eyebrow || title || subtitle || action || help) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {(trust || eyebrow) && (
              <div className="flex flex-wrap items-center gap-2">
                {trust && <TrustBadge kind={trust} />}
                {eyebrow && <span className={TYPE.meta}>{eyebrow}</span>}
              </div>
            )}
            {title && (
              <Heading className={cn(trust || eyebrow ? "mt-1.5" : "", Heading === "h2" ? TYPE.sectionTitle : TYPE.cardTitle)}>{title}</Heading>
            )}
            {subtitle && <p className={cn("mt-1 max-w-2xl", TYPE.hint)}>{subtitle}</p>}
          </div>
          {(action || help) && (
            <div className="flex shrink-0 items-center gap-2">
              {action}
              {help && <HowItWorksButton topic={help} size="xs" />}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** A big number with a label, used in the Overview strip and briefing. */
export function Figure({ label, value, sub, size = "md" }: { label: string; value: string; sub?: string; size?: "md" | "lg" }) {
  return (
    <div className="min-w-0">
      <p className={TYPE.meta}>{label}</p>
      <p className={cn(TYPE.figure, "mt-1", size === "lg" ? "text-2xl sm:text-3xl" : "text-xl")}>{value}</p>
      {sub && <p className={cn("mt-0.5 truncate", TYPE.hint)} title={sub}>{sub}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  next,
  icon: Icon,
  action,
}: {
  title: string;
  body: string;
  /** The one concrete thing that unlocks this surface. */
  next?: string;
  icon?: typeof Compass;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
      {Icon && (
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-muted text-mk-ink-60">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      )}
      <h2 className={cn("mt-4", TYPE.sectionTitle)}>{title}</h2>
      <p className={cn("mx-auto mt-1 max-w-md", TYPE.body)}>{body}</p>
      {next && (
        <p className={cn("mx-auto mt-3 inline-block px-3 py-1.5", INSET, TYPE.strong)}>{next}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export { Compass as CompassIcon, Lightbulb as LightbulbIcon };

/**
 * Separates "your plan does not include this" (upgrade prompt) from "included
 * but not rolled out to this workspace yet" (calm notice), so nobody waits for
 * data that will never come.
 */
export function PhaseGate({
  enabled,
  feature,
  children,
}: {
  enabled: boolean;
  feature: "intelligenceOptimization" | "intelligenceExperiments" | "intelligenceStrategist" | "audienceFit";
  children: ReactNode;
}) {
  const t = useTranslations("intelligence.gate");
  if (enabled) return <>{children}</>;
  return (
    <FeatureGate feature={feature}>
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <h3 className={TYPE.cardTitle}>{t("rolloutTitle")}</h3>
        <p className={cn("mx-auto mt-1 max-w-md", TYPE.hint)}>{t("rolloutBody")}</p>
      </div>
    </FeatureGate>
  );
}

export function phasesOf(data: { phases?: IntelligencePhases }): IntelligencePhases {
  return data.phases || { foundation: true, learning: false, growth: false, advanced: false };
}

export function KindBadge({ children, tone = "blue", title }: { children: ReactNode; tone?: "blue" | "slate" | "emerald" | "amber" | "rose"; title?: string }) {
  const tones = {
    blue: "bg-mk-accent-soft text-mk-accent  ",
    slate: "bg-muted text-mk-ink-80  ",
    emerald: "bg-mk-pos-soft text-mk-pos  ",
    amber: "bg-mk-warn-soft text-mk-warn  ",
    rose: "bg-mk-neg-soft text-mk-neg  ",
  };
  return (
    <span title={title} className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

/* ────────────────────────── status filter ────────────────────────── */

export type StatusFilter = "all" | DecisionStatus;

export function countByStatus(items: Array<{ status?: string }>): Record<StatusFilter, number> {
  const base: Record<StatusFilter, number> = { all: 0, proposed: 0, accepted: 0, pinned: 0, dismissed: 0 };
  for (const item of items) {
    const status = (item.status || "proposed") as DecisionStatus;
    base[status] += 1;
    if (status !== "dismissed") base.all += 1;
  }
  return base;
}

export function filterByStatus<T extends { status?: string }>(items: T[], filter: StatusFilter): T[] {
  return items.filter((item) => {
    const status = item.status || "proposed";
    return filter === "all" ? status !== "dismissed" : status === filter;
  });
}

export function StatusFilterBar({
  value,
  onChange,
  counts,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
}) {
  const t = useTranslations("intelligence.filter");
  const options: StatusFilter[] = ["all", "proposed", "accepted", "pinned", "dismissed"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn("me-1", TYPE.meta)}>{t("label")}</span>
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-mk-accent-soft text-mk-accent"
                : "text-mk-ink-80 hover:bg-muted hover:text-foreground",
            )}
          >
            {t(option)}
            <span className={cn("tabular-nums", active ? "text-muted-foreground" : "text-mk-ink-40")}>{counts[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────── decisions ────────────────────────── */

export function DecisionButtons({
  path,
  productId,
  status: initialStatus,
  kind = "opportunity",
  onChanged,
}: {
  path: string;
  productId: string;
  status?: string;
  kind?: "opportunity" | "learning";
  onChanged?: (status: DecisionStatus) => void;
}) {
  const t = useTranslations("intelligence.actions");
  const d = useTranslations("intelligence.decisions");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<DecisionStatus>((initialStatus as DecisionStatus) || "proposed");
  // Re-seed when the server value changes (refresh, undo elsewhere) without an
  // effect: adjusting during render keeps it to one pass.
  const [seededFrom, setSeededFrom] = useState(initialStatus);
  if (initialStatus !== seededFrom) {
    setSeededFrom(initialStatus);
    setStatus((initialStatus as DecisionStatus) || "proposed");
  }

  const decided = status === "accepted" || status === "dismissed" || status === "pinned";

  async function decide(decision: DecisionStatus) {
    setBusy(decision);
    const response = await apiPut(`${path}?productId=${encodeURIComponent(productId)}`, { decision });
    if (!response.ok) {
      toast.error(userFacingError(response.data, t("saveFailed")));
      setBusy(null);
      return;
    }
    setStatus(decision);
    onChanged?.(decision);
    toast.success(
      decision === "accepted"
        ? t("acceptedToast")
        : decision === "pinned"
          ? t("pinnedToast")
          : decision === "dismissed"
            ? t("dismissedToast")
            : t("undoneToast"),
    );
    invalidateQueries("/api/intelligence/overview");
    setBusy(null);
  }

  if (decided) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge tone={status === "accepted" ? "emerald" : status === "pinned" ? "blue" : "slate"}>{t(`status.${status}`)}</KindBadge>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("proposed")}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Undo2 className="size-3" aria-hidden="true" />
          {t("undo")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" title={kind === "learning" ? d("learningHint") : d("hint")}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() => void decide("accepted")}
      >
        {d("accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() => void decide("pinned")}
      >
        {d("pin")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:bg-mk-neg-soft hover:text-mk-neg"
        disabled={busy !== null}
        onClick={() => void decide("dismissed")}
      >
        {d("dismiss")}
      </Button>
    </div>
  );
}

/* ────────────────────────── draft this ────────────────────────── */

export function DraftButton({
  productId,
  source,
  platform,
  label,
  variant = "primary",
}: {
  productId: string;
  source: { type: "opportunity" | "learning" | "post"; id: string };
  platform?: string;
  label?: string;
  variant?: "primary" | "outline";
}) {
  const t = useTranslations("intelligence.drafts");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);

  async function create() {
    setBusy(true);
    try {
      const response = await apiPost<DraftResult>("/api/intelligence/drafts", {
        productId,
        source,
        ...(platform ? { platform } : {}),
        locale,
      }, undefined, { timeoutMs: 90_000 });
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("failed"), {
          QUOTA_EXCEEDED: t("quota"),
          QUOTA_EXCEEDED_POSTS: t("postQuota"),
        }));
        return;
      }
      setResult(response.data);
      invalidateQueries("/api/posts");
      invalidateQueries("/api/intelligence/overview");
      toast.success(t("created"), { description: response.data.rationale });
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-mk-accent-soft p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <TrustBadge kind="generated" />
          <span className="font-semibold text-foreground">{t("created")}</span>
          <Link
            href="/content"
            className="inline-flex items-center gap-1 font-semibold text-mk-accent hover:underline"
          >
            {t("open")}
            <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-mk-ink-80">{result.content}</p>
        <p className="text-[11px] text-muted-foreground"><span className="font-semibold">{t("rationale")}:</span> {result.rationale}</p>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant === "primary" ? "default" : "outline"}
      className={cn(variant === "outline" && "border-mk-accent/30 text-mk-accent hover:bg-mk-accent-soft hover:text-mk-accent")}
      disabled={busy}
      onClick={() => void create()}
    >
      <PenLine className="size-3.5" aria-hidden="true" />
      {busy ? t("creating") : label || t("button")}
    </Button>
  );
}
