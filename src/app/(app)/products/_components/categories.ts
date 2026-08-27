import type { ProductCategory } from "@/lib/schemas";
import type { useTranslations } from "next-intl";

// Canonical set of category keys with English fallback labels (used only if a
// translation lookup fails). Keys must stay in sync with `productCategories`
// in src/lib/schemas.ts. Display labels normally come from
// messages/{locale}/appProducts.json under `categories.<key>`.
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  saas: "SaaS",
  mobile: "Mobile App",
  web: "Web App",
  api: "API",
  marketplace: "Marketplace",
  ecommerce: "E-commerce",
  fintech: "Fintech",
  healthtech: "Health Tech",
  edtech: "Ed Tech",
  gaming: "Gaming",
  social: "Social",
  productivity: "Productivity",
  "developer-tools": "Developer Tools",
  ai: "AI",
  media: "Media",
  agency: "Agency",
  creator: "Creator",
  hardware: "Hardware",
  nonprofit: "Nonprofit",
  "local-business": "Local Business",
  "personal-brand": "Personal Brand",
  "fashion-beauty": "Fashion & Beauty",
  "food-restaurant": "Food & Restaurant",
  "music-entertainment": "Music & Entertainment",
  "real-estate": "Real Estate",
  "coaching-services": "Coaching & Services",
  fitness: "Fitness",
  "travel-hospitality": "Travel & Hospitality",
  other: "Other",
};

// A stable accent color per category, used as the dot in the premium dropdown.
const CATEGORY_PALETTE = [
  "#2563EB", "#0EA5E9", "#22C55E", "#F59E0B", "#EC4899",

  "#14B8A6", "#8B5CF6", "#EF4444", "#10B981", "#3B82F6",
  "#F97316", "#A855F7", "#06B6D4", "#84CC16", "#E11D48",
  "#0D9488", "#7C3AED", "#DB2777", "#65A30D", "#475569",
  "#D97706", "#BE185D", "#0284C7", "#4D7C0F", "#9333EA",
  "#B91C1C", "#0F766E", "#C2410C", "#1D4ED8", "#57534E",
];

export type CategoryOption = { value: ProductCategory; color: string };

export const PRODUCT_CATEGORY_KEYS = Object.keys(PRODUCT_CATEGORY_LABELS) as ProductCategory[];

export const PRODUCT_CATEGORY_OPTIONS: CategoryOption[] = PRODUCT_CATEGORY_KEYS.map((value, i) => ({
  value,
  color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
}));

type CategoryTranslator = ReturnType<typeof useTranslations>;

export function categoryLabel(value: string, t?: CategoryTranslator): string {
  if (t && t.has(value)) return t(value);
  return PRODUCT_CATEGORY_LABELS[value as ProductCategory] || value;
}

export function categoryColor(value: string): string {
  return PRODUCT_CATEGORY_OPTIONS.find((o) => o.value === value)?.color || "var(--mk-ink-40)";
}
