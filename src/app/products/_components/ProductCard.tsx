"use client";

import { motion } from "framer-motion";
import { ChevronRight, Globe, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProductCardData = {
  id: string;
  name: string;
  description: string;
  url: string;
  categories?: string[];
  category?: string;
  status: string;
  pricingTier: string;
  tags: string[];
  brandIdentity?: { logoUrl: string; primaryColor: string; secondaryColor: string; accentColor: string };
  createdAt?: string;
};

export type ConnectionChip = {
  provider: string;
  status: string;
  lastRefreshError?: string | null;
  pageName?: string | null;
  username?: string | null;
};

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  active:      { bg: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-pos) 60%, var(--mk-ink))" },
  beta:        { bg: "var(--mk-accent-soft)", fg: "var(--mk-accent)" },
  development: { bg: "color-mix(in oklch, var(--mk-warn) 18%, var(--mk-paper))", fg: "color-mix(in oklch, var(--mk-warn) 60%, var(--mk-ink))" },
  sunset:      { bg: "color-mix(in oklch, var(--mk-neg) 12%, var(--mk-paper))", fg: "var(--mk-neg)" },
  archived:    { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" },
};

const categoryLabels: Record<string, string> = {
  saas: "SaaS",
  mobile: "Mobile",
  web: "Web",
  api: "API",
  marketplace: "Marketplace",
  other: "Other",
};

const providerShortLabels: Record<string, string> = {
  meta: "Meta",
  instagram: "IG",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function getDominantColor(p: ProductCardData): string | null {
  const c = p.brandIdentity?.primaryColor;
  if (c && /^#[0-9A-Fa-f]{6}$/i.test(c)) return c;
  return null;
}

export default function ProductCard({
  product,
  connections,
  index,
  onOpen,
  onDelete,
}: {
  product: ProductCardData;
  connections: ConnectionChip[];
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const dominant = getDominantColor(product);
  const categories = product.categories?.length
    ? product.categories
    : product.category
    ? [product.category]
    : ["saas"];
  const pill = STATUS_PILL[product.status] ?? { bg: "var(--mk-panel)", fg: "var(--mk-ink-60)" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.03, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group relative"
    >
      <button
        onClick={onOpen}
        className="relative w-full text-left overflow-hidden transition-colors rounded-xl"
        style={{
          background: "var(--mk-paper)",
          border: "1px solid var(--mk-rule)",
        }}
      >
        <div className="relative p-4">
          {/* Top row: logo + name + status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {product.brandIdentity?.logoUrl ? (
                <img
                  src={product.brandIdentity.logoUrl}
                  alt={`${product.name} logo`}
                  className="h-10 w-10 rounded-lg object-contain shrink-0"
                  style={{
                    background: "var(--mk-paper)",
                    border: "1px solid var(--mk-rule)",
                  }}
                />
              ) : (
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 font-semibold"
                  style={{
                    background: dominant ? `${dominant}14` : "var(--mk-panel)",
                    color: dominant || "var(--mk-ink-80)",
                    border: "1px solid var(--mk-rule)",
                    fontSize: 14,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {product.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className="text-[14px] font-semibold truncate m-0"
                  style={{ color: "var(--mk-ink)", letterSpacing: "-0.015em" }}
                >
                  {product.name}
                </p>
                <div
                  className="mt-1 text-[11px] font-mono uppercase flex items-center gap-1.5"
                  style={{ color: "var(--mk-ink-40)", letterSpacing: "0.14em" }}
                >
                  <span className="truncate">
                    {categories.map((c) => categoryLabels[c] || c).join(" · ")}
                  </span>
                  {product.pricingTier && (
                    <>
                      <span style={{ color: "var(--mk-ink-20)" }}>·</span>
                      <span className="truncate normal-case tracking-normal font-sans text-[11px]">
                        {product.pricingTier.split(",")[0].trim()}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="text-[11px] font-medium whitespace-nowrap capitalize"
                style={{
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: pill.bg,
                  color: pill.fg,
                  letterSpacing: "-0.005em",
                }}
              >
                {product.status}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onDelete();
                  }
                }}
                className={cn(
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "h-6 w-6 rounded grid place-items-center cursor-pointer",
                  "hover:text-mk-neg",
                )}
                style={{ color: "var(--mk-ink-40)" }}
                aria-label="Delete product"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <p
              className="mt-3 text-[13px] leading-relaxed line-clamp-2"
              style={{ color: "var(--mk-ink-60)", letterSpacing: "-0.005em" }}
            >
              {product.description}
            </p>
          )}

          {/* URL */}
          {product.url && (
            <div
              className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono"
              style={{ color: "var(--mk-ink-40)", letterSpacing: "0.02em" }}
            >
              <Globe className="h-3 w-3" />
              <span className="truncate">{stripProtocol(product.url)}</span>
            </div>
          )}

          {/* Tags */}
          {product.tags && product.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {product.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px]"
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--mk-panel)",
                    color: "var(--mk-ink-60)",
                    border: "1px solid var(--mk-rule-soft)",
                  }}
                >
                  {tag}
                </span>
              ))}
              {product.tags.length > 4 && (
                <span
                  className="text-[10px] px-1.5 py-0.5"
                  style={{ color: "var(--mk-ink-40)" }}
                >
                  +{product.tags.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Divider + connection dots */}
          <div
            className="mt-3.5 pt-3 flex items-center justify-between gap-3 border-t"
            style={{ borderColor: "var(--mk-rule-soft)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {connections.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {connections.map((c) => {
                    const isConnected = c.status === "connected";
                    const hasError = !!c.lastRefreshError;
                    const label = providerShortLabels[c.provider] || c.provider;
                    const title = hasError
                      ? `${label} — reconnect needed`
                      : c.pageName
                      ? `${label} · ${c.pageName}`
                      : c.username
                      ? `${label} · @${c.username}`
                      : label;
                    const dotColor =
                      isConnected && !hasError
                        ? "var(--mk-pos)"
                        : hasError
                        ? "var(--mk-warn)"
                        : "var(--mk-neg)";
                    return (
                      <span
                        key={c.provider}
                        title={title}
                        className="inline-flex items-center gap-1 text-[10.5px] font-medium"
                        style={{ color: "var(--mk-ink-60)" }}
                      >
                        <span
                          className="inline-block rounded-full"
                          style={{ width: 6, height: 6, background: dotColor }}
                        />
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span
                  className="text-[10.5px] italic"
                  style={{ color: "var(--mk-ink-40)" }}
                >
                  No channels connected
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {product.createdAt && (
                <span
                  className="text-[10px] font-mono tabular-nums"
                  style={{ color: "var(--mk-ink-40)", letterSpacing: "0.04em" }}
                >
                  {new Date(product.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                style={{ color: "var(--mk-ink-40)" }}
              />
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
