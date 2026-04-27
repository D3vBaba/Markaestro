"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";
import { socialChannelCatalog } from "@/lib/social/channel-catalog";

type ChannelState = "ready" | "needs_setup" | "disconnected";

type ChannelInfo = {
  channel: string;
  label: string;
  state: ChannelState;
  reason: string | null;
  destinationLabel: string | null;
};

const fallbackChannels: ChannelInfo[] = socialChannelCatalog.map((channel) => ({
  channel: channel.channel,
  label: channel.label,
  state: "disconnected",
  reason: channel.setupHint,
  destinationLabel: null,
}));

// Brand colors per channel for the active state border
const channelColors: Record<string, { active: string; dot: string }> = {
  facebook:  { active: "border-[#1877F2] bg-[#1877F2] text-white", dot: "" },
  instagram: { active: "border-[#E1306C] bg-[#E1306C] text-white", dot: "" },
  tiktok:    { active: "border-[#EE1D52] bg-[#EE1D52] text-white", dot: "" },
  linkedin:  { active: "border-[#0A66C2] bg-[#0A66C2] text-white", dot: "" },
  threads:   { active: "border-black bg-black text-white", dot: "" },
  pinterest: { active: "border-[#E60023] bg-[#E60023] text-white", dot: "" },
  youtube:   { active: "border-[#FF0000] bg-[#FF0000] text-white", dot: "" },
  x:         { active: "border-black bg-black text-white", dot: "" },
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
  if (channel === "linkedin") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.602 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    );
  }
  if (channel === "threads") {
    return (
      <svg width={size} height={size} viewBox="0 0 192 192" fill="currentColor">
        <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1-.114-.001-.225-.001-.34-.001-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548.076 0 .153 0 .228.001 8.25.053 14.473 2.453 18.502 7.129 2.933 3.403 4.894 8.108 5.864 14.051-7.296-1.242-15.187-1.624-23.63-1.138-23.786 1.371-39.082 15.243-38.055 34.532.521 9.785 5.395 18.202 13.722 23.707 7.042 4.652 16.105 6.931 25.53 6.419 12.454-.676 22.218-5.426 29.02-14.115 5.166-6.6 8.433-15.157 9.879-25.947 5.937 3.583 10.337 8.298 12.767 13.964 4.133 9.63 4.373 25.439-8.518 38.318-11.288 11.282-24.855 16.164-45.367 16.315-22.76-.169-39.965-7.466-51.135-21.687-10.458-13.317-15.86-32.546-16.062-57.145.203-24.6 5.604-43.829 16.062-57.145 11.17-14.221 28.374-21.518 51.134-21.687 22.917.171 40.42 7.5 52.026 21.783 5.69 7.004 9.981 15.815 12.81 26.081l16.891-4.535c-3.433-12.611-8.817-23.515-16.116-32.498C153.164 10.589 131.295 1.222 103.5 1.03h-.118c-27.737.192-49.362 9.575-64.268 27.886C25.857 45.204 19.184 67.921 18.9 95.969l-.008.03.008.03c.285 28.048 6.958 50.766 20.214 67.053 14.906 18.312 36.531 27.695 64.268 27.887h.118c24.656-.172 42.034-6.618 56.348-20.9 18.727-18.683 18.164-42.104 11.951-56.604-4.456-10.402-12.513-18.835-23.302-24.485zm-43.107 28.79c-10.425.583-21.257-4.095-21.788-14.125-.394-7.433 5.251-15.728 22.407-16.716 1.963-.114 3.884-.168 5.773-.168 6.213 0 12.023.606 17.308 1.764-1.973 24.647-13.536 28.702-23.7 29.245z" />
      </svg>
    );
  }
  if (channel === "pinterest") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z" />
      </svg>
    );
  }
  if (channel === "youtube") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  if (channel === "x") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  return null;
}

export default function ChannelSelector({
  value,
  onChange,
  productId,
  selectedChannels,
  onSelectedChannelsChange,
}: {
  value: string;
  onChange: (channel: string) => void;
  productId?: string;
  selectedChannels?: string[];
  onSelectedChannelsChange?: (channels: string[]) => void;
}) {
  const [managedChannels, setManagedChannels] = useState<ChannelInfo[]>(fallbackChannels);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!productId) {
        if (!cancelled) setManagedChannels(fallbackChannels);
        return;
      }
      const res = await apiGet<{ channels: ChannelInfo[] }>(`/api/social/channels?productId=${productId}`);
      if (cancelled) return;
      if (res.ok) {
        setManagedChannels(res.data.channels?.length ? res.data.channels : fallbackChannels);
      }
    })();
    return () => { cancelled = true; };
  }, [productId]);

  function channelState(ch: string): ChannelState {
    return managedChannels.find((item) => item.channel === ch)?.state ?? "disconnected";
  }

  function channelReason(ch: string) {
    return managedChannels.find((item) => item.channel === ch)?.reason || "Connect this channel in product settings.";
  }

  const selected = selectedChannels?.length ? selectedChannels : [value];
  const selectedSet = new Set(selected);
  const selectedState = channelState(value);
  const channels = managedChannels.length ? managedChannels : fallbackChannels;

  function toggleChannel(ch: string) {
    if (!onSelectedChannelsChange) {
      onChange(ch);
      return;
    }

    const next = selectedSet.has(ch)
      ? selected.filter((item) => item !== ch)
      : [...selected, ch];
    const normalized = next.length > 0 ? next : [ch];
    onSelectedChannelsChange(normalized);
    onChange(normalized[0]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channels</label>
        {onSelectedChannelsChange && (
          <span className="text-[11px] text-muted-foreground">
            {selected.length} selected
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {channels.map((ch) => {
          const state = channelState(ch.channel);
          const isSelected = selectedSet.has(ch.channel);
          const colors = channelColors[ch.channel];

          return (
            <button
              key={ch.channel}
              onClick={() => toggleChannel(ch.channel)}
              title={state !== "ready" ? channelReason(ch.channel) : ch.destinationLabel ?? undefined}
              className={`relative flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm transition-all ${
                isSelected
                  ? (colors?.active ?? "border-foreground bg-foreground text-background") + " font-medium shadow-sm"
                  : "border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              <ChannelIcon channel={ch.channel} size={13} />
              <span>{ch.label}</span>
              {/* Connection status dot */}
              <span
                className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    state === "ready"
                      ? (isSelected ? "rgba(255,255,255,0.7)" : "var(--mk-pos)")
                      : state === "needs_setup"
                      ? (isSelected ? "rgba(255,255,255,0.7)" : "var(--mk-warn)")
                      : "var(--mk-ink-20)",
                }}
              />
            </button>
          );
        })}
      </div>
      {productId && selectedState === "needs_setup" && (
        <p className="text-[11px]" style={{ color: "var(--mk-warn)" }}>
          {channelReason(value)}{" "}
          <Link href="/products" className="underline underline-offset-2 hover:opacity-80">
            Product settings
          </Link>
        </p>
      )}
      {productId && selectedState === "disconnected" && (
        <p className="text-[11px] text-muted-foreground">
          {channelReason(value)}{" "}
          <Link href="/products" className="underline underline-offset-2 hover:opacity-80">
            Product settings
          </Link>
        </p>
      )}
    </div>
  );
}
