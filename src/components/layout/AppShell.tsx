"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileTabBar } from "./MobileTabBar";
import { TrialBanner } from "./TrialBanner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useOnboardingStatus } from "@/components/providers/useOnboardingStatus";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { VerifyEmailBanner } from "./VerifyEmailBanner";
import { InvitesBanner } from "./InvitesBanner";
import { ChannelHealthBanner } from "./ChannelHealthBanner";
import { OfflineBanner } from "./OfflineBanner";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const {
    completed,
    pendingInvites,
    anyWorkspaceActivity,
    error: onboardingError,
    loading: onboardingLoading,
  } = useOnboardingStatus();
  const { current: currentWorkspace } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();

  // The onboarding funnel (quiz + paywall) is for genuinely new accounts
  // only. Users with a pending workspace invite accept it from the banner
  // here instead, and established users switching into an empty workspace
  // stay where they are.
  const needsOnboarding =
    completed === false && !onboardingError && pendingInvites === 0 && !anyWorkspaceActivity;

  useEffect(() => {
    if (!loading && !user && pathname !== '/login' && pathname !== '/') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  useEffect(() => {
    if (loading || onboardingLoading || !user) return;
    if (needsOnboarding) {
      router.replace('/onboarding');
    }
  }, [loading, onboardingLoading, user, needsOnboarding, router]);

  if (loading || onboardingLoading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
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
  if (needsOnboarding) return null;

  // Invitees with no membership yet must not land in the empty app (or
  // write into the 'default' sentinel workspace). The banner is the
  // only action until they accept or decline.
  if (!currentWorkspace && pendingInvites > 0) {
    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--mk-surface)" }}>
        <InvitesBanner />
      </div>
    );
  }

  return (
    <div className="grid h-dvh w-full max-w-full overflow-hidden lg:grid-cols-[240px_1fr]">
      <Sidebar />
      <div
        className="flex flex-col h-dvh min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950"
      >
        <OfflineBanner />
        <TrialBanner />
        <VerifyEmailBanner />
        <InvitesBanner />
        {/* A dead token used to announce itself as a failed publish, days
            later. Below the account-level banners: those block work, this
            one warns about it. */}
        <ChannelHealthBanner />
        <Header />
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-4 py-5 pb-8 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}

