"use client";

import { useEffect, useRef, useState } from "react";
import { MailWarning } from "lucide-react";
import { reload } from "firebase/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { auth } from "@/lib/firebase-client";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 2 * 60 * 1000;
const RESEND_COOLDOWN_S = 60;

/**
 * Slim persistent banner for signed-in-but-unverified users. The app stays
 * fully readable/editable; only outbound publishing/scheduling is blocked
 * (enforced server-side with EMAIL_NOT_VERIFIED). Not dismissible — it polls
 * for verification and disappears on its own once the email is confirmed.
 */
export function VerifyEmailBanner() {
  const { user, sendVerificationEmail } = useAuth();
  const [sending, setSending] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  // Bumped on each resend so the bounded polling window restarts.
  const [pollEpoch, setPollEpoch] = useState(0);
  const verifiedRef = useRef(false);

  const show = Boolean(user && user.emailVerified === false);
  const email = user?.email || "";

  // Poll for verification so the banner dismisses without the user clicking
  // anything. Each window stops after ~2 minutes; resending restarts it.
  useEffect(() => {
    if (!show) return;
    const startedAt = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        clearInterval(interval);
        return;
      }
      const current = auth.currentUser;
      if (!current || verifiedRef.current) return;
      try {
        await reload(current);
        if (auth.currentUser?.emailVerified) {
          clearInterval(interval);
          verifiedRef.current = true;
          try {
            // Force-refresh the ID token so the server sees email_verified=true,
            // then reload so the shell re-renders with fresh auth state.
            await auth.currentUser.getIdToken(true);
          } catch {
            // Non-fatal — the reload below re-initializes auth either way.
          }
          window.location.reload();
        }
      } catch {
        // Transient network error — try again on the next tick.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [show, pollEpoch]);

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timeout = setTimeout(() => setCooldownLeft((s) => s - 1), 1_000);
    return () => clearTimeout(timeout);
  }, [cooldownLeft]);

  if (!show) return null;

  async function handleResend() {
    if (sending || cooldownLeft > 0) return;
    setSending(true);
    try {
      await sendVerificationEmail();
      toast.success("Verification email sent — check your inbox and spam folder.");
      setCooldownLeft(RESEND_COOLDOWN_S);
      setPollEpoch((e) => e + 1);
    } catch {
      toast.error("Could not send right now. Try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-6 py-2.5 text-[13px] border-b"
      style={{
        background: "color-mix(in oklch, var(--mk-warn) 14%, var(--mk-paper))",
        color: "color-mix(in oklch, var(--mk-warn) 70%, var(--mk-ink))",
        borderColor: "color-mix(in oklch, var(--mk-warn) 24%, var(--mk-paper))",
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <MailWarning className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium truncate">
          Verify your email to publish
          {email ? (
            <>
              {" "}— we sent a link to <span className="font-semibold break-all">{email}</span>
            </>
          ) : null}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs rounded-lg shrink-0"
        onClick={handleResend}
        disabled={sending || cooldownLeft > 0}
      >
        {sending
          ? "Sending…"
          : cooldownLeft > 0
            ? `Resend (${cooldownLeft}s)`
            : "Resend email"}
      </Button>
    </div>
  );
}
