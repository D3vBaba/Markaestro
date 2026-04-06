"use client";

import { useState, useCallback, useRef } from "react";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";

export type ScanData = {
  name: string;
  description: string;
  category: string;
  pricingTier: string;
  tags: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  targetAudience: string;
  tone: string;
};

export type ScanPhase =
  | "idle"
  | "connecting"
  | "reading"
  | "extracting"
  | "analyzing"
  | "finalizing"
  | "done"
  | "error";

const PHASE_SEQUENCE: ScanPhase[] = [
  "connecting",
  "reading",
  "extracting",
  "analyzing",
  "finalizing",
];

const PHASE_TIMINGS_MS: Record<string, number> = {
  connecting: 1500,
  reading: 2500,
  extracting: 2500,
  analyzing: 4000,
  finalizing: 2000,
};

export type UseProductScanReturn = {
  /** Current scan phase for animation */
  phase: ScanPhase;
  /** Whether a scan is currently running */
  scanning: boolean;
  /** Whether a scan has completed successfully at least once */
  scanned: boolean;
  /** The scan result data (null if not scanned yet) */
  data: ScanData | null;
  /** Start a scan for the given URL */
  scan: (rawUrl: string) => Promise<ScanData | null>;
  /** Reset all state */
  reset: () => void;
};

export function useProductScan(): UseProductScanReturn {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [data, setData] = useState<ScanData | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearPhaseTimers = useCallback(() => {
    for (const t of phaseTimerRef.current) clearTimeout(t);
    phaseTimerRef.current = [];
  }, []);

  const startPhaseAnimation = useCallback(() => {
    clearPhaseTimers();
    let elapsed = 0;
    for (const p of PHASE_SEQUENCE) {
      const timer = setTimeout(() => setPhase(p), elapsed);
      phaseTimerRef.current.push(timer);
      elapsed += PHASE_TIMINGS_MS[p] ?? 2000;
    }
  }, [clearPhaseTimers]);

  const scan = useCallback(async (rawUrl: string): Promise<ScanData | null> => {
    let url = rawUrl.trim();
    if (!url) {
      toast.error("Enter a URL first");
      return null;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    setScanning(true);
    setScanned(false);
    setData(null);
    startPhaseAnimation();

    try {
      const res = await apiPost<ScanData>("/api/products/scan", { url });
      if (res.ok) {
        clearPhaseTimers();
        setPhase("done");
        setData(res.data);
        setScanned(true);
        return res.data;
      } else {
        clearPhaseTimers();
        setPhase("error");
        toast.error("Scan failed — fill in your details manually");
        return null;
      }
    } catch {
      clearPhaseTimers();
      setPhase("error");
      toast.error("Scan failed — fill in your details manually");
      return null;
    } finally {
      setScanning(false);
    }
  }, [startPhaseAnimation, clearPhaseTimers]);

  const reset = useCallback(() => {
    clearPhaseTimers();
    setPhase("idle");
    setScanning(false);
    setScanned(false);
    setData(null);
  }, [clearPhaseTimers]);

  return { phase, scanning, scanned, data, scan, reset };
}
