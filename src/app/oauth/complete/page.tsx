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
