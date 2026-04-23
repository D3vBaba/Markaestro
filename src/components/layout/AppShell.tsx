"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { TrialBanner } from "./TrialBanner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useOnboardingStatus } from "@/components/providers/useOnboardingStatus";
import { useSubscription } from "@/components/providers/SubscriptionProvider";
import { VerifyEmailGate } from "./VerifyEmailGate";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { completed, error: onboardingError, loading: onboardingLoading } = useOnboardingStatus();
  const { status: subscriptionStatus, loading: subscriptionLoading } = useSubscription();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname !== '/login' && pathname !== '/') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  useEffect(() => {
    if (loading || onboardingLoading || !user) return;
    if (completed === false && !onboardingError) {
      router.replace('/onboarding');
    }
  }, [loading, onboardingLoading, user, completed, onboardingError, router]);

  const unverifiedAfterOnboarding = Boolean(user && completed === true && user.emailVerified === false);
  const waitingForSubscriptionToEvaluateGate = unverifiedAfterOnboarding && subscriptionLoading;
  const needsEmailVerification = Boolean(
    unverifiedAfterOnboarding && subscriptionStatus?.active,
  );

  if (loading || onboardingLoading || waitingForSubscriptionToEvaluateGate) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-32 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-24 rounded-full bg-muted animate-pulse mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;
  if (completed === false && !onboardingError) return null;

  if (needsEmailVerification) {
    return <VerifyEmailGate />;
  }

  return (
    <div className="grid h-screen w-full max-w-full overflow-hidden lg:grid-cols-[232px_1fr]">
      <Sidebar />
      <div
        className="flex flex-col h-screen min-w-0 overflow-hidden"
        style={{ background: "var(--mk-surface)" }}
      >
        <TrialBanner />
        <Header />
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-4 py-6 sm:px-6 sm:py-7 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-6xl min-w-0 w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
