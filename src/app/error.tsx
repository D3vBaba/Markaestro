"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something Went Wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t finish that request. Please try again.
        </p>
        <Button className="mt-6" onClick={retry}>Try again</Button>
      </div>
    </main>
  );
}

