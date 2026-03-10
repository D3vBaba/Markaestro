"use client";

import { useEffect, useState } from "react";
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
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    (async () => {
      const res = await apiGet<{ products: Product[] }>("/api/products");
      if (res.ok) setProducts(res.data.products || []);
    })();
  }, []);

  const selected = products.find((p) => p.id === value);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Product</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select a product...</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selected?.brandVoice && (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          {selected.brandVoice.tone && <p><span className="font-medium">Tone:</span> {selected.brandVoice.tone}</p>}
          {selected.brandVoice.style && <p><span className="font-medium">Style:</span> {selected.brandVoice.style}</p>}
          {selected.brandVoice.targetAudience && <p><span className="font-medium">Audience:</span> {selected.brandVoice.targetAudience}</p>}
        </div>
      )}
    </div>
  );
}
