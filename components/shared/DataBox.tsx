"use client";

import { useState, useCallback, useRef, type ReactNode, type CSSProperties, type RefObject } from "react";
import { useUser } from "@clerk/nextjs";

// ── Types ─────────────────────────────────────────────────────────────────────
type BtnState = "idle" | "busy" | "ok" | "err";

// ── Owner gate (cosmetic — matches NavMenu) ───────────────────────────────────
function useIsOwner(): boolean {
  const { isSignedIn, user } = useUser();
  const ownerId = process.env.NEXT_PUBLIC_OWNER_USER_ID;
  return ownerId ? user?.id === ownerId : !!isSignedIn;
}

// ── Screenshot capture ────────────────────────────────────────────────────────
// Captures `el` to a PNG via html2canvas, with a baked-in title band + watermark.
// Hard-won gotchas (see memory "html2canvas screenshot gotchas"):
//  • Text/images drawn onto the RETURNED canvas no-op in this browser — they MUST
//    be injected as real DOM in onclone so html2canvas renders them natively.
//  • Never set the clone height to "auto" on a flex/percentage-height table — it
//    collapses to 0 and crashes html2canvas ("createPattern ... height of 0").
//    Measure the table's scrollHeight and set an explicit px height instead.
//  • onclone strips external <link>/<style> so html2canvas never refetches a
//    (sometimes 404'ing) stylesheet that can abort the render.
async function captureElement(el: HTMLElement, title?: string): Promise<string> {
  const { default: html2canvas } = await import("html2canvas");
  const titleText = title && title.trim() ? title : "SPX GEX";
  // Measure the true content height of the scrollable body so the capture wraps
  // the data tightly (no empty space) without collapsing rows to zero.
  // Prefer a <table>; otherwise (grid/card layouts like the options chain) find
  // the scrollable body and measure its real content height so the capture wraps
  // tightly instead of inheriting the page's full 100% height (blank bottom).
  const inner = el.querySelector("table") as HTMLElement | null;
  // A canvas chart (e.g. GEX chart) is a fixed-pixel bitmap that won't re-flow,
  // so we must NOT add height for the title band — that leaves blank space at the
  // bottom. Instead the band overlays the top of the chart at its true height.
  const isCanvas = !inner && !!el.querySelector("canvas");
  let contentH: number;
  if (inner) {
    contentH = inner.scrollHeight;
  } else if (isCanvas) {
    contentH = el.scrollHeight;
  } else {
    // Sum the height of every direct child up to (and including) the scroll body,
    // measuring the scroll body by its scrollHeight not its clamped client height.
    let h = 0;
    Array.from(el.children).forEach((c) => {
      const ch = c as HTMLElement;
      h += ch.scrollHeight > ch.clientHeight ? ch.scrollHeight : ch.offsetHeight;
    });
    contentH = h || el.scrollHeight;
  }
  // Canvas: band overlays, no extra height. Otherwise reserve the title band.
  const captureH = isCanvas ? contentH : contentH + 48;
  const base = await html2canvas(el, {
    backgroundColor: "#05080d",
    useCORS: true,
    allowTaint: true,
    scale: window.devicePixelRatio || 1,
    height: captureH,
    windowHeight: captureH,
    logging: false,
    onclone: (doc, clone) => {
      doc.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => n.remove());
      // Inject overlay text as real DOM so html2canvas renders it natively
      // (drawing text onto the returned canvas no-ops in this browser).
      clone.style.position = "relative";
      // Expand to full content so all rows render (no scroll clipping), and
      // reserve space at the top for the title band so nothing hides behind it.
      // Expand to the measured content height (explicit px — never auto/0) and
      // reserve room for the title band so no rows hide behind it.
      clone.style.height = `${captureH}px`;
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";
      // Canvas charts: band overlays, so no top padding (would create blank space).
      clone.style.paddingTop = isCanvas ? "0" : "44px";
      const tbl = clone.querySelector("table") as HTMLElement | null;
      if (tbl) {
        tbl.style.height = `${contentH}px`;
      } else if (!isCanvas) {
        // Grid/card layout (e.g. options chain): un-clamp the flex scroll body so
        // every row renders and the clone collapses to its real content height
        // — no blank space below the data box.
        Array.from(clone.children).forEach((c) => {
          const ch = c as HTMLElement;
          ch.style.flex = "none";
          ch.style.flexShrink = "0";
          if (ch.scrollHeight > ch.clientHeight) {
            ch.style.height = "auto";
            ch.style.overflow = "visible";
          }
        });
      }
      const inter = "var(--font-inter), Inter, Arial, sans-serif";
      // Solid title band across the top so it never collides with table headers
      // or chart legends behind it.
      const band = doc.createElement("div");
      band.style.cssText = [
        "position:absolute", "top:0", "left:0", "right:0",
        "padding:8px 12px 8px", "background:#05080d",
        "z-index:9999", "pointer-events:none",
      ].join(";");
      const t1 = doc.createElement("div");
      t1.textContent = titleText;
      t1.style.cssText = `font:700 15px ${inter};color:#ffffff;white-space:nowrap;`;
      const t2 = doc.createElement("div");
      t2.textContent = "Data provided by CBEdge.net";
      t2.style.cssText = `font:700 11px ${inter};color:rgba(255,255,255,0.7);white-space:nowrap;margin-top:3px;`;
      band.appendChild(t1);
      band.appendChild(t2);
      clone.appendChild(band);
    },
  });

  // lightweight-charts (ES candles) renders candles into internal canvases that
  // html2canvas copies blank. If the target exposes __ltScreenshot, composite the
  // library's own screenshot over the chart layer's position so candles appear.
  const ltProvider = (el as unknown as {
    __ltScreenshot?: () => { canvas: HTMLCanvasElement; target: HTMLElement } | null;
  }).__ltScreenshot;
  const lt = ltProvider?.();
  if (lt) {
    const scale = window.devicePixelRatio || 1;
    const elRect = el.getBoundingClientRect();
    const tRect = lt.target.getBoundingClientRect();
    // Offset of the chart layer within the captured element, in canvas px. Add
    // the title-band reserve (captureH − contentH) so it lands below the band.
    const bandReserve = captureH - contentH;
    const dx = (tRect.left - elRect.left) * scale;
    const dy = (tRect.top - elRect.top + bandReserve) * scale;
    const dw = tRect.width * scale;
    const dh = tRect.height * scale;
    const ctx = base.getContext("2d");
    if (ctx) ctx.drawImage(lt.canvas, dx, dy, dw, dh);
  }

  return base.toDataURL("image/png");
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

