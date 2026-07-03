"use client";

import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, friendlyAuthError } from "@/components/providers/AuthProvider";

const RESEND_COOLDOWN_S = 60;

/**
 * Slim persistent banner for signed-in-but-unverified users (legacy accounts
 * from the password era — code sign-ins are verified by construction). The
 * app stays fully readable/editable; only outbound publishing/scheduling is
 * blocked (enforced server-side with EMAIL_NOT_VERIFIED). Verification is a
 * one-time code entered inline: confirming it re-establishes the session
 * with emailVerified=true, so the banner disappears on its own.
 */
export function VerifyEmailBanner() {
  const { user, requestSignInCode, signInWithCode } = useAuth();
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const show = Boolean(user && user.emailVerified === false);
  const email = user?.email || "";

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timeout = setTimeout(() => setCooldownLeft((s) => s - 1), 1_000);
    return () => clearTimeout(timeout);
  }, [cooldownLeft]);

  if (!show) return null;

  async function handleSendCode() {
    if (sending || cooldownLeft > 0 || !email) return;
    setSending(true);
    try {
      await requestSignInCode(email);
      toast.success("Code sent — check your inbox and spam folder.");
      setCodeSent(true);
      setCooldownLeft(RESEND_COOLDOWN_S);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "OTP_COOLDOWN") {
        setCodeSent(true);
        setCooldownLeft(RESEND_COOLDOWN_S);
      } else {
        toast.error("Could not send right now. Try again in a minute.");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    if (verifying || code.length < 6 || !email) return;
    setVerifying(true);
    try {
      // Confirming the code marks the email verified server-side and refreshes
      // the session, so `user.emailVerified` flips and the banner unmounts.
      await signInWithCode(email, code);
      toast.success("Email verified — you're all set.");
    } catch (e: unknown) {
      toast.error(friendlyAuthError(e));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-[13px] border-b"
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
          {email && codeSent ? (
            <>
              {" "}— enter the code we sent to <span className="font-semibold break-all">{email}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {codeSent && (
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="h-7 w-28 rounded-lg text-center font-mono text-xs tracking-[0.25em]"
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
          />
        )}
        {codeSent && (
          <Button
            size="sm"
            className="h-7 text-xs rounded-lg"
            onClick={handleVerify}
            disabled={verifying || code.length < 6}
          >
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs rounded-lg"
          onClick={handleSendCode}
          disabled={sending || cooldownLeft > 0}
        >
          {sending
            ? "Sending…"
            : cooldownLeft > 0
              ? `Resend (${cooldownLeft}s)`
              : codeSent
                ? "Resend code"
                : "Send code"}
        </Button>
      </div>
    </div>
  );
}
