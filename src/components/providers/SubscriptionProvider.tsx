"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiFetch } from '@/lib/api-client';
import type { PlanTier } from '@/lib/stripe/plans';
import { PLANS } from '@/lib/stripe/plans';

type SubscriptionStatus = {
  active: boolean;
  hasSubscriptionHistory: boolean;
  tier: PlanTier | null;
  interval: string | null;
  trialing: boolean;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

type SubscriptionCtx = {
  status: SubscriptionStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  trialDaysLeft: number | null;
  canAccess: (feature: keyof typeof PLANS.starter.gated) => boolean;
  getLimit: (limit: keyof typeof PLANS.starter.limits) => number;
};

const defaultStatus: SubscriptionStatus = {
  active: false,
  hasSubscriptionHistory: false,
  tier: null,
  interval: null,
  trialing: false,
  trialEnd: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
};

const Ctx = createContext<SubscriptionCtx | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<SubscriptionStatus>('/api/stripe/status');
      if (res.ok) {
        setStatus(res.data);
      } else {
        setStatus(defaultStatus);
      }
    } catch {
      setStatus(defaultStatus);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    fetchStatus();
  }, [authLoading, fetchStatus]);

  const trialDaysLeft = useMemo(() => {
    if (!status?.trialing || !status.trialEnd) return null;
    const end = new Date(status.trialEnd).getTime();
    const now = Date.now();
    const days = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    return days;
  }, [status]);

  const canAccess = useCallback(
    (feature: keyof typeof PLANS.starter.gated): boolean => {
      if (!status?.active || !status.tier) return false;
      const plan = PLANS[status.tier];
      if (!plan) return false;
      return plan.gated[feature];
    },
    [status],
  );

  const getLimit = useCallback(
    (limit: keyof typeof PLANS.starter.limits): number => {
      if (!status?.active || !status.tier) return 0;
      const plan = PLANS[status.tier];
      if (!plan) return 0;
      return plan.limits[limit];
    },
    [status],
  );

  const value = useMemo<SubscriptionCtx>(
    () => ({ status, loading, refresh: fetchStatus, trialDaysLeft, canAccess, getLimit }),
    [status, loading, fetchStatus, trialDaysLeft, canAccess, getLimit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
