"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { canAccessIntelligencePreview } from '@/lib/intelligence/preview-access';
import { apiGet } from '@/lib/api-client';

/** Server verdicts per uid, so a session asks once rather than per component. */
const serverVerdicts = new Map<string, boolean>();
const inFlight = new Map<string, Promise<boolean>>();

async function fetchServerVerdict(uid: string): Promise<boolean> {
  const cached = serverVerdicts.get(uid);
  if (cached !== undefined) return cached;
  const pending = inFlight.get(uid);
  if (pending) return pending;
  const request = apiGet<{ canAccess: boolean }>('/api/intelligence/access')
    .then((res) => Boolean(res.data?.canAccess))
    .catch(() => false)
    .then((verdict) => {
      serverVerdicts.set(uid, verdict);
      inFlight.delete(uid);
      return verdict;
    });
  inFlight.set(uid, request);
  return request;
}

/**
 * Intelligence preview access for the signed-in user.
 *
 * `true` as soon as the build-time allowlist says so; otherwise `null` while
 * the server half of the allowlist is being asked, then `true`/`false`.
 * Treat `null` as "not yet": hide the feature, but do not redirect away.
 */
export function useIntelligencePreviewAccess(): boolean | null {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const local = canAccessIntelligencePreview({ email: user?.email, uid });
  const [remote, setRemote] = useState<boolean | null>(() => (uid ? serverVerdicts.get(uid) ?? null : null));

  useEffect(() => {
    if (!uid || local) return;
    let cancelled = false;
    fetchServerVerdict(uid).then((verdict) => { if (!cancelled) setRemote(verdict); });
    return () => { cancelled = true; };
  }, [uid, local]);

  if (local) return true;
  if (!uid) return false;
  return remote;
}
