"use client";

import { useEffect, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api-client";

type IntegrationInfo = {
  provider: string;
  status: string;
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
      // Fetch workspace-level integrations
      const res = await apiGet<{ integrations: IntegrationInfo[] }>("/api/integrations");
      let all = res.ok ? res.data.integrations || [] : [];

      // Also fetch product-level integrations if a product is selected
      if (productId) {
        const prodRes = await apiGet<{ integrations: IntegrationInfo[] }>(
          `/api/integrations?productId=${productId}`
        );
        if (prodRes.ok) {
          const prodIntegrations = prodRes.data.integrations || [];
          // Merge: product-level overrides workspace-level for the same provider
          const merged = new Map(all.map((i) => [i.provider, i]));
          for (const pi of prodIntegrations) {
            merged.set(pi.provider, pi);
          }
          all = Array.from(merged.values());
        }
      }

      setIntegrations(all);
    })();
  }, [productId]);

  const isConnected = (provider: string) => {
    // Check direct provider connection
    const direct = integrations.find((i) => i.provider === provider)?.status === "connected";
    if (direct) return true;
    // For facebook/instagram, also check unified meta OAuth
    if (provider === "facebook" || provider === "instagram") {
      return integrations.find((i) => i.provider === "meta")?.status === "connected";
    }
    return false;
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Channel</label>
      <RadioGroup value={value} onValueChange={onChange} className="grid gap-2">
        {channels.map((ch) => (
          <div key={ch.value} className="flex items-center space-x-3 rounded-md border p-3">
            <RadioGroupItem value={ch.value} id={`channel-${ch.value}`} />
            <Label htmlFor={`channel-${ch.value}`} className="flex-1 cursor-pointer text-sm">
              {ch.label}
            </Label>
            <Badge
              variant="outline"
              className={
                isConnected(ch.value)
                  ? "bg-emerald-50 text-emerald-700 border-0 text-[10px]"
                  : "bg-gray-50 text-gray-500 border-0 text-[10px]"
              }
            >
              {isConnected(ch.value) ? "Connected" : "Not connected"}
            </Badge>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
