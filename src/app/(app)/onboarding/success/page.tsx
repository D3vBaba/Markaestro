"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function OnboardingSuccessPage() {
  const { user, loading: authLoading } = useAuth();
  const { status, refresh } = useSubscription();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  // Stop polling as soon as the subscription is confirmed.
  const subscribed = !!status?.active;
  const ready = subscribed || timedOut;

  useEffect(() => {
    if (authLoading || !user || subscribed) return;

    // Poll with exponential backoff: 500ms start, ×1.5 per attempt, capped at
    // 4s per interval and ~30s total. Falls through to the dashboard either way.
    const MAX_TOTAL_MS = 30_000;
    const MAX_DELAY_MS = 4_000;
    let delay = 500;
    let elapsed = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      await refresh();
      if (cancelled) return;
      if (elapsed >= MAX_TOTAL_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(poll, delay);
      elapsed += delay;
      delay = Math.min(delay * 1.5, MAX_DELAY_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authLoading, user, subscribed, refresh]);

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => router.replace("/dashboard"), 3000);
      return () => clearTimeout(timer);
    }
  }, [ready, router]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--mk-surface)" }}
    >
      <header
        className="border-b"
        style={{
          background: "var(--mk-paper)",
          borderColor: "var(--mk-rule)",
        }}
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={28}
              height={28}
              className="object-contain"
            />
            <span
              className="text-[15px] font-semibold"
              style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
            >
              Markaestro
            </span>
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-5 py-20">
        <div className="max-w-md w-full text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease, type: "spring", stiffness: 200 }}
            className="inline-flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full mb-7"
            style={{
              background: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))",
              border: "1px solid color-mix(in oklch, var(--mk-pos) 28%, var(--mk-rule))",
            }}
          >
            <Check
              className="h-7 w-7 sm:h-9 sm:w-9"
              style={{ color: "var(--mk-pos)" }}
              strokeWidth={2.5}
            />
          </motion.div>

          <motion.p
            className="mk-eyebrow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.3 }}
          >
            All set
          </motion.p>

          <motion.h1
            className="mt-2 text-[28px] sm:text-[32px] font-semibold leading-[1.1]"
            style={{ color: "var(--mk-ink)", letterSpacing: "-0.03em" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4, ease }}
          >
            You&apos;re ready to launch.
          </motion.h1>

          <motion.p
            className="mt-3 text-[14px] leading-relaxed"
            style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4, ease }}
          >
            Your account is set up. Taking you to your dashboard…
          </motion.p>

          <motion.div
            className="mt-7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
          >
            <div
              className="h-px w-32 mx-auto overflow-hidden"
              style={{ background: "var(--mk-rule)" }}
            >
              <motion.div
                className="h-full"
                style={{ background: "var(--mk-accent)" }}
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 2.5, ease: "linear" }}
              />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
