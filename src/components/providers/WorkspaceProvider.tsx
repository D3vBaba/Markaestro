"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { deferFromEffect } from "@/lib/defer-from-effect";
import { useAuth } from '@/components/providers/AuthProvider';
import { apiFetch, setApiWorkspaceId, WORKSPACE_FORBIDDEN_EVENT } from '@/lib/api-client';
import { invalidateQueries } from '@/hooks/useApiQuery';
import { WORKSPACE_COOKIE } from '@/lib/workspace';

export type WorkspaceInfo = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'analyst';
};

type WorkspaceCtx = {
  workspaces: WorkspaceInfo[];
  current: WorkspaceInfo | null;
  loading: boolean;
  switchWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

const LEGACY_STORAGE_KEY = 'markaestro_workspace';

/** Selection is per-account so a shared browser never leaks one user's pick into another's session. */
function storageKey(uid: string): string {
  return `${LEGACY_STORAGE_KEY}:${uid}`;
}

function readStoredWorkspace(uid: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(storageKey(uid)) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
}

/**
 * Mirror the selection into a cookie so the SERVER resolves workspace-blind
 * requests (SSR, providers that don't pass an id) to the same workspace the
 * UI shows — without it, those requests fall back to a server-side default.
 */
function persistWorkspaceCookie(id: string | null) {
  if (typeof document === 'undefined') return;
  if (id) {
    document.cookie = `${WORKSPACE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Lax`;
  } else {
    document.cookie = `${WORKSPACE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>('default');
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setCurrentId('default');
      persistWorkspaceCookie(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<{ workspaces: WorkspaceInfo[] }>(
        '/api/workspaces?workspaceId=default',
      );
      if (res.ok) {
        setWorkspaces(res.data.workspaces);
        setCurrentId((prev) => {
          // Keep the live selection if it still exists; otherwise restore the
          // persisted one; otherwise fall back to the first workspace.
          const candidates = [
            prev !== 'default' ? prev : null,
            readStoredWorkspace(user.uid),
          ];
          for (const candidate of candidates) {
            if (candidate && res.data.workspaces.some((w) => w.id === candidate)) {
              return candidate;
            }
          }
          return res.data.workspaces[0]?.id ?? 'default';
        });
      }
    } catch {
      // ignore — fall back to default
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    deferFromEffect(fetchWorkspaces);
  }, [authLoading, fetchWorkspaces]);

  useEffect(() => {
    setApiWorkspaceId(currentId);
    if (user && currentId !== 'default') {
      persistWorkspaceCookie(currentId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey(user.uid), currentId);
      }
    }
  }, [currentId, user]);

  // The server said the selected workspace is gone for us (removed
  // mid-session, workspace deleted): re-fetch the list, which drops the
  // stale selection and falls back to a workspace we still belong to.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onForbidden = () => {
      persistWorkspaceCookie(null);
      void fetchWorkspaces().then(() => invalidateQueries());
    };
    window.addEventListener(WORKSPACE_FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(WORKSPACE_FORBIDDEN_EVENT, onForbidden);
  }, [fetchWorkspaces]);

  const switchWorkspace = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const current = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null,
    [workspaces, currentId],
  );

  const value = useMemo<WorkspaceCtx>(
    () => ({ workspaces, current, loading, switchWorkspace, refresh: fetchWorkspaces }),
    [workspaces, current, loading, switchWorkspace, fetchWorkspaces],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
