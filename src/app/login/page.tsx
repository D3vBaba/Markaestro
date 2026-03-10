"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/components/providers/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function LoginPage() {
  const { user, loading, signInEmail, signUpEmail, signInGoogle, signInFacebook } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function handlePrimary() {
    try {
      setError("");
      setBusy(true);
      if (mode === "signin") {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password);
      }
    } catch (e: any) {
      setError(e?.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 gradient-mesh-strong" />
      {/* Decorative gradient orbs */}
      <div className="pointer-events-none absolute -top-32 left-1/4 w-96 h-96 rounded-full bg-primary/8 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 w-72 h-72 rounded-full bg-chart-2/6 blur-3xl" />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-8 p-6 lg:grid-cols-2 lg:p-10">
        <motion.div
          className="hidden lg:block"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl gradient-primary p-1.5 shadow-lg shadow-primary/25">
              <Image src="/markaestro-logo.jpg" alt="Markaestro logo" width={32} height={32} className="h-full w-full object-contain rounded-md" />
            </div>
            <span className="text-sm font-semibold text-primary tracking-wide">Markaestro Platform</span>
          </div>
          <h1 className="text-4xl font-normal tracking-tight font-[family-name:var(--font-display)]">
            Scale campaigns with <span className="gradient-text">precision.</span>
          </h1>
          <p className="mt-4 max-w-md text-muted-foreground leading-relaxed">
            Authenticate once, manage all growth workflows in one place, and launch campaigns faster with your team.
          </p>

          <div className="mt-10 space-y-5">
            {[
              {
                color: "bg-violet-500",
                title: "Performance-first dashboard",
                desc: "Track campaign outcomes and channel efficiency in one view.",
              },
              {
                color: "bg-pink-500",
                title: "Automation-ready workflows",
                desc: "Move from drafts to scheduled campaigns with fewer manual steps.",
              },
              {
                color: "bg-blue-500",
                title: "Secure by default",
                desc: "Workspace boundaries and authenticated access for your team.",
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4">
                <div className={`mt-1.5 w-2 h-2 rounded-full ${item.color} shrink-0`} />
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
          <Card className="mx-auto w-full max-w-md shadow-2xl shadow-primary/[0.06] border-border/40">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-[family-name:var(--font-display)] font-normal">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </CardTitle>
              <CardDescription>
                {mode === "signin" ? "Sign in to continue to Markaestro." : "Start building your marketing engine."}
              </CardDescription>
              <div className="mt-4 grid grid-cols-2 rounded-xl border border-border/50 bg-muted/30 p-1">
                <button
                  className={`h-9 rounded-lg text-sm font-medium transition-all ${mode === "signin" ? "gradient-primary text-white shadow-md shadow-primary/20" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setMode("signin")}
                >
                  Sign In
                </button>
                <button
                  className={`h-9 rounded-lg text-sm font-medium transition-all ${mode === "signup" ? "gradient-primary text-white shadow-md shadow-primary/20" : "text-muted-foreground hover:text-foreground"}`}
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
                  <span className="w-full border-t border-border/40" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-3 text-muted-foreground">or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-xl border-border/50"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setError("");
                      setBusy(true);
                      await signInGoogle();
                    } catch (e: any) {
                      setError(e?.message || "Google sign-in failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Google
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-xl border-border/50"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setError("");
                      setBusy(true);
                      await signInFacebook();
                    } catch (e: any) {
                      setError(e?.message || "Facebook sign-in failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Facebook
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <footer className="absolute bottom-0 left-0 right-0 border-t border-border/30 bg-background/50 glass">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-4 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Markaestro. All rights reserved.</p>
          <nav className="flex gap-6">
            <a href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition">Terms</a>
            <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition">Privacy</a>
            <a href="/contact" className="text-xs text-muted-foreground hover:text-foreground transition">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
