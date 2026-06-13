"use client";
import { useState, useCallback, useRef } from "react";

type RefreshState = "idle" | "refreshing" | "success" | "error";

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

  const style: React.CSSProperties = {
    fontSize: 9,
    padding: "2px 10px",
    border: `1px solid ${state === "success" ? "#00e676" : state === "error" ? "#ff4757" : "rgba(0,229,255,.4)"}`,
    borderRadius: 2,
    background:
      state === "success" ? "rgba(0,230,118,0.1)" :
      state === "error"   ? "rgba(255,71,87,0.1)"  : "rgba(0,229,255,.08)",
    color:
      state === "success" ? "#00e676" :
      state === "error"   ? "#ff4757" :
      state === "refreshing" ? "#888" : "#00e5ff",
    textShadow:
      state === "success" ? "0 0 12px rgba(0,230,118,0.5)" :
      state === "error"   ? "0 0 12px rgba(255,71,87,0.5)"  : "none",
    cursor: state === "refreshing" ? "not-allowed" : "pointer",
    opacity: state === "refreshing" ? 0.6 : 1,
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.15s",
  };

  return { trigger, label, style, state };
}
