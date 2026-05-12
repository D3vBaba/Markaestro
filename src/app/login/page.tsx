"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import MarketingLayout from "@/components/layout/MarketingLayout";
import { pillStyle } from "@/components/mk/pills";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { user, loading, signInEmail, signUpEmail, signInGoogle, signInFacebook, resetPassword } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const redirectTo = searchParams.get("next") || "/dashboard";

  useEffect(() => {
    if (!loading && user) router.replace(redirectTo);
  }, [loading, user, router, redirectTo]);

  async function handlePrimary() {
    try {
      setError("");
      setBusy(true);
      if (mode === "signin") {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password);
      }
    } catch (e: unknown) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingLayout>
      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 p-6 lg:grid-cols-2 lg:p-10 min-h-[calc(100vh-4rem)]">
        <motion.div
          className="hidden lg:block"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <p className="mk-eyebrow mb-4">Sign in to Markaestro</p>
          <h1
            className="text-[40px] font-semibold leading-[1.05]"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
          >
            Publish everywhere with
            <br />
            <span style={{ color: "var(--mk-accent)" }}>precision.</span>
          </h1>
          <p
            className="mt-5 max-w-md text-[14px] leading-relaxed"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
          >
            Authenticate once, manage every social channel in one place, and ship posts
            faster with your team.
          </p>

          <div className="mt-10 flex flex-col gap-5">
            {[
              {
                title: "Performance-first dashboard",
                desc: "Track post outcomes and channel efficiency in one view.",
              },
              {
                title: "Streamlined publishing",
                desc: "Move from draft caption to scheduled post with fewer manual steps.",
              },
              {
                title: "Secure by default",
                desc: "Workspace boundaries and authenticated access for your team.",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
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
                {mode === "signin" ? "Welcome back" : "Start here"}
              </p>
              <h2
                className="mt-1.5 text-[22px] sm:text-[24px] font-semibold m-0"
                style={{ color: "var(--mk-ink)", letterSpacing: "-0.025em" }}
              >
                {mode === "signin" ? "Sign in to your account" : "Create your account"}
              </h2>
              <p
                className="mt-1.5 text-[13px]"
                style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
              >
                {mode === "signin"
                  ? "Continue where you left off."
                  : "Start building your marketing engine."}
              </p>
            </div>

            {/* Mode toggle */}
            <div
              className="mt-5 grid grid-cols-2 gap-1 rounded-lg p-1"
              style={{
                background: "var(--mk-panel)",
                border: "1px solid var(--mk-rule)",
              }}
            >
              <button
                className="h-8 rounded-[6px] text-[12.5px] font-medium transition-colors"
                style={{
                  background: mode === "signin" ? "var(--mk-paper)" : "transparent",
                  color: mode === "signin" ? "var(--mk-ink)" : "var(--mk-ink-60)",
                  border: mode === "signin" ? "1px solid var(--mk-rule)" : "1px solid transparent",
                  letterSpacing: "-0.005em",
                }}
                onClick={() => setMode("signin")}
              >
                Sign in
              </button>
              <button
                className="h-8 rounded-[6px] text-[12.5px] font-medium transition-colors"
                style={{
                  background: mode === "signup" ? "var(--mk-paper)" : "transparent",
                  color: mode === "signup" ? "var(--mk-ink)" : "var(--mk-ink-60)",
                  border: mode === "signup" ? "1px solid var(--mk-rule)" : "1px solid transparent",
                  letterSpacing: "-0.005em",
                }}
                onClick={() => setMode("signup")}
              >
                Sign up
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                type="email"
                className="h-11 rounded-lg text-[13.5px]"
              />
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                className="h-11 rounded-lg text-[13.5px]"
              />

              {mode === "signin" && !showReset && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-[11.5px] font-medium hover:underline"
                    style={{ color: "var(--mk-accent)" }}
                    onClick={() => { setShowReset(true); setError(""); setSuccess(""); }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <p
                  className="rounded-lg px-3.5 py-2.5 text-[12px]"
                  style={pillStyle("neg")}
                >
                  {error}
                </p>
              )}
              {success && (
                <p
                  className="rounded-lg px-3.5 py-2.5 text-[12px]"
                  style={pillStyle("pos")}
                >
                  {success}
                </p>
              )}

              {showReset ? (
                <div className="flex flex-col gap-3">
                  <Button
                    className="h-11 w-full rounded-lg text-[13.5px]"
                    disabled={busy}
                    onClick={async () => {
                      if (!email) { setError("Please enter your email address above."); return; }
                      try {
                        setError(""); setSuccess(""); setBusy(true);
                        await resetPassword(email);
                        setSuccess("Password reset email sent. Check your inbox.");
                        setShowReset(false);
                      } catch (e: unknown) {
                        setError(friendlyAuthError(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Sending…" : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-[12px] transition-colors"
                    style={{ color: "var(--mk-ink-60)" }}
                    onClick={() => { setShowReset(false); setError(""); }}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <Button
                  className="h-11 w-full rounded-lg text-[13.5px]"
                  disabled={busy}
                  onClick={handlePrimary}
                >
                  {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
                </Button>
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
                Or continue with
              </span>
              <span
                className="flex-1 h-px"
                style={{ background: "var(--mk-rule)" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="outline"
                className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
                disabled={busy}
                onClick={async () => {
                  try {
                    setError("");
                    setBusy(true);
                    await signInGoogle();
                  } catch (e: unknown) {
                    setError(friendlyAuthError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Google
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full rounded-lg gap-2 text-[13.5px]"
                disabled={busy}
                onClick={async () => {
                  try {
                    setError("");
                    setBusy(true);
                    await signInFacebook();
                  } catch (e: unknown) {
                    setError(friendlyAuthError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="var(--mk-ch-facebook)"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Facebook
              </Button>
            </div>
          </div>

          <p
            className="mt-5 text-center text-[11.5px]"
            style={{ color: "var(--mk-ink-40)" }}
          >
            By continuing you agree to our{" "}
            <a
              href="/terms"
              className="hover:underline"
              style={{ color: "var(--mk-ink-60)" }}
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="hover:underline"
              style={{ color: "var(--mk-ink-60)" }}
            >
              Privacy Policy
            </a>
            .
          </p>
        </motion.div>
      </div>
    </MarketingLayout>
  );
}
