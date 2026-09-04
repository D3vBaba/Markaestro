"use client";

import { useSyncExternalStore } from "react";

/**
 * True when `query` matches. Server and first client render return
 * `fallback` so hydration stays consistent; the real value lands right after.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
