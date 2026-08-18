"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { deferFromEffect } from "@/lib/defer-from-effect";
import { useAuth } from '@/components/providers/AuthProvider';
import { apiFetch, setApiWorkspaceId, WORKSPACE_FORBIDDEN_EVENT } from '@/lib/api-client';
import { invalidateQueries } from '@/hooks/useApiQuery';
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_COOKIE,
  mergeWorkspaceHint,
  pickSelectedWorkspaceId,
} from '@/lib/workspace';

export type WorkspaceInfo = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'analyst';
};

export type RefreshWorkspacesOptions = {
  /** Force this workspace open after the refresh (invite accept / create). */
  select?: string;
  /** Shown in the switcher if the list has not caught up yet. */
  hint?: Pick<WorkspaceInfo, 'name' | 'role'>;
};

type WorkspaceCtx = {
  workspaces: WorkspaceInfo[];
  current: WorkspaceInfo | null;
  loading: boolean;
  switchWorkspace: (id: string) => void;
  refresh: (opts?: RefreshWorkspacesOptions) => Promise<void>;
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

function persistWorkspaceSelection(uid: string | undefined, id: string) {
  setApiWorkspaceId(id);
  if (id && id !== DEFAULT_WORKSPACE_ID) {
    persistWorkspaceCookie(id);
    if (uid && typeof window !== 'undefined') {
      localStorage.setItem(storageKey(uid), id);
    }
  } else {
    persistWorkspaceCookie(null);
  }
}

function asWorkspaceRole(role: string | undefined): WorkspaceInfo['role'] {
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'analyst') return role;
  return 'member';
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [loading, setLoading] = useState(true);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  const applySelection = useCallback((id: string, uid = user?.uid) => {
    setCurrentId(id);
    persistWorkspaceSelection(uid, id);
  }, [user?.uid]);

  const fetchWorkspaces = useCallback(async (opts?: RefreshWorkspacesOptions) => {
    if (!user) {
      setWorkspaces([]);
      applySelection(DEFAULT_WORKSPACE_ID, undefined);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<{ workspaces: WorkspaceInfo[] }>(
        '/api/workspaces?workspaceId=default',
      );
      if (!res.ok) {
        if (opts?.select) {
          const hint = {
            id: opts.select,
            name: opts.hint?.name || opts.select,
            role: asWorkspaceRole(opts.hint?.role),
          };
          setWorkspaces((prev) => mergeWorkspaceHint(prev, hint));
          applySelection(opts.select);
        } else {
          const stored = readStoredWorkspace(user.uid);
          if (stored) applySelection(stored);
        }
        return;
      }
      const hint = opts?.select
        ? {
            id: opts.select,
            name: opts.hint?.name || opts.select,
            role: asWorkspaceRole(opts.hint?.role),
          }
        : null;
      const nextList = mergeWorkspaceHint(res.data.workspaces, hint);
      const nextId = pickSelectedWorkspaceId({
        workspaceIds: nextList.map((workspace) => workspace.id),
        previousId: currentIdRef.current,
        storedId: readStoredWorkspace(user.uid),
        preferredId: opts?.select,
      });
      setWorkspaces(nextList);
      applySelection(nextId);
    } catch {
      if (opts?.select) {
        const hint = {
          id: opts.select,
          name: opts.hint?.name || opts.select,
          role: asWorkspaceRole(opts.hint?.role),
        };
        setWorkspaces((prev) => mergeWorkspaceHint(prev, hint));
        applySelection(opts.select);
      } else {
        const stored = readStoredWorkspace(user.uid);
        if (stored) applySelection(stored);
      }
    } finally {
      setLoading(false);
    }
  }, [applySelection, user]);

  useEffect(() => {
    if (authLoading) return;
    deferFromEffect(() => fetchWorkspaces());
  }, [authLoading, fetchWorkspaces]);

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
    applySelection(id);
  }, [applySelection]);

  const current = useMemo(() => {
    const found = workspaces.find((workspace) => workspace.id === currentId);
    if (found) return found;
    // Keep an explicit selection visible even if the membership list is stale
    // (just accepted an invite; listing has not returned the new workspace).
    if (currentId && currentId !== DEFAULT_WORKSPACE_ID) {
      return { id: currentId, name: currentId, role: 'member' as const };
    }
    return workspaces[0] ?? null;
  }, [workspaces, currentId]);

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
