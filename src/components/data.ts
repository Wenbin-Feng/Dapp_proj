"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { productGateway } from "@/lib/api-client";
import type { DashboardData } from "@/lib/types";
import { useWallet } from "./wallet-provider";
export function useDashboard() {
  const { profile } = useWallet();
  const [data, setData] = useState<DashboardData | null>(null);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const userId = profile?.id;
  const reload = useCallback(async () => {
    if (!userId) return;
    const current = ++requestId.current;
    setError(null);
    setLoading(true);
    setDataOwner(userId);
    try {
      const result = await productGateway.dashboard();
      if (current === requestId.current) setData(result);
    } catch (e) {
      if (current === requestId.current)
        setError(
          e instanceof Error ? e.message : "Unable to load your workspace.",
        );
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    requestId.current++;
    setData(null);
    setDataOwner(null);
    setError(null);
    setLoading(Boolean(userId));
    if (userId) void reload();
    return () => {
      requestId.current++;
    };
  }, [userId, reload]);
  const matches = Boolean(userId) && dataOwner === userId;
  return {
    data: matches ? data : null,
    loading: Boolean(userId) && (!matches || loading),
    error: matches ? error : null,
    reload,
  };
}
