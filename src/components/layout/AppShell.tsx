"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { TrialBanner } from "./TrialBanner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useOnboardingStatus } from "@/components/providers/useOnboardingStatus";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { completed, error: onboardingError, loading: onboardingLoading } = useOnboardingStatus();
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

  if (loading || onboardingLoading) {
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

  return (
    <div className="grid h-screen w-full max-w-full overflow-hidden lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:flex w-[260px]" />
      <div className="flex flex-col h-screen min-w-0 bg-background overflow-hidden">
        <TrialBanner />
        <Header />
        <main className="flex-1 p-4 sm:p-6 lg:p-10 overflow-y-auto overflow-x-hidden min-w-0">
          <div className="mx-auto max-w-6xl min-w-0 w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
