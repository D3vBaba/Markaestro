import type { ProductCategory } from "@/lib/schemas";

// Display labels for every product category. Keys must stay in sync with
// `productCategories` in src/lib/schemas.ts.
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
  other: "Other",
};

// A stable accent color per category, used as the dot in the premium dropdown.
const CATEGORY_PALETTE = [
  "#6366F1", "#0EA5E9", "#22C55E", "#F59E0B", "#EC4899",
  "#14B8A6", "#8B5CF6", "#EF4444", "#10B981", "#3B82F6",
  "#F97316", "#A855F7", "#06B6D4", "#84CC16", "#E11D48",
  "#0D9488", "#7C3AED", "#DB2777", "#65A30D", "#475569",
];

export type CategoryOption = { value: ProductCategory; label: string; color: string };

export const PRODUCT_CATEGORY_OPTIONS: CategoryOption[] = (
  Object.keys(PRODUCT_CATEGORY_LABELS) as ProductCategory[]
).map((value, i) => ({
  value,
  label: PRODUCT_CATEGORY_LABELS[value],
  color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
}));

export function categoryLabel(value: string): string {
  return PRODUCT_CATEGORY_LABELS[value as ProductCategory] || value;
}

export function categoryColor(value: string): string {
  return PRODUCT_CATEGORY_OPTIONS.find((o) => o.value === value)?.color || "var(--mk-ink-40)";
}
