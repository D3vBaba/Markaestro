"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { deferFromEffect } from "@/lib/defer-from-effect";
import { fetchAppBootstrap } from "@/lib/app-bootstrap-client";

export function useOnboardingStatus() {
  const { user, loading: authLoading } = useAuth();
  const { current: currentWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? null;
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [hasProducts, setHasProducts] = useState<boolean | null>(null);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [anyWorkspaceActivity, setAnyWorkspaceActivity] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async (force = false) => {
    if (!user) {
      setCompleted(false);
      setHasProducts(false);
      setPendingInvites(0);
      setAnyWorkspaceActivity(false);
      setError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // `/api/onboarding/status` treats an account as onboarded when it has
      // EITHER a product OR an active subscription/entitlement — so comped
      // and paid accounts clear the gate without first creating a product.
      const res = await fetchAppBootstrap(workspaceId, force);
      if (!res.ok) {
        setCompleted(null);
        setHasProducts(null);
        setError(true);
        return;
      }

      setCompleted(Boolean(res.data.completed));
      setHasProducts(Boolean(res.data.hasProducts));
      setPendingInvites(res.data.pendingInvites ?? 0);
      setAnyWorkspaceActivity(Boolean(res.data.anyWorkspaceActivity));
      setError(false);
    } catch {
      setCompleted(null);
      setHasProducts(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user, workspaceId]);

  const refresh = useCallback(async () => {
    await loadStatus(true);
  }, [loadStatus]);

  useEffect(() => {
    if (authLoading || workspaceLoading) return;
    deferFromEffect(loadStatus);
  }, [authLoading, workspaceLoading, loadStatus]);

  return {
    completed,
    error,
    hasProducts,
    /** Invites addressed to this account, waiting for an accept/decline. */
    pendingInvites,
    /** True when any of the user's workspaces already has products or billing. */
    anyWorkspaceActivity,
    loading: authLoading || workspaceLoading || loading,
    refresh,
  };
}
