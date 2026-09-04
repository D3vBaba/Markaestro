"use client";

import { ChannelGlyph } from "@/components/app/ChannelGlyph";

const platforms = [
  { provider: "instagram", label: "Instagram" },
  { provider: "meta", label: "Facebook" },
  { provider: "tiktok", label: "TikTok" },
  { provider: "linkedin", label: "LinkedIn" },
  { provider: "threads", label: "Threads" },
  { provider: "pinterest", label: "Pinterest" },
  { provider: "x", label: "X" },
] as const;

export default function PlatformLogoRail({ label }: { label: string }) {
  return (
    <div className="mx-auto mt-10 max-w-4xl">
      <p className="text-center text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="mk-logo-marquee mt-4 overflow-hidden" role="list" aria-label={label}>
        <div className="mk-logo-marquee-track flex w-max">
          {[0, 1].map((setIndex) => (
            <div
              key={setIndex}
              className="flex shrink-0 gap-2.5 pr-2.5"
              aria-hidden={setIndex === 1 ? true : undefined}
            >
              {platforms.map((platform) => (
                <div
                  key={`${setIndex}-${platform.provider}`}
                  className="flex min-w-[148px] items-center gap-3 rounded-xl border border-mk-rule bg-mk-paper px-4 py-3"
                  role={setIndex === 0 ? "listitem" : undefined}
                >
                  <ChannelGlyph provider={platform.provider} size={36} />
                  <span className="text-[12px] font-semibold text-mk-ink-80">{platform.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
