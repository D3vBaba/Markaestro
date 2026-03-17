"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

type IntegrationInfo = {
  provider: string;
  status: string;
  scope?: "workspace" | "product";
  pageId?: string | null;
  pageName?: string | null;
  igAccountId?: string | null;
};

type ChannelState = "ready" | "needs-setup" | "disconnected";

const channels = [
  { value: "x", label: "X (Twitter)" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
] as const;

const setupHint: Record<string, string> = {
  facebook: "Connect Meta and select a Facebook page in Products → Edit",
  instagram: "Connect Meta with a linked Instagram business account in Products → Edit",
  x: "Connect X (Twitter) in Products → Edit",
  tiktok: "Connect TikTok in Products → Edit",
};

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
    if (!productId) { setIntegrations([]); return; }
    (async () => {
      const res = await apiGet<{ integrations: IntegrationInfo[] }>(`/api/integrations?productId=${productId}`);
      if (res.ok) {
        setIntegrations(res.data.integrations?.filter((i) => i.scope === "product") || []);
      }
    })();
  }, [productId]);

  function channelState(ch: string): ChannelState {
    const meta = integrations.find((i) => i.provider === "meta");
    const metaOk = meta?.status === "connected";

    if (ch === "facebook") {
      if (!metaOk) return "disconnected";
      return meta?.pageId ? "ready" : "needs-setup";
    }
    if (ch === "instagram") {
      if (!metaOk) return "disconnected";
      return meta?.igAccountId ? "ready" : "needs-setup";
    }
    const conn = integrations.find((i) => i.provider === ch);
    return conn?.status === "connected" ? "ready" : "disconnected";
  }

  const selectedState = channelState(value);

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {channels.map((ch) => {
          const state = channelState(ch.value);
          const selected = value === ch.value;
          return (
            <button
              key={ch.value}
              onClick={() => onChange(ch.value)}
              title={state !== "ready" ? setupHint[ch.value] : undefined}
              className={`relative py-3 px-4 rounded-lg border text-sm transition-all text-center ${
                selected
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {ch.label}
              <span
                className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                  state === "ready"
                    ? "bg-emerald-500"
                    : state === "needs-setup"
                    ? "bg-amber-400"
                    : "bg-muted-foreground/30"
                }`}
              />
            </button>
          );
        })}
      </div>
      {productId && selectedState === "needs-setup" && (
        <p className="text-[11px] text-amber-600">⚠ {setupHint[value]}</p>
      )}
      {productId && selectedState === "disconnected" && (
        <p className="text-[11px] text-muted-foreground">Not connected — {setupHint[value]}</p>
      )}
    </div>
  );
}
