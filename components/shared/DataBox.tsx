"use client";

import { useState, useCallback, useRef, type ReactNode, type CSSProperties, type RefObject } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type BtnState = "idle" | "busy" | "ok" | "err";

// ── html2canvas lazy loader ───────────────────────────────────────────────────
async function captureElement(el: HTMLElement): Promise<string> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
    backgroundColor: "#05080d",
    useCORS: true,
    allowTaint: true,
    scale: window.devicePixelRatio || 1,
    logging: false,
  });
  return canvas.toDataURL("image/png");
}

async function postToDiscord(imageBase64: string, content: string): Promise<void> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  form.append("files[0]", new Blob([bytes], { type: "image/png" }), "snap.png");
  const res = await fetch("/api/discord-share", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

function downloadImage(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ── Shared button style ───────────────────────────────────────────────────────
const BTN_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
  padding: "2px 7px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 2,
  background: "rgba(255,255,255,0.04)",
  color: "#6b8aaa",
  cursor: "pointer",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".08em",
  fontFamily: "inherit",
  transition: "color .15s, border-color .15s",
  flexShrink: 0,
};

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconCamera({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconDiscord({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function IconX({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Standalone exportable action buttons ──────────────────────────────────────

/** Screenshot the target element and download as PNG.
 *  Pass label="📷" to render emoji-only (no text label). */
export function BoxSnapBtn({ targetRef, label = "SNAP" }: { targetRef: RefObject<HTMLElement | null>; label?: string }) {
  const [s, set] = useState<BtnState>("idle");
  const emojiOnly = label === "📷";
  const filename = emojiOnly ? "snap" : label.toLowerCase().replace(/\s+/g, "-");
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      const img = await captureElement(targetRef.current);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadImage(img, `${filename}-${ts}.png`);
      set("ok");
    } catch { set("err"); }
    finally { setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, filename]);

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#a78bfa";
  const btnContent = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : emojiOnly ? "📷" : label;
  return (
    <button onClick={run} disabled={s === "busy"} title="Screenshot this panel"
      style={{ ...BTN_BASE, color, borderColor: `${color}40`, padding: emojiOnly ? "2px 5px" : "2px 7px", fontSize: emojiOnly ? 13 : 9 }}>
      {emojiOnly ? btnContent : <><IconCamera />{btnContent}</>}
    </button>
  );
}

/** Screenshot the target element and send to Discord.
 *  Omit label (or pass label="") to render icon-only. */
export function BoxDiscordBtn({
  targetRef,
  label = "",
  message,
}: {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
  /** Full message text to send. Defaults to "📸 **label** — HH:MM ET" */
  message?: string;
}) {
  const [s, set] = useState<BtnState>("idle");
  const iconOnly = !label;
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      const img = await captureElement(targetRef.current);
      const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
      const content = message ?? `📸 **${label || "Panel"}** — ${now} ET`;
      await postToDiscord(img, content);
      set("ok");
    } catch { set("err"); }
    finally { setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, label, message]);

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#7289da";
  const statusText = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : null;
  return (
    <button onClick={run} disabled={s === "busy"} title="Send screenshot to Discord"
      style={{ ...BTN_BASE, color, borderColor: `${color}40`, padding: iconOnly ? "2px 5px" : "2px 7px" }}>
      {statusText ?? <IconDiscord size={iconOnly ? 14 : 11} />}
      {!iconOnly && !statusText && <span style={{ fontSize: 9 }}>{label}</span>}
    </button>
  );
}

// ── DataBox wrapper (generic panels that don't have their own header) ─────────
interface DataBoxProps {
  title?: string;
  children: ReactNode;
  onRefresh?: () => void | Promise<void>;
  showSnap?: boolean;
  showDiscord?: boolean;
  showClose?: boolean;
  onClose?: () => void;
  style?: CSSProperties;
  headerStyle?: CSSProperties;
  bodyStyle?: CSSProperties;
  className?: string;
  headerExtra?: ReactNode;
  showHeader?: boolean;
  /** Label used in snap filename and Discord message */
  snapLabel?: string;
}

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
  snapLabel,
}: DataBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshState, setRefreshState] = useState<BtnState>("idle");

  const runRefresh = useCallback(async () => {
    if (!onRefresh || refreshState === "busy") return;
    setRefreshState("busy");
    try { await onRefresh(); setRefreshState("ok"); }
    catch { setRefreshState("err"); }
    finally { setTimeout(() => setRefreshState("idle"), 1800); }
  }, [onRefresh, refreshState]);

  const derivedLabel = snapLabel ?? title ?? "panel";
  const refreshColor = refreshState === "ok" ? "#00e676" : refreshState === "err" ? "#ef4444" : "#00e5ff";

  return (
    <div ref={containerRef} className={className}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", ...style }}>

      {showHeader && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 8px", background: "rgba(7,12,20,0.85)",
          borderBottom: "1px solid rgba(26,42,58,0.7)",
          flexShrink: 0, minHeight: 26, ...headerStyle,
        }}>
          {title && (
            <span style={{ fontSize: 9, color: "#3a5570", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", userSelect: "none", flexShrink: 0 }}>
              {title}
            </span>
          )}
          {headerExtra ? <div style={{ flex: 1, minWidth: 0 }}>{headerExtra}</div> : <div style={{ flex: 1 }} />}

          {onRefresh && (
            <button onClick={runRefresh} disabled={refreshState === "busy"} title="Refresh"
              style={{ ...BTN_BASE, color: refreshColor, borderColor: `${refreshColor}40` }}>
              {refreshState === "busy" ? "…" : refreshState === "ok" ? "✓" : refreshState === "err" ? "✕" : "↻"}
            </button>
          )}
          {showSnap    && <BoxSnapBtn    targetRef={containerRef} label={derivedLabel} />}
          {showDiscord && <BoxDiscordBtn targetRef={containerRef} label={derivedLabel} />}
          {showClose && onClose && (
            <button onClick={onClose} title="Close" style={{ ...BTN_BASE, padding: "2px 5px" }}>
              <IconX />
            </button>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}
