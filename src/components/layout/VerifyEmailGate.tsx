"use client";

import { useState } from "react";
import Image from "next/image";
import { Mail, RefreshCw } from "lucide-react";
import { reload } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { auth } from "@/lib/firebase-client";

export function VerifyEmailGate() {
  const { user, sendVerificationEmail, logout } = useAuth();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const email = user?.email || "";

  async function handleResend() {
    setMessage(null);
    setSending(true);
    try {
      await sendVerificationEmail();
      setMessage("We sent another email — check your inbox and spam folder.");
    } catch {
      setMessage("Could not send right now. Try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  async function handleCheckedInbox() {
    if (!auth.currentUser) return;
    setMessage(null);
    setChecking(true);
    try {
      await reload(auth.currentUser);
      if (auth.currentUser.emailVerified) {
        setMessage("You’re verified — loading your workspace…");
      } else {
        setMessage("We don’t see verification yet. Open the link in the email, then try again.");
      }
    } catch {
      setMessage("Could not refresh your account. Try signing out and back in.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card shadow-lg shadow-black/5 overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-8 py-10 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 mb-5">
            <Mail className="h-7 w-7 text-white" aria-hidden />
          </div>
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">Almost there</p>
          <h1 className="mt-2 text-2xl font-normal tracking-tight text-white font-[family-name:var(--font-display)]">
            Verify your email
          </h1>
          <p className="mt-3 text-sm text-white/75 leading-relaxed">
            After you finish onboarding and start your trial, we need to confirm your address before you can use Markaestro.
          </p>
        </div>
        <div className="px-8 py-8 space-y-6">
          {email && (
            <div className="rounded-xl border bg-muted/40 px-4 py-3 text-center">
              <p className="text-xs text-muted-foreground">We sent a link to</p>
              <p className="text-sm font-medium text-foreground break-all mt-0.5">{email}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            Open the email and tap <strong className="text-foreground">Verify email</strong>. This keeps your workspace and billing secure.
          </p>
          {message && (
            <p className="text-xs text-center text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              {message}
            </p>
          )}
          <div className="space-y-3">
            <Button className="w-full rounded-xl h-11 gap-2" onClick={handleResend} disabled={sending}>
              {sending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Resend email
                </>
              )}
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                className="rounded-xl h-11"
                onClick={handleCheckedInbox}
                disabled={checking}
              >
                {checking ? "Checking…" : "I’ve verified"}
              </Button>
              <Button variant="outline" className="rounded-xl h-11" onClick={() => logout()}>
                Sign out
              </Button>
            </div>
          </div>
          <div className="flex justify-center pt-2">
            <Image
              src="/markaestro-logo-transparent.png"
              alt=""
              width={120}
              height={36}
              className="h-8 w-auto opacity-60"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
