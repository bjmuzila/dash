"use client";

import { useState, useCallback, type ReactNode, type CSSProperties } from "react";
import { saveManualMvcSnapshot } from "@/components/shared/SnapButton";

// ── Types ─────────────────────────────────────────────────────────────────────
type BtnState = "idle" | "busy" | "ok" | "err";

interface DataBoxProps {
  /** Box title shown in header */
  title?: string;
  /** Content to render inside the box */
  children: ReactNode;
  /** Called when the Refresh button is clicked */
  onRefresh?: () => void | Promise<void>;
  /** If true, show the Snap (save snapshot) button */
  showSnap?: boolean;
  /** If true, show the Discord share button */
  showDiscord?: boolean;
  /** If true, show the X / close button (calls onClose) */
  showClose?: boolean;
  /** Called when X is clicked */
  onClose?: () => void;
  /** Extra style on the outer wrapper */
  style?: CSSProperties;
  /** Extra style on the header bar */
  headerStyle?: CSSProperties;
  /** Extra style on the content area */
  bodyStyle?: CSSProperties;
  /** Custom class name on the outer wrapper */
  className?: string;
  /** Right-side slot for custom controls rendered before the action buttons */
  headerExtra?: ReactNode;
  /** If false, hides the entire header row. Default: true */
  showHeader?: boolean;
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function useAsyncBtn(fn?: () => void | Promise<void>): [BtnState, () => void] {
  const [s, set] = useState<BtnState>("idle");
  const run = useCallback(async () => {
    if (!fn || s === "busy") return;
    set("busy");
    try {
      await fn();
      set("ok");
    } catch {
      set("err");
    } finally {
      setTimeout(() => set("idle"), 1800);
    }
  }, [fn, s]);
  return [s, run];
}

async function discordShare(): Promise<void> {
  // Grabs the largest canvas on page and posts to Discord via existing API route
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas"));
  let imageBase64: string | null = null;
  if (canvases.length) {
    const best = canvases.reduce((a, b) => a.width * a.height >= b.width * b.height ? a : b);
    if (best.width * best.height >= 1000) imageBase64 = best.toDataURL("image/png");
  }

  const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const content = `📸 **Snapshot** — ${now} ET`;
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  if (imageBase64) {
    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    form.append("files[0]", new Blob([bytes], { type: "image/png" }), "snap.png");
  }
  const res = await fetch("/api/discord-share", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

// ── Icon components (inline SVG, no external dep) ────────────────────────────
function IconRefresh({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function IconCamera({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconDiscord({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function IconX({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Shared button styles ──────────────────────────────────────────────────────
const BTN_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "3px 7px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 3,
  background: "rgba(255,255,255,0.04)",
  color: "#6b8aaa",
  cursor: "pointer",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".08em",
  fontFamily: "inherit",
  transition: "color .15s, border-color .15s, background .15s",
  flexShrink: 0,
};

// ── DataBox ───────────────────────────────────────────────────────────────────
export default function DataBox({
  title,
  children,
  onRefresh,
  showSnap = false,
  showDiscord = false,
  showClose = false,
  onClose,
  style,
  headerStyle,
  bodyStyle,
  className,
  headerExtra,
  showHeader = true,
}: DataBoxProps) {
  const [refreshState, runRefresh] = useAsyncBtn(onRefresh);
  const [snapState,    runSnap]    = useAsyncBtn(saveManualMvcSnapshot);
  const [discordState, runDiscord] = useAsyncBtn(discordShare);

  const refreshColor =
    refreshState === "ok"  ? "#00e676" :
    refreshState === "err" ? "#ef4444" : "#00e5ff";

  const snapColor =
    snapState === "ok"  ? "#00e676" :
    snapState === "err" ? "#ef4444" : "#a78bfa";

  const discordColor =
    discordState === "ok"  ? "#00e676" :
    discordState === "err" ? "#ef4444" : "#7289da";

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* ── Header ── */}
      {showHeader && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            background: "rgba(7,12,20,0.85)",
            borderBottom: "1px solid rgba(26,42,58,0.7)",
            flexShrink: 0,
            minHeight: 26,
            ...headerStyle,
          }}
        >
          {/* Title */}
          {title && (
            <span style={{
              fontSize: 9,
              color: "#3a5570",
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              userSelect: "none",
              flexShrink: 0,
            }}>
              {title}
            </span>
          )}

          {/* Custom header content */}
          {headerExtra && (
            <div style={{ flex: 1, minWidth: 0 }}>{headerExtra}</div>
          )}

          {/* Spacer */}
          {!headerExtra && <div style={{ flex: 1 }} />}

          {/* ── Action buttons ── */}
          {onRefresh && (
            <button
              onClick={runRefresh}
              title="Refresh data"
              disabled={refreshState === "busy"}
              style={{ ...BTN_BASE, color: refreshColor, borderColor: `${refreshColor}33` }}
            >
              <IconRefresh />
              {refreshState === "busy" ? "…" : refreshState === "ok" ? "✓" : refreshState === "err" ? "✕" : "REFRESH"}
            </button>
          )}

          {showSnap && (
            <button
              onClick={runSnap}
              title="Save MVC snapshot"
              disabled={snapState === "busy"}
              style={{ ...BTN_BASE, color: snapColor, borderColor: `${snapColor}33` }}
            >
              <IconCamera />
              {snapState === "busy" ? "…" : snapState === "ok" ? "✓ SAVED" : snapState === "err" ? "✕ ERR" : "SNAP"}
            </button>
          )}

          {showDiscord && (
            <button
              onClick={runDiscord}
              title="Share to Discord"
              disabled={discordState === "busy"}
              style={{ ...BTN_BASE, color: discordColor, borderColor: `${discordColor}33` }}
            >
              <IconDiscord />
              {discordState === "busy" ? "…" : discordState === "ok" ? "✓ SENT" : discordState === "err" ? "✕ ERR" : "DISCORD"}
            </button>
          )}

          {showClose && onClose && (
            <button
              onClick={onClose}
              title="Close panel"
              style={{ ...BTN_BASE, color: "#6b8aaa", padding: "3px 5px" }}
            >
              <IconX />
            </button>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}