/** Screenshot the target element and copy PNG to clipboard. */
export function BoxSnapBtn({ targetRef, title }: { targetRef: RefObject<HTMLElement | null>; label?: string; title?: string }) {
  const [s, set] = useState<BtnState>("idle");
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      const img = await captureElement(targetRef.current, title);
      // Convert base64 data URL → Blob → ClipboardItem
      const base64 = img.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      set("ok");
    } catch (e) { console.error("[snap] capture failed:", e); set("err"); }
    finally { setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, title]);

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#a78bfa";
  const btnContent = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : "📸";
  return (
    <button onClick={run} disabled={s === "busy"} title="Copy screenshot to clipboard"
      style={{ ...BTN_BASE, color, borderColor: `${color}40`, padding: "2px 5px", fontSize: 13 }}>
      {btnContent}
    </button>
  );
}

/** Screenshot the target element and send to Discord.
 *  Renders emoji-only. */
export function BoxDiscordBtn({
  targetRef,
  label,
  message,
  title,
}: {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
  /** Full message text to send. Defaults to "📸 **label** — HH:MM ET" */
  message?: string;
  /** Title baked into the top-left of the screenshot, e.g. "SPX GEX • Fri 6/26" */
  title?: string;
}) {
  const [s, set] = useState<BtnState>("idle");
  const isOwner = useIsOwner();
    const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      const img = await captureElement(targetRef.current, title);
      const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
      const content = message ?? `📸 **${label || "Panel"}** — ${now} ET`;
      await postToDiscord(img, content);
      set("ok");
    } catch { set("err"); }
    finally { setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, label, message, title]);

  // Discord share is owner-only (cosmetic gate).
  if (!isOwner) return null;

  const color = s === "ok" ? "#00e676" : s === "err" ? "#ef4444" : "#7289da";
  const statusText = s === "busy" ? "…" : s === "ok" ? "✓" : s === "err" ? "✕" : null;
  return (
    <button onClick={run} disabled={s === "busy"} title="Send screenshot to Discord"
      style={{ ...BTN_BASE, color, borderColor: `${color}40`, padding: "2px 5px", fontSize: 13 }}>
      {statusText ?? <IconDiscord /> }
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

  const refreshColor = refreshState === "ok" ? "#00e676" : refreshState === "err" ? "#ef4444" : "#219EBC";

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
          {showSnap    && <BoxSnapBtn    targetRef={containerRef} />}
          {showDiscord && <BoxDiscordBtn targetRef={containerRef} />}
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

