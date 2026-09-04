"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Link as LocaleLink } from "@/i18n/navigation";
import MarketingLayout from "@/components/layout/MarketingLayout";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const t = useTranslations("auth.login");
  const tAuthErrors = useTranslations("appCommon.authErrors");
  const { user, loading, requestSignInCode, signInWithCode, signInGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Passwordless: ask for the email, send a one-time code, then verify it.
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // True once a sign-in has succeeded: keep the full-screen loader up until the
  // redirect effect navigates, so the form never flashes back into view.
  const [redirecting, setRedirecting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (stage === "code") codeInputRef.current?.focus();
  }, [stage]);

  const redirectTo = searchParams.get("next") || "/dashboard";

  useEffect(() => {
    if (!loading && user) router.replace(redirectTo);
  }, [loading, user, router, redirectTo]);

  async function handleSendCode() {
    if (!email.trim()) {
      setError(t("errors.enterEmail"));
      return;
    }
    try {
      setError("");
      setBusy(true);
      await requestSignInCode(email.trim());
      setStage("code");
      setCode("");
      setResendCooldown(60);
    } catch (e: unknown) {
      // A recent code is still valid: let the user go enter it.
      if (e instanceof Error && e.message === "OTP_COOLDOWN") {
        setStage("code");
        setResendCooldown(60);
      } else {
        setError(friendlyAuthError(e, tAuthErrors));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode() {
    if (code.replace(/\D/g, "").length < 6) {
      setError(t("errors.enterCode"));
      return;
    }
    try {
      setError("");
      setBusy(true);
      await signInWithCode(email.trim(), code);
      // Success: hold the loader until onAuthStateChanged resolves and the
      // redirect effect fires. Do NOT clear `busy` here (that would flash the form).
      setRedirecting(true);
    } catch (e: unknown) {
      setError(friendlyAuthError(e, tAuthErrors));
      setBusy(false);
    }
  }

  // Once signed in (or mid-redirect, or still restoring the session), show a
  // loader instead of the form so sign-in goes straight to the dashboard with
  // no flash of the login screen.
  if (loading || user || redirecting) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    );
  }

  const heroPoints = [
    { key: "publish", title: t("hero.points.publish.title"), desc: t("hero.points.publish.desc") },
    { key: "schedule", title: t("hero.points.schedule.title"), desc: t("hero.points.schedule.desc") },
    { key: "hours", title: t("hero.points.hours.title"), desc: t("hero.points.hours.desc") },
  ];

  return (
    <MarketingLayout hideLocaleSwitcher>
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-5 py-10 sm:px-6 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[1fr_minmax(0,440px)] lg:gap-16 lg:px-10">
        <div className="hidden lg:block">
          <h1 className="m-0 max-w-[14ch] text-4xl font-semibold leading-[1.1] tracking-tight text-foreground text-balance">
            {t("hero.titleLine1")} {t("hero.titleLine2Prefix")}{t("hero.titleLine2Accent")}
          </h1>
          <p className="m-0 mt-4 max-w-[44ch] text-[15px] leading-6 text-mk-ink-80 text-pretty">
            {t("hero.subtitle")}
          </p>

          <dl className="m-0 mt-10 grid max-w-md gap-5">
            {heroPoints.map((item) => (
              <div key={item.key} className="border-s-2 border-border ps-4">
                <dt className="text-sm font-semibold text-foreground">{item.title}</dt>
                <dd className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">{item.desc}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 flex max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-foreground">{t("hero.newHere.title")}</p>
              <p className="m-0 mt-0.5 text-[13px] leading-5 text-muted-foreground">{t("hero.newHere.body")}</p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/onboarding">{t("hero.newHere.cta")}</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="m-0 text-xl font-semibold tracking-tight text-foreground">
              {stage === "email" ? t("form.titleEmail") : t("form.titleCode")}
            </h2>
            <p className="m-0 mt-1.5 text-[13px] leading-5 text-muted-foreground">
              {stage === "email" ? (
                t("form.subtitleEmail")
              ) : (
                t.rich("form.subtitleCode", {
                  email: () => <span className="font-medium text-foreground">{email.trim()}</span>,
                })
              )}
            </p>

            <form
              className="mt-6 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                if (stage === "email") void handleSendCode();
                else void handleVerifyCode();
              }}
            >
              {stage === "email" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="login-email">{t("form.eyebrowEmail")}</Label>
                  <Input
                    id="login-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("form.emailPlaceholder")}
                    type="email"
                    autoComplete="email"
                    autoFocus
                    aria-invalid={Boolean(error) || undefined}
                    className="h-11"
                  />
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="login-code">{t("form.eyebrowCode")}</Label>
                  <Input
                    id="login-code"
                    ref={codeInputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t("form.codePlaceholder")}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-invalid={Boolean(error) || undefined}
                    className="h-12 text-center font-mono text-xl tracking-[0.35em]"
                  />
                </div>
              )}

              {error ? (
                <p className="m-0 text-[13px] leading-5 text-mk-neg" role="alert">{error}</p>
              ) : null}

              {stage === "email" ? (
                <Button type="submit" size="lg" className="w-full" disabled={busy}>
                  {busy ? t("form.sendingCode") : t("form.sendCode")}
                </Button>
              ) : (
                <>
                  <Button type="submit" size="lg" className="w-full" disabled={busy || code.length < 6}>
                    {busy ? t("form.verifying") : t("form.signIn")}
                  </Button>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setStage("email"); setCode(""); setError(""); }}
                    >
                      {t("form.useDifferentEmail")}
                    </button>
                    <button
                      type="button"
                      className="font-medium text-mk-accent hover:underline underline-offset-4 disabled:text-mk-ink-40 disabled:no-underline"
                      disabled={busy || resendCooldown > 0}
                      onClick={handleSendCode}
                    >
                      {resendCooldown > 0 ? t("form.resendIn", { seconds: resendCooldown }) : t("form.resendCode")}
                    </button>
                  </div>
                </>
              )}
            </form>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t("form.orContinueWith")}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={async () => {
                try {
                  setError("");
                  setBusy(true);
                  await signInGoogle();
                  setRedirecting(true);
                } catch (e: unknown) {
                  setError(friendlyAuthError(e, tAuthErrors));
                  setBusy(false);
                }
              }}
            >
              <svg className="size-4" viewBox="0 0 24 24" aria-hidden><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              {t("form.continueWithGoogle")}
            </Button>
          </div>

          <p className="m-0 mt-5 text-center text-xs leading-5 text-muted-foreground">
            {t.rich("form.legal", {
              terms: (chunks) => (
                <LocaleLink href="/terms" className="text-mk-ink-80 underline underline-offset-4 hover:text-foreground">
                  {chunks}
                </LocaleLink>
              ),
              privacy: (chunks) => (
                <LocaleLink href="/privacy" className="text-mk-ink-80 underline underline-offset-4 hover:text-foreground">
                  {chunks}
                </LocaleLink>
              ),
            })}
          </p>

          <p className="m-0 mt-6 text-center text-[13px] text-muted-foreground lg:hidden">
            {t("hero.newHere.title")}{" "}
            <Link href="/onboarding" className="font-medium text-foreground underline underline-offset-4">
              {t("hero.newHere.cta")}
            </Link>
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
