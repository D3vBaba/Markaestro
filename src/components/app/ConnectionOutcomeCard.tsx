"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, BarChart3, CheckCircle2, History, PenLine, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import { cn } from "@/lib/utils";
import {
  catalogProviderFor,
  grantedPermissions,
  requestedPermissions,
} from "@/lib/oauth/permission-catalog";

/** What the OAuth callback reported on the redirect back into the app. */
export type ConnectOutcome = {
  result: "success" | "error";
  provider: string;
  linkedinMode?: "profile" | "community" | null;
  /** access_denied | channel_limit | connection_failed, on error. */
  reason?: string | null;
  /** The provider's own error description, when it sent one. */
  message?: string | null;
  needsPageSelect?: boolean;
  needsBoardSelect?: boolean;
};

/**
 * Read the OAuth redirect params once on mount. Returns null when the page
 * was not reached through a callback (SSR included).
 */
export function readConnectOutcome(params: URLSearchParams): ConnectOutcome | null {
  const result = params.get("oauth");
  const provider = params.get("provider");
  if ((result !== "success" && result !== "error") || !provider) return null;
  const mode = params.get("linkedinMode");
  return {
    result,
    provider,
    linkedinMode: mode === "profile" || mode === "community" ? mode : null,
    reason: params.get("reason"),
    message: params.get("message"),
    needsPageSelect: params.get("needsPageSelect") === "1",
    needsBoardSelect: params.get("needsBoardSelect") === "1",
  };
}

/**
 * The persistent panel shown after the user returns from a platform login.
 *
 * A toast fades before anyone reads it; this stays until dismissed and says
 * in one place what was linked, which permissions the platform granted, and
 * what to do next. On failure it explains why nothing was linked and offers
 * to start again.
 */
export default function ConnectionOutcomeCard({
  outcome,
  brandName,
  account,
  grantedScopes,
  onDismiss,
  onTryAgain,
  onChoosePages,
  onChooseBoard,
  className,
}: {
  outcome: ConnectOutcome;
  brandName?: string | null;
  /** The linked account as the user knows it, e.g. "@markaestro". */
  account?: string | null;
  /** Scopes the platform reported on the grant, when it reported any. */
  grantedScopes?: string[] | null;
  onDismiss: () => void;
  onTryAgain?: () => void;
  onChoosePages?: () => void;
  onChooseBoard?: () => void;
  className?: string;
}) {
  const t = useTranslations("appCommon.connectChannel");
  const catalogProvider = catalogProviderFor(outcome.provider, outcome.linkedinMode);
  const providerName = catalogProvider ? t(`providerNames.${catalogProvider}`) : outcome.provider;

  if (outcome.result === "error") {
    const reasonKey = outcome.reason === "access_denied" || outcome.reason === "channel_limit"
      ? outcome.reason
      : "connection_failed";
    return (
      <div
        role="alert"
        className={cn(
          "relative rounded-xl border p-4 sm:p-5",
          "border-[color:color-mix(in_srgb,var(--mk-neg)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--mk-neg)_6%,var(--mk-paper))]",
          className,
        )}
      >
        <DismissButton onClick={onDismiss} label={t("outcome.dismiss")} />
        <div className="flex items-start gap-3.5 pe-8">
          <div className="relative shrink-0">
            <ChannelGlyph provider={outcome.provider} size={40} />
            <XCircle className="absolute -bottom-1.5 -end-1.5 size-5 rounded-full bg-background text-[color:var(--mk-neg)]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {t("outcome.errorTitle", { provider: providerName })}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {t(`outcome.reasons.${reasonKey}`, { provider: providerName })}
            </p>
            {outcome.message && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground/90">
                {t("outcome.providerSaid", { provider: providerName, message: outcome.message })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {onTryAgain && (
                <Button size="sm" onClick={onTryAgain}>
                  {t("outcome.tryAgain")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onDismiss}>
                {t("outcome.dismiss")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pending = outcome.needsPageSelect || outcome.needsBoardSelect;
  const granted = catalogProvider && grantedScopes?.length
    ? grantedPermissions(catalogProvider, grantedScopes)
    : [];
  const permissions = granted.length > 0
    ? granted
    : catalogProvider
      ? requestedPermissions(catalogProvider)
      : [];
  const body = account && brandName
    ? t("outcome.successBody", { account, brand: brandName })
    : brandName
      ? t("outcome.successBodyNoAccount", { brand: brandName })
      : account
        ? t("outcome.successBodyNoBrand", { account })
        : t("outcome.successBodyPlain");

  return (
    <div
      role="status"
      className={cn(
        "relative rounded-xl border p-4 sm:p-5",
        pending
          ? "border-[color:color-mix(in_srgb,var(--mk-warn)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--mk-warn)_7%,var(--mk-paper))]"
          : "border-[color:color-mix(in_srgb,var(--mk-pos)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--mk-pos)_6%,var(--mk-paper))]",
        className,
      )}
    >
      <DismissButton onClick={onDismiss} label={t("outcome.dismiss")} />
      <div className="flex items-start gap-3.5 pe-8">
        <div className="relative shrink-0">
          <ChannelGlyph provider={outcome.provider} size={40} />
          {pending ? (
            <AlertTriangle className="absolute -bottom-1.5 -end-1.5 size-5 rounded-full bg-background p-0.5 text-[color:var(--mk-warn)]" aria-hidden />
          ) : (
            <CheckCircle2 className="absolute -bottom-1.5 -end-1.5 size-5 rounded-full bg-background text-[color:var(--mk-pos)]" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {outcome.needsPageSelect
              ? t("outcome.needsPageTitle")
              : outcome.needsBoardSelect
                ? t("outcome.needsBoardTitle")
                : t("outcome.successTitle", { provider: providerName })}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {outcome.needsPageSelect
              ? t("outcome.needsPageBody")
              : outcome.needsBoardSelect
                ? t("outcome.needsBoardBody")
                : body}
          </p>

          {permissions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground">
                {granted.length > 0 ? t("outcome.grantedTitle") : t("outcome.requestedTitle")}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {permissions.map((item) => (
                  <li
                    key={item.scope}
                    title={item.scope}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11.5px] font-medium leading-4 text-mk-ink-80"
                  >
                    <CheckCircle2 className="size-3 text-[color:var(--mk-pos)]" aria-hidden />
                    {t(`permissions.${item.key}.title`)}
                    <span className="text-muted-foreground/80">· {t(`features.${item.feature}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {outcome.needsPageSelect && onChoosePages && (
              <Button size="sm" onClick={onChoosePages}>
                {t("outcome.choosePages")}
              </Button>
            )}
            {outcome.needsBoardSelect && onChooseBoard && (
              <Button size="sm" onClick={onChooseBoard}>
                {t("outcome.chooseBoard")}
              </Button>
            )}
            {!pending && (
              <>
                <span className="me-1 text-xs font-medium text-muted-foreground">
                  {t("outcome.nextTitle")}
                </span>
                <Link href="/content?tab=create">
                  <Button size="sm" variant="outline">
                    <PenLine className="size-3.5" aria-hidden /> {t("outcome.createPost")}
                  </Button>
                </Link>
                <Link href="/analytics">
                  <Button size="sm" variant="outline">
                    <BarChart3 className="size-3.5" aria-hidden /> {t("outcome.viewAnalytics")}
                  </Button>
                </Link>
                <Link href="/content?tab=on-platform">
                  <Button size="sm" variant="outline">
                    <History className="size-3.5" aria-hidden /> {t("outcome.postHistory")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute top-3 end-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
    >
      <X className="size-4" aria-hidden />
    </button>
  );
}
