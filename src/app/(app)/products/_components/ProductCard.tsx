"use client";

import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { ChevronRight, Globe, Trash2, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLabel } from "./categories";
import type { ConnectionChipTone } from "@/lib/integrations/channel-status";

export type ProductCardData = {
  id: string;
  name: string;
  description: string;
  url: string;
  categories?: string[];
  category?: string;
  status: string;
  brandIdentity?: { logoUrl: string; primaryColor: string; secondaryColor: string; accentColor: string };
  createdAt?: string;
};

export type { ConnectionChipTone };

export type ConnectionChip = {
  provider: string;
  status: string;
  lastRefreshError?: string | null;
  pageName?: string | null;
  username?: string | null;
  /** Precomputed by resolveConnectionChipTone. Falls back conservatively. */
  tone?: ConnectionChipTone;
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  active: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200/60 dark:border-emerald-800/40",
  },
  beta: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200/60 dark:border-blue-800/40",
  },

  development: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200/60 dark:border-amber-800/40",
  },
  sunset: {
    bg: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-200/60 dark:border-rose-800/40",
  },
  archived: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-200 dark:border-slate-700",
  },
};

const providerShortLabels: Record<string, string> = {
  meta: "Meta",
  instagram: "IG",
  tiktok: "TikTok",
  threads: "Threads",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  x: "X",
};

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function getDominantColor(p: ProductCardData): string | null {
  const c = p.brandIdentity?.primaryColor;
  if (c && /^#[0-9A-Fa-f]{6}$/i.test(c)) return c;
  return null;
}

const MAX_VISIBLE_CONNECTIONS = 3;

const CHIP_DOT_CLASS: Record<ConnectionChipTone, string> = {
  ready: "bg-emerald-500 shadow-2xs",
  warning: "bg-amber-500",
  offline: "bg-rose-500",
};

function connectionChipTone(chip: ConnectionChip): ConnectionChipTone {
  if (chip.tone) return chip.tone;
  if (chip.lastRefreshError) return "warning";
  if (chip.status === "connected") return "ready";
  return "offline";
}

function connectionChipTitle(
  chip: ConnectionChip,
  tone: ConnectionChipTone,
  label: string,
  reconnectLabel: string,
): string {
  if (tone === "warning") return reconnectLabel;
  if (chip.pageName) return `${label} · ${chip.pageName}`;
  if (chip.username) return `${label} · @${chip.username}`;
  return label;
}

export default function ProductCard({
  product,
  connections,
  index,
  highlighted = false,
  onOpen,
  onDelete,
}: {
  product: ProductCardData;
  connections: ConnectionChip[];
  index: number;
  highlighted?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("products.productCard");
  const tCategories = useTranslations("products.categories");
  const tStatus = useTranslations("products.productStatus");
  const locale = useLocale();
  const dominant = getDominantColor(product);
  const visibleConnections = connections.slice(0, MAX_VISIBLE_CONNECTIONS);
  const overflowConnections = connections.slice(MAX_VISIBLE_CONNECTIONS);
  const categories = product.categories?.length
    ? product.categories
    : product.category
    ? [product.category]
    : ["saas"];
  const statusCfg = STATUS_CONFIG[product.status] ?? STATUS_CONFIG.development;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.03, ease: [0.23, 1, 0.32, 1] }}
      className="group relative h-full"
    >
      {highlighted && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl animate-pulse z-10 ring-2 ring-blue-500 ring-offset-2"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="relative w-full text-start overflow-hidden rounded-2xl flex flex-col bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md active:scale-[0.99] transition-[border-color,box-shadow,transform] duration-150 ease-out-quart cursor-pointer"
        style={{
          minHeight: 250,
          borderTop: `3px solid ${dominant || '#2563eb'}`,
        }}
      >

        <div className="relative p-5 flex-1 flex flex-col min-h-0">
          {/* Top row: logo + name + status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {product.brandIdentity?.logoUrl ? (
                <img
                  src={product.brandIdentity.logoUrl}
                  alt={`${product.name} logo`}
                  className="h-11 w-11 rounded-xl object-contain shrink-0 bg-white p-1 border border-slate-100 dark:border-slate-800 shadow-2xs"
                />
              ) : (
                <div
                  className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-base shadow-2xs border"
                  style={{
                    background: dominant ? `${dominant}15` : "rgba(37, 99, 235, 0.1)",
                    color: dominant || "#2563eb",
                    borderColor: dominant ? `${dominant}30` : "rgba(37, 99, 235, 0.2)",
                  }}
                >
                  {product.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold truncate text-slate-900 dark:text-slate-100 m-0">
                  {product.name}
                </p>
                <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5 truncate">
                  {categories.map((c) => categoryLabel(c, tCategories)).join(" · ")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={cn(
                  "text-[11px] font-semibold px-2.5 py-0.5 rounded-full border capitalize",
                  statusCfg.bg,
                  statusCfg.text,
                  statusCfg.border,
                )}
              >
                {tStatus.has(product.status) ? tStatus(product.status) : product.status}
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
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 rounded-lg grid place-items-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-[opacity,color,background-color] cursor-pointer"
                aria-label={t("deleteBrand")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <p className="mt-3 text-[13px] leading-relaxed line-clamp-2 text-slate-600 dark:text-slate-400 font-normal">
              {product.description}
            </p>
          )}

          {/* URL */}
          {product.url && (
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{stripProtocol(product.url)}</span>
            </div>
          )}

          {/* Divider + connection dots — pinned to bottom */}
          <div className="mt-auto pt-4 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-2 min-w-0">
              {connections.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {visibleConnections.map((c) => {
                    const tone = connectionChipTone(c);
                    const label = providerShortLabels[c.provider] || c.provider;
                    const title = connectionChipTitle(
                      c,
                      tone,
                      label,
                      t("reconnectNeeded", { label }),
                    );
                    return (
                      <span
                        key={c.provider}
                        title={title}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 rounded-md px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800"
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${CHIP_DOT_CLASS[tone]}`}
                        />
                        {label}
                      </span>
                    );
                  })}
                  {overflowConnections.length > 0 && (
                    <span className="text-[11px] font-semibold text-slate-400">
                      +{overflowConnections.length}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400 italic flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  {t("noChannelsConnected")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {product.createdAt && (
                <span className="text-xs text-slate-400 font-medium">
                  {new Date(product.createdAt).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-[color,transform] duration-150" />
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
