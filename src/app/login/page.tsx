"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";
import MarketingLayout from "@/components/layout/MarketingLayout";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function LoginPage() {
  const { user, loading, signInEmail, signUpEmail, signInGoogle, signInFacebook } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
          <h1 className="text-4xl font-normal tracking-tight font-[family-name:var(--font-display)]">
            Scale campaigns with <span className="text-primary">precision.</span>
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground leading-relaxed">
            Authenticate once, manage all growth workflows in one place, and launch campaigns faster with your team.
          </p>

          <div className="mt-10 space-y-5">
            {[
              {
                title: "Performance-first dashboard",
                desc: "Track campaign outcomes and channel efficiency in one view.",
              },
              {
                title: "Automation-ready workflows",
                desc: "Move from drafts to scheduled campaigns with fewer manual steps.",
              },
              {
                title: "Secure by default",
                desc: "Workspace boundaries and authenticated access for your team.",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease }}
        >
          <Card className="mx-auto w-full max-w-md shadow-lg border-border/40">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-[family-name:var(--font-display)] font-normal">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </CardTitle>
              <CardDescription>
                {mode === "signin" ? "Sign in to continue to Markaestro." : "Start building your marketing engine."}
              </CardDescription>
              <div className="mt-4 grid grid-cols-2 rounded-xl border bg-muted/30 p-1">
                <button
                  className={`h-9 rounded-lg text-sm font-medium transition-all ${mode === "signin" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setMode("signin")}
                >
                  Sign In
                </button>
                <button
                  className={`h-9 rounded-lg text-sm font-medium transition-all ${mode === "signup" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setMode("signup")}
                >
                  Sign Up
                </button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                type="email"
                className="h-11 rounded-xl"
              />
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                className="h-11 rounded-xl"
              />

              {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-600">{error}</p> : null}

              <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={handlePrimary}>
                {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
              </Button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-3 text-muted-foreground">or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-xl gap-2"
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
                  className="h-11 w-full rounded-xl gap-2"
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
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

    </MarketingLayout>
  );
}
