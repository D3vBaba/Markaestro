"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Globe, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  beta: "bg-blue-50 text-blue-700",
  development: "bg-amber-50 text-amber-700",
  sunset: "bg-rose-50 text-rose-700",
  archived: "bg-gray-100 text-gray-600",
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group relative"
    >
      <button
        onClick={onOpen}
        className={cn(
          "relative w-full text-left overflow-hidden",
          "rounded-2xl border border-border/40 bg-card",
          "transition-all duration-300",
          "hover:border-foreground/25 hover:shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)]",
          "hover:-translate-y-0.5",
        )}
      >
        {/* Brand-color accent strip at the top */}
        <div
          aria-hidden
          className="absolute top-0 left-0 right-0 h-1 opacity-70 group-hover:opacity-100 transition-opacity"
          style={{
            background: dominant
              ? `linear-gradient(90deg, ${dominant} 0%, ${dominant}cc 50%, transparent 100%)`
              : "linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)",
          }}
        />

        {/* Subtle brand-tint wash on hover */}
        {dominant && (
          <div
            aria-hidden
            className="absolute inset-0 opacity-0 group-hover:opacity-[0.04] transition-opacity duration-500 pointer-events-none"
            style={{ background: `radial-gradient(circle at top right, ${dominant}, transparent 70%)` }}
          />
        )}

        <div className="relative p-5">
          {/* Top row — logo + actions */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {product.brandIdentity?.logoUrl ? (
                <div className="relative shrink-0">
                  <div
                    className="absolute inset-0 rounded-xl blur-md opacity-0 group-hover:opacity-30 transition-opacity"
                    style={{ background: dominant || "rgba(0,0,0,0.2)" }}
                  />
                  <img
                    src={product.brandIdentity.logoUrl}
                    alt={`${product.name} logo`}
                    className="relative h-11 w-11 rounded-xl object-contain border border-border/40 bg-white shrink-0"
                  />
                </div>
              ) : (
                <div
                  className="h-11 w-11 rounded-xl border border-border/40 flex items-center justify-center shrink-0 transition-colors"
                  style={{
                    backgroundColor: dominant ? `${dominant}12` : undefined,
                    color: dominant || undefined,
                  }}
                >
                  <span className="text-sm font-semibold tracking-tight">
                    {product.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground tracking-tight truncate">
                  {product.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {categories.map((c) => categoryLabels[c] || c).join(" · ")}
                  </span>
                  {product.pricingTier && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="truncate">{product.pricingTier.split(",")[0].trim()}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant="outline"
                className={cn(
                  "capitalize border-0 text-[10px] font-medium",
                  statusColors[product.status] || "",
                )}
              >
                {product.status}
              </Badge>
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
                className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/5 cursor-pointer"
                aria-label="Delete product"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed line-clamp-2">
              {product.description}
            </p>
          )}

          {/* URL */}
          {product.url && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
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
                  className="px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground text-[10px] tracking-wide border border-border/30"
                >
                  {tag}
                </span>
              ))}
              {product.tags.length > 4 && (
                <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                  +{product.tags.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between gap-3">
            {/* Connection dots */}
            <div className="flex items-center gap-1.5 min-w-0">
              {connections.length > 0 ? (
                <div className="flex items-center gap-1.5">
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
                    return (
                      <span
                        key={c.provider}
                        title={title}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            isConnected && !hasError
                              ? "bg-emerald-500"
                              : hasError
                              ? "bg-amber-500"
                              : "bg-rose-400",
                          )}
                        />
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground/60 italic">
                  No channels connected
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {product.createdAt && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                  {new Date(product.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
