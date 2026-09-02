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
import { channelColor, channelLabel } from "@/components/mk/channels";
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
  meta: "text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500",
  hint: "text-xs leading-relaxed text-slate-500 dark:text-slate-400",
  body: "text-[13px] leading-relaxed text-slate-600 dark:text-slate-300",
  strong: "text-[13px] font-semibold text-slate-900 dark:text-slate-100",
  cardTitle: "text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100",
  sectionTitle: "text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100",
  figure: "tabular-nums font-semibold tracking-tight text-slate-900 dark:text-slate-100",
} as const;

/** The panel surface. Inner items never repeat it; they use rows or insets. */
export const SURFACE = "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs";
/** A quiet tinted block inside a panel (evidence, notes). */
export const INSET = "rounded-xl bg-slate-50/80 dark:bg-slate-800/40";

/* ────────────────────────── trust labels ────────────────────────── */

const TRUST_ORDER: TrustKind[] = ["measured", "calculated", "predicted", "recommended", "declared", "generated"];

const TRUST_STYLES: Record<TrustKind, string> = {
  measured: "bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
  calculated: "bg-sky-50 text-sky-700 border-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/60",
  predicted: "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60",
  recommended: "bg-blue-50 text-blue-700 border-blue-200/70 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60",
  declared: "bg-slate-100 text-slate-700 border-slate-200/80 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700",
  generated: "bg-violet-50 text-violet-700 border-violet-200/70 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/60",
};

export function TrustBadge({ kind, className }: { kind: TrustKind; className?: string }) {
  const t = useTranslations("intelligence");
  return (
    <span
      title={t(`labelHints.${kind}`)}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
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
        <Tags className="h-3.5 w-3.5" aria-hidden="true" />
        {t("legend.button")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("legend.title")}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">{t("legend.intro")}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {TRUST_ORDER.map((kind) => (
              <li key={kind} className="flex items-start gap-3 py-2.5">
                <TrustBadge kind={kind} className="mt-0.5 shrink-0" />
                <p className={TYPE.body}>{t(`labelHints.${kind}`)}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" className="rounded-xl" onClick={() => setOpen(false)}>{t("howItWorks.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ────────────────────────── how it works ────────────────────────── */

const toolbarButton = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100";

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
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="leading-relaxed text-slate-700 dark:text-slate-300">{step}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className={cn(INSET, "p-3")}>
              <p className={TYPE.meta}>{t("inputsTitle")}</p>
              <ul className="mt-2 space-y-1.5 text-slate-700 dark:text-slate-300">
                {inputs.map((item) => (
                  <li key={item} className="flex gap-2"><span className="text-emerald-600">•</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <div className={cn(INSET, "p-3")}>
              <p className={TYPE.meta}>{t("neverTitle")}</p>
              <ul className="mt-2 space-y-1.5 text-slate-700 dark:text-slate-300">
                {never.map((item) => (
                  <li key={item} className="flex gap-2"><span className="text-rose-500">•</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button type="button" className="rounded-xl" onClick={() => onOpenChange(false)}>{t("close")}</Button>
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
        className={cn(toolbarButton, size === "xs" && "h-7 px-2 text-[11px]", className)}
      >
        <HelpCircle className={size === "sm" ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden="true" />
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
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
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-800 dark:bg-slate-900">
      {Icon && (
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-200/50 bg-blue-50 text-blue-600 shadow-2xs dark:border-blue-800/50 dark:bg-blue-950/60 dark:text-blue-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
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
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <h3 className={TYPE.cardTitle}>{t("rolloutTitle")}</h3>
        <p className={cn("mx-auto mt-1 max-w-md", TYPE.hint)}>{t("rolloutBody")}</p>
      </div>
    </FeatureGate>
  );
}

export function phasesOf(data: { phases?: IntelligencePhases }): IntelligencePhases {
  return data.phases || { foundation: true, learning: false, growth: false, advanced: false };
}

export function ChannelDot({ platform, className }: { platform: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: channelColor(platform) }} />
      <span className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{channelLabel(platform)}</span>
    </span>
  );
}

export function KindBadge({ children, tone = "blue", title }: { children: ReactNode; tone?: "blue" | "slate" | "emerald" | "amber" | "rose"; title?: string }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
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
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {t(option)}
            <span className={cn("rounded-full px-1.5 text-[11px] font-bold tabular-nums", active ? "bg-white/20" : "bg-white dark:bg-slate-900")}>{counts[option]}</span>
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
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <Undo2 className="h-3 w-3" aria-hidden="true" />
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
        className="h-8 rounded-xl border-slate-200 text-xs font-semibold dark:border-slate-700"
        disabled={busy !== null}
        onClick={() => void decide("accepted")}
      >
        {d("accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
        disabled={busy !== null}
        onClick={() => void decide("pinned")}
      >
        {d("pin")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
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
      <div className="flex flex-col gap-1.5 rounded-xl border border-violet-200/70 bg-violet-50/70 p-3 text-xs dark:border-violet-900/60 dark:bg-violet-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <TrustBadge kind="generated" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">{t("created")}</span>
          <Link
            href="/content"
            className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline dark:text-violet-300"
          >
            {t("open")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{result.content}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400"><span className="font-semibold">{t("rationale")}:</span> {result.rationale}</p>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant === "primary" ? "default" : "outline"}
      className={cn(
        "h-8 gap-1.5 rounded-xl text-xs font-semibold",
        variant === "primary"
          ? "bg-violet-600 text-white shadow-xs hover:bg-violet-700"
          : "border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40",
      )}
      disabled={busy}
      onClick={() => void create()}
    >
      <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
      {busy ? t("creating") : label || t("button")}
    </Button>
  );
}
