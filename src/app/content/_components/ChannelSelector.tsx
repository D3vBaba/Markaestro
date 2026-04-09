"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

type IntegrationInfo = {
  provider: string;
  status: string;
  scope?: "workspace" | "product";
  pageId?: string | null;
  pageName?: string | null;
  igAccountId?: string | null;
  username?: string | null;
};

type ChannelState = "ready" | "needs-setup" | "disconnected";

const channels = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
] as const;

// Brand colors per channel for the active state border
const channelColors: Record<string, { active: string; dot: string }> = {
  facebook: { active: "border-[#1877F2] bg-[#1877F2] text-white", dot: "" },
  instagram: { active: "border-[#E1306C] bg-[#E1306C] text-white", dot: "" },
  tiktok:    { active: "border-[#EE1D52] bg-[#EE1D52] text-white", dot: "" },
};

const setupHintPrefix: Record<string, string> = {
  facebook: "Connect Meta and select a Facebook page in",
  instagram: "Connect Meta with a linked Instagram business account or connect Instagram directly in",
  tiktok: "Connect TikTok in",
};

// Simple SVG icons for each platform
function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  if (channel === "facebook") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }
  if (channel === "instagram") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    );
  }
  if (channel === "tiktok") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
      </svg>
    );
  }
  return null;
}

export default function ChannelSelector({
  value,
  onChange,
  productId,
}: {
  value: string;
  onChange: (channel: string) => void;
  productId?: string;
}) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!productId) {
        if (!cancelled) setIntegrations([]);
        return;
      }
      const res = await apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${productId}`);
      if (cancelled) return;
      if (res.ok) {
        setIntegrations(res.data.integrations?.filter((i) => i.scope === "product") || []);
      }
    })();
    return () => { cancelled = true; };
  }, [productId]);

  function channelState(ch: string): ChannelState {
    const meta = integrations.find((i) => i.provider === "meta");
    const instagram = integrations.find((i) => i.provider === "instagram");
    const metaOk = meta?.status === "connected";
    const instagramOk = instagram?.status === "connected" && !!instagram?.igAccountId;

    if (ch === "facebook") {
      if (!metaOk) return "disconnected";
      return meta?.pageId ? "ready" : "needs-setup";
    }
    if (ch === "instagram") {
      if (meta?.igAccountId || instagramOk) return "ready";
      if (metaOk) return "needs-setup";
      return "disconnected";
    }
    const conn = integrations.find((i) => i.provider === ch);
    return conn?.status === "connected" ? "ready" : "disconnected";
  }

  const selectedState = channelState(value);

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel</label>
      <div className="grid grid-cols-3 gap-2">
        {channels.map((ch) => {
          const state = channelState(ch.value);
          const selected = value === ch.value;
          const colors = channelColors[ch.value];

          return (
            <button
              key={ch.value}
              onClick={() => onChange(ch.value)}
              title={state !== "ready" ? `${setupHintPrefix[ch.value]} Products → Edit` : undefined}
              className={`relative flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm transition-all ${
                selected
                  ? (colors?.active ?? "border-foreground bg-foreground text-background") + " font-medium shadow-sm"
                  : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              <ChannelIcon channel={ch.value} size={13} />
              <span>{ch.label}</span>
              {/* Connection status dot */}
              <span
                className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                  state === "ready"
                    ? selected ? "bg-white/70" : "bg-emerald-500"
                    : state === "needs-setup"
                    ? selected ? "bg-white/70" : "bg-amber-400"
                    : "bg-muted-foreground/25"
                }`}
              />
            </button>
          );
        })}
      </div>
      {productId && selectedState === "needs-setup" && (
        <p className="text-[11px] text-amber-600">
          ⚠ {setupHintPrefix[value]}{" "}
          <Link href="/products" className="underline underline-offset-2 hover:opacity-80">
            Products → Edit
          </Link>
        </p>
      )}
      {productId && selectedState === "disconnected" && (
        <p className="text-[11px] text-muted-foreground">
          Not connected — {setupHintPrefix[value]}{" "}
          <Link href="/products" className="underline underline-offset-2 hover:opacity-80">
            Products → Edit
          </Link>
        </p>
      )}
    </div>
  );
}
