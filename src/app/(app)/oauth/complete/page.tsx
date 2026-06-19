"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { getSafeNextPath } from "./safe-next";

function OAuthCompleteContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get("next"));

  useEffect(() => {
    if (loading) return;

    if (user) {
      // Mobile connect runs in a new tab (see startOAuthAuthorize) so the OS
      // doesn't hand the Meta authorize URL to the native app. When we have an
      // opener, refresh it so it shows the freshly linked account and close
      // this tab. Falls through to a same-tab navigation if the close is
      // blocked or there's no opener (desktop same-tab flow).
      const opener = typeof window !== "undefined" ? window.opener : null;
      if (opener && !opener.closed) {
        try { opener.location.reload(); } catch { /* cross-origin opener: ignore */ }
        window.close();
      }
      router.replace(nextPath);
      return;
    }

    router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
  }, [loading, nextPath, router, user]);

  return (
    <OAuthCompleteFallback />
  );
}

function OAuthCompleteFallback() {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-8 w-8 rounded-lg bg-primary animate-pulse" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Finishing connection</p>
          <p className="text-sm text-muted-foreground">
            Restoring your session and returning you to the app.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function OAuthCompletePage() {
  return (
    <Suspense fallback={<OAuthCompleteFallback />}>
      <OAuthCompleteContent />
    </Suspense>
  );
}
