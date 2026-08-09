"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";
import { Link as LocaleLink } from "@/i18n/navigation";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { pillStyle } from "@/components/mk/pills";
import { isRtlLocale } from "@/i18n/routing";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

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
  const isRtl = isRtlLocale(useLocale());
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
      // A recent code is still valid — let the user go enter it.
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
      // Success — hold the loader until onAuthStateChanged resolves and the
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
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-32 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-24 rounded-full bg-muted animate-pulse mx-auto" />
          </div>
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
      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 p-6 lg:grid-cols-2 lg:p-10 min-h-[calc(100vh-4rem)]">
        <motion.div
          className="hidden lg:block"
          initial={{ opacity: 0, x: isRtl ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <p className="mk-eyebrow mb-4">{t("hero.eyebrow")}</p>
          <h1
            className="text-[40px] font-semibold leading-[1.05]"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
          >
            {t("hero.titleLine1")}
            <br />
            {t("hero.titleLine2Prefix")}<span style={{ color: "var(--mk-accent)" }}>{t("hero.titleLine2Accent")}</span>
          </h1>
          <p
            className="mt-5 max-w-md text-[14px] leading-relaxed"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            {t("hero.subtitle")}
          </p>

          <div className="mt-10 flex flex-col gap-5">
            {heroPoints.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <div
                  className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: "var(--mk-accent)" }}
                />
                <div>
                  <p
                    className="text-[13.5px] font-semibold"
                    style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
                  >
                    {item.title}
                  </p>
                  <p
                    className="text-[12.5px] mt-0.5"
                    style={{ color: "var(--mk-ink-60)" }}
                  >
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA for new visitors — the sign-in page should still sell. */}
          <div
            className="mt-10 rounded-xl border p-5 max-w-md"
            style={{ background: "var(--mk-paper)", borderColor: "var(--mk-rule)" }}
          >
            <p
              className="text-[13.5px] font-semibold"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.005em" }}
            >
              {t("hero.newHere.title")}
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--mk-ink-60)" }}>
              {t("hero.newHere.body")}
            </p>
            <Link href="/onboarding" className="mt-4 block">
              <Button className="h-10 w-full rounded-lg text-[13px]">
                {t("hero.newHere.cta")}
              </Button>
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease }}
          className="mx-auto w-full max-w-md"
        >
          <div
            className="rounded-xl p-6 sm:p-7"
            style={{
              background: "var(--mk-paper)",
              border: "1px solid var(--mk-rule)",
            }}
          >
            <div>
              <p className="mk-eyebrow">
                {stage === "email" ? t("form.eyebrowEmail") : t("form.eyebrowCode")}
              </p>
              <h2
                className="mt-1.5 text-[22px] sm:text-[24px] font-semibold m-0"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
              >
                {stage === "email" ? t("form.titleEmail") : t("form.titleCode")}
              </h2>
              <p
                className="mt-1.5 text-[13px]"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                {stage === "email" ? (
                  t("form.subtitleEmail")
                ) : (
                  t.rich("form.subtitleCode", {
                    email: () => (
                      <span className="font-medium" style={{ color: "var(--mk-ink)" }}>
                        {email.trim()}
                      </span>
                    ),
                  })
                )}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {stage === "email" ? (
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("form.emailPlaceholder")}
                  type="email"
                  autoComplete="email"
                  className="h-11 rounded-lg text-[13.5px]"
                  onKeyDown={(e) => e.key === "Enter" && !busy && handleSendCode()}
                />
              ) : (
                <Input
                  ref={codeInputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("form.codePlaceholder")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-12 rounded-lg text-center font-mono text-[20px] tracking-[0.4em]"
                  onKeyDown={(e) => e.key === "Enter" && !busy && handleVerifyCode()}
                />
              )}

              {error && (
                <p
                  className="rounded-lg px-3.5 py-2.5 text-[12px]"
                  style={pillStyle("neg")}
                >
                  {error}
                </p>
              )}

              {stage === "email" ? (
                <Button
                  className="h-11 w-full rounded-lg text-[13.5px]"
                  disabled={busy}
                  onClick={handleSendCode}
                >
                  {busy ? t("form.sendingCode") : t("form.sendCode")}
                </Button>
              ) : (
                <>
                  <Button
                    className="h-11 w-full rounded-lg text-[13.5px]"
                    disabled={busy || code.length < 6}
                    onClick={handleVerifyCode}
                  >
                    {busy ? t("form.verifying") : t("form.signIn")}
                  </Button>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-[12px] transition-colors py-2.5 -my-1 px-1 -mx-1"
                      style={{ color: "var(--mk-ink-60)" }}
                      onClick={() => { setStage("email"); setCode(""); setError(""); }}
                    >
                      {t("form.useDifferentEmail")}
                    </button>
                    <button
                      type="button"
                      className="text-[12px] font-medium hover:underline disabled:opacity-50 disabled:no-underline py-2.5 -my-1 px-1 -mx-1"
                      style={{ color: "var(--mk-accent)" }}
                      disabled={busy || resendCooldown > 0}
                      onClick={handleSendCode}
                    >
                      {resendCooldown > 0 ? t("form.resendIn", { seconds: resendCooldown }) : t("form.resendCode")}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="relative my-5 flex items-center gap-3">
              <span
                className="flex-1 h-px"
                style={{ background: "var(--mk-rule)" }}
              />
              <span
                className="font-mono text-[9.5px] uppercase"
                style={{ color: "var(--mk-ink-40)", letterSpacing: "0.18em" }}
              >
                {t("form.orContinueWith")}
              </span>
              <span
                className="flex-1 h-px"
                style={{ background: "var(--mk-rule)" }}
              />
            </div>

            <Button
              variant="outline"
              className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
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
              <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              {t("form.continueWithGoogle")}
            </Button>
          </div>

          <p
            className="mt-5 text-center text-[11.5px]"
            style={{ color: "var(--mk-ink-40)" }}
          >
            {t.rich("form.legal", {
              terms: (chunks) => (
                <LocaleLink href="/terms" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>
                  {chunks}
                </LocaleLink>
              ),
              privacy: (chunks) => (
                <LocaleLink href="/privacy" className="hover:underline" style={{ color: "var(--mk-ink-60)" }}>
                  {chunks}
                </LocaleLink>
              ),
            })}
          </p>
        </motion.div>
      </div>
    </MarketingLayout>
  );
}
