"use client";
import { useState, useCallback, useRef } from "react";
import { homeRefreshButtonStyle, type RefreshState } from "@/components/shared/homeTheme";

export function useRefreshButton(fn: () => Promise<void>) {
  const [state, setState] = useState<RefreshState>("idle");
  const lockedRef = useRef(false);

  const trigger = useCallback(async () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setState("refreshing");
    try {
      await fn();
      setState("success");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => {
        setState("idle");
        lockedRef.current = false;
      }, 1800);
    }
  }, [fn]);

  const label =
    state === "refreshing" ? "↻ Refreshing…" :
    state === "success"    ? "✓ Refreshed"   :
    state === "error"      ? "✗ Failed"      : "↻ Now";

  const style = homeRefreshButtonStyle(state);

  return { trigger, label, style, state };
}
