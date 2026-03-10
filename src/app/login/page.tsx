"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/components/providers/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ShieldCheck, TrendingUp } from "lucide-react";
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,0,0,0.05),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(0,0,0,0.03),transparent_32%)]" />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-8 p-6 lg:grid-cols-2 lg:p-10">
        <motion.div
          className="hidden lg:block"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg border bg-white p-1 shadow-sm">
              <Image src="/markaestro-logo.jpg" alt="Markaestro logo" width={32} height={32} className="h-full w-full object-contain" />
            </div>
            <Badge variant="secondary">Markaestro Platform</Badge>
          </div>
          <h1 className="text-4xl font-normal tracking-tight text-foreground font-[family-name:var(--font-display)]">Scale campaigns with precision.</h1>
          <p className="mt-3 max-w-md text-muted-foreground">
            Authenticate once, manage all growth workflows in one place, and launch campaigns faster with your team.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border p-2"><TrendingUp className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-semibold">Performance-first dashboard</p>
                <p className="text-xs text-muted-foreground">Track campaign outcomes and channel efficiency in one view.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-lg border p-2"><Sparkles className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-semibold">Automation-ready workflows</p>
                <p className="text-xs text-muted-foreground">Move from drafts to scheduled campaigns with fewer manual steps.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-lg border p-2"><ShieldCheck className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-semibold">Secure by default</p>
                <p className="text-xs text-muted-foreground">Workspace boundaries and authenticated access for your team.</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease }}
        >
          <Card className="mx-auto w-full max-w-md border shadow-lg">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-[family-name:var(--font-display)] font-normal">{mode === "signin" ? "Welcome back" : "Create your account"}</CardTitle>
              <CardDescription>
                {mode === "signin" ? "Sign in to continue to Markaestro." : "Start building your marketing engine."}
              </CardDescription>
              <div className="mt-3 grid grid-cols-2 rounded-lg border bg-muted/50 p-1">
                <button
                  className={`h-9 rounded-md text-sm font-medium transition ${mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setMode("signin")}
                >
                  Sign In
                </button>
                <button
                  className={`h-9 rounded-md text-sm font-medium transition ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
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
                className="h-11"
              />
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                className="h-11"
              />

              {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}

              <Button className="h-11 w-full" disabled={busy} onClick={handlePrimary}>
                {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
              </Button>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-11 w-full"
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
                  className="h-11 w-full"
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

      <footer className="absolute bottom-0 left-0 right-0 border-t border-border bg-background/60 backdrop-blur-sm">
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
