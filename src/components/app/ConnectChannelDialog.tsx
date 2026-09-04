"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChannelGlyph } from "@/components/app/ChannelGlyph";
import {
  catalogProviderFor,
  requestedPermissions,
  type CatalogProvider,
} from "@/lib/oauth/permission-catalog";

export type ConnectDialogRequest = {
  /** UI provider id: meta, instagram, tiktok, threads, pinterest, linkedin, x. */
  provider: string;
  linkedinMode?: "profile" | "community";
  /** Reconnect re-runs the login for an account that is already linked. */
  mode?: "connect" | "reconnect";
};

const REQUIREMENT_COUNT: Record<CatalogProvider, number> = {
  instagram: 2,
  meta: 2,
  threads: 1,
  tiktok: 2,
  x: 2,
  pinterest: 2,
  linkedin_profile: 1,
  linkedin_community: 1,
};

/**
 * The screen a user sees between pressing Connect and landing on the
 * platform's login. It spells out the three steps ahead, every permission
 * Markaestro is about to request and what each one is used for, and what the
 * account needs to be. Nothing here touches the OAuth flow itself: Continue
 * hands off to the same authorize navigation the buttons used to trigger
 * directly, so existing connections and callbacks are unaffected.
 */
export default function ConnectChannelDialog({
  request,
  brandName,
  onOpenChange,
  onContinue,
}: {
  request: ConnectDialogRequest | null;
  brandName?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Must start the authorize navigation synchronously (user gesture). */
  onContinue: (request: ConnectDialogRequest) => void;
}) {
  const t = useTranslations("appCommon.connectChannel");
  // "Opening…" is tied to the request it was pressed for, so a dialog that
  // closes and re-opens for another provider starts clean without an effect.
  const [openingFor, setOpeningFor] = useState<ConnectDialogRequest | null>(null);
  const opening = request !== null && openingFor === request;

  const catalogProvider = request ? catalogProviderFor(request.provider, request.linkedinMode) : null;
  const providerName = catalogProvider ? t(`providerNames.${catalogProvider}`) : "";
  const host = catalogProvider ? t(`hosts.${catalogProvider}`) : "";
  const permissions = catalogProvider ? requestedPermissions(catalogProvider) : [];
  const reconnect = request?.mode === "reconnect";

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        {request && catalogProvider && (
          <>
            <DialogHeader className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-border/50 text-start">
              <div className="flex items-start gap-3.5 pe-8">
                <ChannelGlyph provider={request.provider} size={40} />
                <div className="min-w-0">
                  <DialogTitle className="text-base sm:text-lg leading-tight">
                    {reconnect
                      ? t("dialog.reconnectTitle", { provider: providerName })
                      : t("dialog.title", { provider: providerName })}
                    {brandName && (
                      <span className="ms-1.5 font-normal text-muted-foreground">
                        {t("dialog.forBrand", { brand: brandName })}
                      </span>
                    )}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-[13px] leading-relaxed">
                    {t("dialog.intro", { provider: providerName })}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="px-5 sm:px-6 py-5 space-y-6 max-h-[min(60dvh,560px)] overflow-y-auto">
              {/* Step list */}
              <section>
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("dialog.stepsTitle")}
                </h3>
                <ol className="mt-3 space-y-3">
                  {[0, 1, 2].map((index) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="mt-0.5 w-5 shrink-0 font-mono text-xs tabular-nums text-mk-ink-40">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {t(`dialog.steps.${index}.title`, { host, provider: providerName })}
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                          {index === 1 && catalogProvider === "meta"
                            ? t("dialog.metaStepDetail")
                            : t(`dialog.steps.${index}.detail`, { host, provider: providerName })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Permission list */}
              <section>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" aria-hidden />
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {t("dialog.permissionsTitle")}
                  </h3>
                </div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{t("dialog.permissionsHint")}</p>
                <ul className="mt-3 divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20">
                  {permissions.map((item) => (
                    <li key={item.scope} className="flex items-start gap-3 px-3.5 py-3">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[color:var(--mk-pos)]" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <p className="text-sm font-semibold text-foreground">
                            {t(`permissions.${item.key}.title`)}
                          </p>
                          <code className="text-[11px] text-mk-ink-40">{item.scope}</code>
                        </div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                          {t(`permissions.${item.key}.description`)}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-primary">
                          {t("dialog.usedFor", { feature: t(`features.${item.feature}`) })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Requirements */}
              <section>
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("dialog.requirementsTitle")}
                </h3>
                <ul className="mt-2.5 space-y-1.5">
                  {Array.from({ length: REQUIREMENT_COUNT[catalogProvider] }, (_, index) => (
                    <li key={index} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground/90">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                      <span>{t(`requirements.${catalogProvider}.${index}`)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground space-y-1">
                {reconnect && <p>{t("dialog.reconnectNote")}</p>}
                <p>{t("dialog.privacyNote")}</p>
              </div>
            </div>

            <DialogFooter className="px-5 sm:px-6 py-4 border-t border-border/50 bg-muted/20 sm:justify-between sm:items-center gap-3">
              <Link
                href="/guides/channels"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                {t("dialog.learnMore")}
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={opening}>
                  {t("dialog.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    setOpeningFor(request);
                    onContinue(request);
                  }}
                  disabled={opening}
                  className="min-w-[180px]"
                >
                  {opening ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t("dialog.opening", { provider: providerName })}
                    </>
                  ) : (
                    <>
                      {t("dialog.continue", { provider: providerName })}
                      <ArrowUpRight className="size-4" aria-hidden />
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
