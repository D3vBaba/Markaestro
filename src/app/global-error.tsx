"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#faf9f7", color: "#1f2937" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>Something went wrong</h1>
            <p style={{ margin: "12px 0 0", color: "#6b7280" }}>
              We couldn&apos;t load Markaestro. Please try again.
            </p>
            <button
              type="button"
              onClick={retry}
              style={{
                marginTop: 24,
                border: 0,
                borderRadius: 8,
                padding: "10px 16px",
                background: "#111827",
                color: "white",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

