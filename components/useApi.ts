"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { SYNC_EVENT } from "./SyncButton";

/** Fetch JSON on mount, refetch on demand and after every sync. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener(SYNC_EVENT, h);
    return () => window.removeEventListener(SYNC_EVENT, h);
  }, [reload]);
  return { data, error, loading, reload, setData };
}
