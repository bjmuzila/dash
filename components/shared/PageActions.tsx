"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";

/**
 * Floating refresh / snapshot / discord actions, mounted once per page via
 * LayoutShell. Captures the page <main> for snap + discord; refresh re-runs
 * the route's server fetch + remounts client trees via router.refresh() and
 * also fires a "page-refresh" event pages can listen for to re-fetch data.
 */
export default function PageActions({ label }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");

  // Resolve the enclosing <main> as the screenshot target.
  const anchorRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    targetRef.current = anchorRef.current?.closest("main") ?? null;
  }, []);

  const refresh = useCallback(async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      router.refresh();
      window.dispatchEvent(new CustomEvent("page-refresh"));
      await new Promise((r) => setTimeout(r, 400));
      setState("ok");
    } finally {
      setTimeout(() => setState("idle"), 1500);
    }
  }, [router, state]);

  const refreshColor = state === "ok" ? "#00e676" : "#00e5ff";

  return (
    <div
      ref={anchorRef}
      data-no-capture
      style={{
        position: "absolute",
        top: 6,
        right: 8,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <button
        onClick={refresh}
        disabled={state === "busy"}
        title="Refresh this page"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2px 7px",
          border: `1px solid ${refreshColor}40`,
          borderRadius: 2,
          background: "rgba(0,229,255,0.06)",
          color: refreshColor,
          cursor: state === "busy" ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "inherit",
          flexShrink: 0,
        }}
      >
        {state === "busy" ? "…" : state === "ok" ? "✓" : "↻"}
      </button>
      <BoxSnapBtn targetRef={targetRef} label={label} />
      <BoxDiscordBtn targetRef={targetRef} label={label} />
    </div>
  );
}
