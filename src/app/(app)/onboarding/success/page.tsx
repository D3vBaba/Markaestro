"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/providers/AuthProvider";
import { getSafeInternalPath } from "@/lib/safe-internal-path";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

function OnboardingSuccessContent() {
  const t = useTranslations("onboarding.success");
  const { user, loading: authLoading } = useAuth();
  const { status, refresh } = useSubscription();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Checkout carries where to continue to: the dashboard when this finishes
  // onboarding, the billing tab when it was an upgrade from Settings.
  const nextPath = getSafeInternalPath(searchParams.get("next"), {
    fallback: "/dashboard",
    selfPrefix: "/onboarding/success",
  });
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
      const timer = setTimeout(() => router.replace(nextPath), 3000);
      return () => clearTimeout(timer);
    }
  }, [ready, nextPath, router]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/markaestro-logo-transparent.png"
              alt="Markaestro"
              width={24}
              height={24}
              className="size-6 object-contain"
            />
            <span className="text-[14px] font-semibold tracking-tight text-foreground">Markaestro</span>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-20">
        <div className="w-full max-w-md text-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease }}
            className="mb-6 inline-flex size-14 items-center justify-center rounded-full bg-mk-pos-soft text-mk-pos"
          >
            <Check className="size-7" strokeWidth={2.25} />
          </motion.div>

          <motion.p
            className="m-0 text-[13px] font-medium text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
          >
            {t("allSet")}
          </motion.p>

          <motion.h1
            className="m-0 mt-2 text-3xl font-semibold leading-tight tracking-tight text-foreground text-balance"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.35, ease }}
          >
            {t("readyToLaunch")}
          </motion.h1>

          <motion.p
            className="m-0 mt-3 text-[15px] leading-6 text-mk-ink-80 text-pretty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.35, ease }}
          >
            {t("settingUpAccount")}
          </motion.p>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            aria-hidden
          >
            <div className="mx-auto h-1 w-32 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full w-full origin-left bg-foreground rtl:origin-right"
                initial={{ transform: "scaleX(0)" }}
                animate={{ transform: "scaleX(1)" }}
                transition={{ duration: 2.5, ease: "linear" }}
              />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/**
 * useSearchParams needs a Suspense boundary, even on a force-dynamic route.
 * The fallback is deliberately blank: this page is only ever reached as a
 * redirect from Stripe, and a flash of chrome before the real content lands
 * would read as a second page.
 */
export default function OnboardingSuccessPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingSuccessContent />
    </Suspense>
  );
}
