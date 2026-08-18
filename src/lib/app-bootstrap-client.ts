"use client";

import { apiFetch } from "@/lib/api-client";
import type { PlanTier } from "@/lib/stripe/plans";

export type BootstrapSubscriptionStatus = {
  active: boolean;
  hasSubscriptionHistory: boolean;
  tier: PlanTier | null;
  interval: string | null;
  trialing: boolean;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

export type AppBootstrapResponse = {
  completed: boolean;
  hasProducts: boolean;
  hasSubscriptionHistory: boolean;
  pendingInvites?: number;
  anyWorkspaceActivity?: boolean;
  subscriptionStatus: BootstrapSubscriptionStatus;
};

type ApiResult = Awaited<ReturnType<typeof apiFetch<AppBootstrapResponse>>>;

const CACHE_TTL_MS = 15_000;
const inFlight = new Map<string, Promise<ApiResult>>();
const cache = new Map<string, { value: ApiResult; expiresAt: number }>();

/** Share the shell's subscription/onboarding request across both providers. */
export function fetchAppBootstrap(workspaceId: string | null, force = false): Promise<ApiResult> {
  const key = workspaceId || "default";
  const pending = inFlight.get(key);
  if (pending) return pending;

  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (cached) cache.delete(key);

  const path = workspaceId
    ? `/api/onboarding/status?workspaceId=${encodeURIComponent(workspaceId)}`
    : "/api/onboarding/status";
  const request = apiFetch<AppBootstrapResponse>(path)
    .then((result) => {
      if (result.ok) cache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
