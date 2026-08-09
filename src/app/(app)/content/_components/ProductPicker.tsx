"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api-client";

type Product = {
  id: string;
  name: string;
  description: string;
  brandVoice?: {
    tone: string;
    style: string;
    targetAudience: string;
  };
};

export default function ProductPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (productId: string) => void;
}) {
  const t = useTranslations("content.productPicker");
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    (async () => {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (res.ok) setProducts(res.data.products || []);
    })();
  }, []);

  const selected = products.find((p) => p.id === value);

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("brand")}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-lg border border-border/60 bg-background px-3 text-sm focus:border-foreground focus:outline-none transition-colors"
      >
        <option value="">{t("selectBrand")}</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selected?.brandVoice && (
        <div className="rounded-lg border border-border/30 p-4 text-xs text-muted-foreground space-y-1.5">
          {selected.brandVoice.tone && <p><span className="font-medium text-foreground/70">{t("tone")}</span> {selected.brandVoice.tone}</p>}
          {selected.brandVoice.style && <p><span className="font-medium text-foreground/70">{t("style")}</span> {selected.brandVoice.style}</p>}
          {selected.brandVoice.targetAudience && <p><span className="font-medium text-foreground/70">{t("audience")}</span> {selected.brandVoice.targetAudience}</p>}
        </div>
      )}
    </div>
  );
}
