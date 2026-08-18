"use client";

/**
 * SWR-lite cached GET hook.
 *
 * Module-level cache keyed by `${wsId}:${path}` with stale-while-revalidate:
 * a cache hit renders instantly (no spinner on revisit) and, when older than
 * `staleMs`, revalidates in the background. Concurrent requests for the same
 * key are deduped. `invalidateQueries(prefix)` drops matching entries and
 * makes every mounted hook on those keys refetch — call it after mutations
 * that change data other pages have cached.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiGet, getApiWorkspaceId, subscribeApiWorkspaceId } from "@/lib/api-client";
import { userFacingError } from "@/lib/user-facing-errors";

const DEFAULT_STALE_MS = 30_000;

type Entry = { data: unknown; updatedAt: number };
type FetchResult = { ok: boolean; status: number; data: unknown };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<FetchResult>>();
const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Drop cached entries whose path starts with `pathPrefix` (all entries when
 * omitted) and tell mounted hooks on those keys to refetch.
 */
export function invalidateQueries(pathPrefix?: string) {
  const toNotify: Array<() => void> = [];
  for (const key of [...cache.keys()]) {
    const path = key.slice(key.indexOf(":") + 1);
    if (pathPrefix && !path.startsWith(pathPrefix)) continue;
    cache.delete(key);
    for (const fn of listeners.get(key) ?? []) toNotify.push(fn);
  }
  // Keys with mounted hooks but no cache entry yet still need the signal.
  for (const [key, set] of listeners) {
    const path = key.slice(key.indexOf(":") + 1);
    if (pathPrefix && !path.startsWith(pathPrefix)) continue;
    if (!cache.has(key)) for (const fn of set) toNotify.push(fn);
  }
  for (const fn of new Set(toNotify)) fn();
}

function fetchDeduped(key: string, path: string, wsId: string): Promise<FetchResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = apiGet(path, wsId)
    .then((res) => {
      if (res.ok) cache.set(key, { data: res.data, updatedAt: Date.now() });
      return res as FetchResult;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/**
 * Start a fetch from an effect without updating state synchronously inside it.
 * runFetch flips `loading`/`refreshing` before its first await, so calling it
 * inline from an effect costs an extra render pass (and trips
 * react-hooks/set-state-in-effect). A microtask still lands before paint.
 */
function deferFetch(start: () => void): void {
  void Promise.resolve().then(start);
}

export type UseApiQueryReturn<T> = {
  /** Latest data (cached or fresh); null until the first successful fetch. */
  data: T | null;
  /** True only when there is no cached data yet (initial load). */
  loading: boolean;
  /** True while revalidating in the background with cached data showing. */
  refreshing: boolean;
  /** Error message from the last failed fetch, cleared on success. */
  error: string | null;
  /** Force a refetch, bypassing staleness checks. */
  refresh: () => Promise<void>;
};

export function useApiQuery<T = unknown>(
  path: string | null,
  opts?: { staleMs?: number; wsId?: string },
): UseApiQueryReturn<T> {
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  // Default to the workspace selected in the UI, reactively: when the user
  // switches workspaces, every mounted query re-keys and refetches. The old
  // literal "default" fallback froze all reads on an arbitrary
  // server-resolved workspace while writes followed the switcher.
  const activeWsId = useSyncExternalStore(
    subscribeApiWorkspaceId,
    getApiWorkspaceId,
    () => "default",
  );
  const wsId = opts?.wsId ?? activeWsId;
  const key = path ? `${wsId}:${path}` : null;

  const [data, setData] = useState<T | null>(() =>
    key && cache.has(key) ? (cache.get(key)!.data as T) : null,
  );
  const [loading, setLoading] = useState(() => !!key && !cache.has(key));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against state updates from a stale key after navigation.
  const generationRef = useRef(0);

  const runFetch = useCallback(
    async (background: boolean) => {
      if (!key || !path) return;
      const generation = ++generationRef.current;
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetchDeduped(key, path, wsId);
        if (generation !== generationRef.current) return;
        if (res.ok) {
          setData(res.data as T);
          setError(null);
        } else {
          setError(userFacingError(res.data, "Request failed"));
        }
      } catch {
        if (generation !== generationRef.current) return;
        setError("Network error");
      } finally {
        if (generation === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, path, wsId],
  );

  // Re-seed from the cache when the key changes. The initial state above
  // already does this for the first render; repeating it in the effect meant a
  // synchronous setState there, which costs an extra render pass and trips
  // react-hooks/set-state-in-effect. Adjusting during render instead keeps a
  // key change to one pass and shows cached data without an empty frame.
  const [syncedKey, setSyncedKey] = useState(key);
  if (key !== syncedKey) {
    setSyncedKey(key);
    // A null key keeps whatever was last shown, as it always has.
    if (key) {
      const entry = cache.get(key);
      setData(entry ? (entry.data as T) : null);
      setLoading(!entry);
    }
  }

  useEffect(() => {
    if (!key) {
      generationRef.current++;
      return;
    }
    const entry = cache.get(key);
    if (!entry) {
      deferFetch(() => runFetch(false));
    } else if (Date.now() - entry.updatedAt > staleMs) {
      deferFetch(() => runFetch(true));
    }
    return subscribe(key, () => runFetch(cache.has(key)));
  }, [key, staleMs, runFetch]);

  const refresh = useCallback(async () => {
    if (!key) return;
    cache.delete(key);
    await runFetch(data !== null);
  }, [key, runFetch, data]);

  return { data, loading, refreshing, error, refresh };
}
