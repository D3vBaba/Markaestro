"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";

type ProductsResponse = {
  count: number;
};

export function useOnboardingStatus() {
  const { user, loading: authLoading } = useAuth();
  const [hasProducts, setHasProducts] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setHasProducts(false);
      setError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<ProductsResponse>("/api/products?limit=1");
      if (!res.ok) {
        setHasProducts(null);
        setError(true);
        return;
      }

      setHasProducts(Number(res.data.count) > 0);
      setError(false);
    } catch {
      setHasProducts(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [authLoading, refresh]);

  return {
    completed: hasProducts,
    error,
    hasProducts,
    loading: authLoading || loading,
    refresh,
  };
}
