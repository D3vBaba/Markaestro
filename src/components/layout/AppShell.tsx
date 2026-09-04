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
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted" />
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
      <div className="flex min-h-dvh flex-col bg-background">
        <InvitesBanner />
      </div>
    );
  }

  return (
    <div className="grid h-dvh w-full max-w-full overflow-hidden lg:grid-cols-[64px_1fr] xl:grid-cols-[240px_1fr]">
      <Sidebar />
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background">
        <OfflineBanner />
        <TrialBanner />
        <VerifyEmailBanner />
        <InvitesBanner />
        {/* A dead token used to announce itself as a failed publish, days
            later. Below the account-level banners: those block work, this
            one warns about it. */}
        <ChannelHealthBanner />
        <Header />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full max-w-[1320px] px-4 py-6 pb-16 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
            {children}
          </div>
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}
