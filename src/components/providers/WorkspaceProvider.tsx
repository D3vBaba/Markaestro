"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiFetch } from '@/lib/api-client';

export type WorkspaceInfo = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
};

type WorkspaceCtx = {
  workspaces: WorkspaceInfo[];
  current: WorkspaceInfo | null;
  loading: boolean;
  switchWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

const STORAGE_KEY = 'markaestro_workspace';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>('default');
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<{ workspaces: WorkspaceInfo[] }>(
        '/api/workspaces?workspaceId=default',
      );
      if (res.ok) {
        setWorkspaces(res.data.workspaces);
        // Restore persisted workspace if it still exists
        const stored = typeof window !== 'undefined'
          ? localStorage.getItem(STORAGE_KEY)
          : null;
        const valid = res.data.workspaces.find((w) => w.id === stored);
        setCurrentId(valid ? valid.id : (res.data.workspaces[0]?.id ?? 'default'));
      }
    } catch {
      // ignore — fall back to default
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    fetchWorkspaces();
  }, [authLoading, fetchWorkspaces]);

  const switchWorkspace = useCallback((id: string) => {
    setCurrentId(id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
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
