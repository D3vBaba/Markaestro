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

const STATUS_CHIP: Record<string, string> = {
  active: "bg-mk-pos-soft text-mk-pos",
  beta: "bg-mk-accent-soft text-mk-accent",
  development: "bg-mk-warn-soft text-mk-warn",
  sunset: "bg-mk-neg-soft text-mk-neg",
  archived: "bg-muted text-mk-ink-80",
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
  ready: "bg-mk-pos ",
  warning: "bg-mk-warn",
  offline: "bg-mk-neg",
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
  const statusChip = STATUS_CHIP[product.status] ?? STATUS_CHIP.development;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: Math.min(index, 8) * 0.02 }}
      className="group relative h-full"
    >
      {highlighted && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl animate-pulse z-10 ring-2 ring-ring/40 ring-offset-2"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="relative flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-start transition-[border-color,transform] duration-150 ease-out-quart hover:border-mk-ink-20 active:scale-[0.99]"
        style={{ minHeight: 220 }}
      >

        <div className="relative flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          {/* Top row: logo + name + status */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {product.brandIdentity?.logoUrl ? (
                <img
                  src={product.brandIdentity.logoUrl}
                  alt={`${product.name} logo`}
                  className="size-10 shrink-0 rounded-lg border border-border bg-card object-contain p-1"
                />
              ) : (
                <div
                  className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-base font-semibold text-foreground"
                  style={dominant ? { background: `${dominant}1f`, color: dominant } : undefined}
                >
                  {product.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[15px] font-semibold text-foreground">
                  {product.name}
                </p>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {categories.map((c) => categoryLabel(c, tCategories)).join(" · ")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className={cn("rounded-md px-1.5 py-0.5 text-[11.5px] font-medium capitalize leading-4", statusChip)}>
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
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 size-7 rounded-lg grid place-items-center text-mk-ink-40 hover:text-mk-neg hover:bg-mk-neg-soft transition-[opacity,color,background-color] cursor-pointer"
                aria-label={t("deleteBrand")}
              >
                <Trash2 className="size-3.5" />
              </span>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <p className="m-0 mt-3 line-clamp-2 text-[13px] leading-5 text-mk-ink-80">
              {product.description}
            </p>
          )}

          {/* URL */}
          {product.url && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="size-3.5 shrink-0" />
              <span className="truncate">{stripProtocol(product.url)}</span>
            </div>
          )}

          {/* Divider + connection dots — pinned to bottom */}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
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
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11.5px] font-medium leading-4 text-mk-ink-80"
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${CHIP_DOT_CLASS[tone]}`}
                        />
                        {label}
                      </span>
                    );
                  })}
                  {overflowConnections.length > 0 && (
                    <span className="text-[11.5px] font-medium text-muted-foreground">
                      +{overflowConnections.length}
                    </span>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="size-3" />
                  {t("noChannelsConnected")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {product.createdAt && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {new Date(product.createdAt).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              <ChevronRight className="size-4 text-mk-ink-40 transition-colors group-hover:text-foreground rtl:rotate-180" />
            </div>
          </div>
        </div>
      </button>
    </motion.div>
  );
}
