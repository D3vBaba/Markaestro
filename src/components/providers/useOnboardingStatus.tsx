"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { apiFetch } from "@/lib/api-client";

type OnboardingStatusResponse = {
  completed: boolean;
  hasProducts: boolean;
  hasSubscriptionHistory: boolean;
};

export function useOnboardingStatus() {
  const { user, loading: authLoading } = useAuth();
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [hasProducts, setHasProducts] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setCompleted(false);
      setHasProducts(false);
      setError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // `/api/onboarding/status` treats an account as onboarded when it has
      // EITHER a product OR an active subscription/entitlement — so comped
      // and paid accounts clear the gate without first creating a product.
      const res = await apiFetch<OnboardingStatusResponse>("/api/onboarding/status");
      if (!res.ok) {
        setCompleted(null);
        setHasProducts(null);
        setError(true);
        return;
      }

      setCompleted(Boolean(res.data.completed));
      setHasProducts(Boolean(res.data.hasProducts));
      setError(false);
    } catch {
      setCompleted(null);
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
    completed,
    error,
    hasProducts,
    loading: authLoading || loading,
    refresh,
  };
}
