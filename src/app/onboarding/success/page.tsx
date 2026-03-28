"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function OnboardingSuccessPage() {
  const { user, loading: authLoading } = useAuth();
  const { refresh } = useSubscription();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;

    let attempts = 0;
    const maxAttempts = 10;

    async function poll() {
      await refresh();
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 1500);
      }
      if (attempts >= 2) {
        setReady(true);
      }
    }

    poll();
  }, [authLoading, user, refresh]);

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => router.replace("/dashboard"), 3000);
      return () => clearTimeout(timer);
    }
  }, [ready, router]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/markaestro-logo-transparent.png" alt="Markaestro" width={36} height={32} className="object-contain" />
            <span className="text-base font-bold tracking-tight">Markaestro</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-6 py-32 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease, type: "spring", stiffness: 200 }}
          className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 mb-8"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </motion.div>

        <motion.h1
          className="text-3xl font-normal tracking-tight font-[family-name:var(--font-display)]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4, ease }}
        >
          You&apos;re all set!
        </motion.h1>

        <motion.p
          className="mt-4 text-muted-foreground leading-relaxed"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4, ease }}
        >
          Your account is ready. Taking you to your dashboard...
        </motion.p>

        <motion.div
          className="mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          <div className="h-1 w-32 mx-auto rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 2.5, ease: "linear" }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
