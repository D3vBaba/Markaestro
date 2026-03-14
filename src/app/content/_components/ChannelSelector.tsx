"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

type IntegrationInfo = {
  provider: string;
  status: string;
  scope?: "workspace" | "product";
};

const channels = [
  { value: "x", label: "X (Twitter)" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
] as const;

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
    (async () => {
      const path = productId ? `/api/integrations?productId=${productId}` : "/api/integrations";
      const res = await apiGet<{ integrations: IntegrationInfo[] }>(path);
      if (!res.ok) {
        setIntegrations([]);
        return;
      }

      const all = res.data.integrations || [];
      setIntegrations(productId ? all.filter((i) => i.scope === "product") : all);
    })();
  }, [productId]);

  const isConnected = (provider: string) => {
    const direct = integrations.find((i) => i.provider === provider)?.status === "connected";
    if (direct) return true;
    if (provider === "facebook" || provider === "instagram") {
      return integrations.find((i) => i.provider === "meta")?.status === "connected";
    }
    return false;
  };

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {channels.map((ch) => {
          const connected = isConnected(ch.value);
          const selected = value === ch.value;
          return (
            <button
              key={ch.value}
              onClick={() => onChange(ch.value)}
              className={`relative py-3 px-4 rounded-lg border text-sm transition-all text-center ${
                selected
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {ch.label}
              <span
                className={`absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-muted-foreground/30"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
