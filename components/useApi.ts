"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { SYNC_EVENT } from "./SyncButton";

/**
 * Last response per URL for this browser session, so returning to a screen
 * shows its data instantly while a fresh copy loads in the background.
 */
const cache = new Map<string, unknown>();
/** Identical requests in flight at the same time share one fetch (e.g. /api/categories). */
const inflight = new Map<string, Promise<unknown>>();

function load<T>(path: string, share: boolean): Promise<T> {
  let p = share ? (inflight.get(path) as Promise<T> | undefined) : undefined;
  if (!p) {
    const req = api<T>(path).finally(() => {
      if (inflight.get(path) === req) inflight.delete(path);
    });
    p = req;
    inflight.set(path, req);
  }
  return p;
}

/** Fetch JSON on mount, refetch on demand and after every sync (stale-while-revalidate). */
export function useApi<T>(path: string | null) {
  const [data, setDataState] = useState<T | null>(() => (path ? ((cache.get(path) as T | undefined) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Only the newest request may update state (fast typing, quick navigation).
  const seq = useRef(0);

  const setData = useCallback(
    (next: T | null | ((cur: T | null) => T | null)) => {
      setDataState((cur) => {
        const v = typeof next === "function" ? (next as (c: T | null) => T | null)(cur) : next;
        if (path) {
          if (v == null) cache.delete(path);
          else cache.set(path, v);
        }
        return v;
      });
    },
    [path],
  );

  // Explicit reloads (after a save) always fetch fresh; first loads share requests.
  const fetchNow = useCallback(async (share: boolean) => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const fresh = await load<T>(path, share);
      if (mine !== seq.current) return;
      cache.set(path, fresh);
      setDataState(fresh);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);
  const reload = useCallback(() => fetchNow(false), [fetchNow]);

  useEffect(() => {
    // New URL: show what we had for it (if anything) straight away.
    setDataState(path ? ((cache.get(path) as T | undefined) ?? null) : null);
    fetchNow(true);
    const h = () => fetchNow(false);
    window.addEventListener(SYNC_EVENT, h);
    return () => window.removeEventListener(SYNC_EVENT, h);
  }, [path, fetchNow]);

  return { data, error, loading, reload, setData };
}
