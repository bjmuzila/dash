"use client";

import { useState, useCallback, useRef, type ReactNode, type CSSProperties, type RefObject } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

// ── Types ─────────────────────────────────────────────────────────────────────
type BtnState = "idle" | "busy" | "ok" | "err";

// ── Owner gate (cosmetic — matches NavMenu) ───────────────────────────────────
function useIsOwner(): boolean {
  const { isSignedIn, user } = useAuth();
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
//  • onclone must NOT strip external <link rel="stylesheet"> tags — that also
//    deletes the compiled Tailwind stylesheet, breaking any className-styled
//    (not inline-style) element's layout during capture (confirmed on ES
//    Candles' CALL WALL/PUT WALL/FLIP/CB row).
async function captureElement(el: HTMLElement, title?: string, fitContent = false): Promise<string> {
  const titleText = title && title.trim() ? title : "SPX GEX";
  // Measure the true content height of the scrollable body so the capture wraps
  // the data tightly (no empty space) without collapsing rows to zero.
  // Prefer a <table>; otherwise (grid/card layouts like the options chain) find
  // the scrollable body and measure its real content height so the capture wraps
  // tightly instead of inheriting the page's full 100% height (blank bottom).
  const inner = el.querySelector("table") as HTMLElement | null;
  // A lightweight-charts target (ES Candles) is a FLEX COLUMN (chart card +
  // lanes), not a bare bitmap. It happens to contain a <canvas> (the heatmap
  // overlay), but it must take the flex-summation path below — not the bare-
  // canvas fast-path — or html2canvas clips to the clamped flex height and only
  // the bottom of the chart is captured. Detect it via the __ltScreenshot hook.
  const isLtChart = !!(el as unknown as { __ltScreenshot?: unknown }).__ltScreenshot;
  // A canvas chart (e.g. GEX chart) is a fixed-pixel bitmap that won't re-flow,
  // so we must NOT add height for the title band — that leaves blank space at the
  // bottom. Instead the band overlays the top of the chart at its true height.
  const isCanvas = !inner && !isLtChart && !!el.querySelector("canvas");

  // Plain <canvas> charts (e.g. GexChart): bypass html2canvas entirely. Its
  // only content is the canvas itself (plus an optional hover tooltip that's
  // irrelevant to a static capture) — after four rounds of chasing html2canvas's
  // clone/reflow/width-vs-windowWidth quirks (crops, double-scaling, off-center
  // frames), the robust fix is to skip the DOM-clone pipeline altogether and
  // build the PNG straight from the canvas's own pixel buffer plus a manually
  // drawn title band. No clone, no reflow, no bounding-rect alignment to get wrong.
  if (isCanvas) {
    const plainCanvas = el.querySelector("canvas") as HTMLCanvasElement;
    const scale = window.devicePixelRatio || 1;
    const bandH = Math.round(44 * scale);
    const out = document.createElement("canvas");
    out.width = plainCanvas.width;
    out.height = plainCanvas.height + bandH;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "#05080d";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(plainCanvas, 0, bandH);
    octx.textBaseline = "alphabetic";
    octx.textAlign = "left";
    octx.fillStyle = "#ffffff";
    octx.font = `700 ${Math.round(15 * scale)}px Inter, Arial, sans-serif`;
    octx.fillText(titleText, 12 * scale, 20 * scale);
    octx.fillStyle = "rgba(255,255,255,0.7)";
    octx.font = `700 ${Math.round(11 * scale)}px Inter, Arial, sans-serif`;
    octx.fillText("Data provided by CBEdge.net", 12 * scale, 36 * scale);
    return out.toDataURL("image/png");
  }

  const { default: html2canvas } = await import("html2canvas");

  // lightweight-charts (ES candles) renders candles into internal canvases that
  // html2canvas copies blank. If the target exposes __ltScreenshot, its own
  // screenshot is composited over the chart layer's position afterward (below).
  // Looked up early (not just after html2canvas runs) so `lt.target` can also
  // be used to scope the "other plain canvas" handling right below.
  const ltProvider = (el as unknown as {
    __ltScreenshot?: () => { canvas: HTMLCanvasElement; target: HTMLElement } | null;
  }).__ltScreenshot;
  const lt = ltProvider?.();

  // A page can contain OTHER plain <canvas> elements beside the lightweight
  // chart — e.g. ES Candles' EsGexRail (GEX-by-strike bars), a devicePixelRatio-
  // backed canvas of its own. Those aren't covered by the isCanvas bypass above
  // (isCanvas requires the WHOLE captured element to be nothing but a canvas),
  // so they'd otherwise fall through to html2canvas's native <canvas> handling —
  // the same double-scale bug the bypass exists to avoid, so they vanish/crop
  // to nothing in the capture. Strip each one from the clone (a placeholder div
  // keeps the layout box) and composite the real bitmap in ourselves afterward.
  const otherLiveCanvases = Array.from(el.querySelectorAll("canvas")).filter(
    (c) => !(lt && lt.target.contains(c))
  ) as HTMLCanvasElement[];

  let contentH: number;
  if (inner) {
    contentH = inner.scrollHeight;
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
  // fitContent mode (element hugs its content during capture, e.g. mult-greek
  // screenshot mode): measure the REAL rendered content box — bottom of the
  // last child relative to the element's top — instead of the child-sum
  // heuristic, which can overshoot and leave a blank void below the data.
  if (fitContent) {
    const r = el.getBoundingClientRect();
    const last = el.lastElementChild?.getBoundingClientRect();
    if (last && last.bottom > r.top) contentH = Math.ceil(last.bottom - r.top);
  }
  // Reserve room for the title band for every path. Canvas charts used to skip
  // this (band overlaid the top of the bitmap instead), back when html2canvas
  // rendered the canvas natively filling the whole box with no room to shift
  // it down. Now that the canvas is composited in ourselves (see below), we can
  // push it down below the band like everything else — otherwise the band
  // covers the chart's own top-of-canvas annotations (spot label, CB tag).
  const captureH = contentH + 48;
  // Output crop width, matching the live element. Note: this must NOT be paired
  // with a `windowWidth` override — windowWidth reflows the ENTIRE cloned page
  // at that viewport width (it's meant for responsive/media-query accuracy),
  // and since this chart sits in a two-column flex row, narrowing the virtual
  // window down to just the chart's own width reflows every ancestor flex
  // container and changes the chart's actual size/position in the clone. Only
  // `width` (a pure output-crop size, no reflow) is safe here.
  const contentW = el.scrollWidth || el.getBoundingClientRect().width;
  const base = await html2canvas(el, {
    backgroundColor: "#05080d",
    useCORS: true,
    allowTaint: true,
    width: contentW,
    scale: window.devicePixelRatio || 1,
    // `height` alone is a pure output-crop size — no reflow. `windowHeight`
    // (deliberately omitted) reflows the ENTIRE cloned document as if the
    // browser viewport were that short, same footgun as `windowWidth` above.
    // For a page whose captureH is much shorter than the real viewport (e.g.
    // a trimmed table), that broke a vh-based ancestor layout (the app's
    // global toolbar shell) and leaked it into the crop.
    height: captureH,
    logging: false,
    onclone: (doc, clone) => {
      // Do NOT strip <link rel="stylesheet"> tags. This used to remove them
      // ("can 404 and abort the render"), but that also deletes Next.js's
      // compiled Tailwind stylesheet — any element styled via className
      // utilities (not inline style) silently loses its layout during capture.
      // Confirmed cause of the ES Candles CALL WALL/PUT WALL/FLIP/CB row
      // collapsing (its wrapper is `className="flex flex-wrap ..."`; each
      // StatBox kept its own inline space-between, so losing the wrapper's
      // flex context stretched every box full-width — label far left, value
      // shoved to the far right edge). html2canvas's useCORS/allowTaint
      // options already handle a missing/CORS-blocked stylesheet resource
      // without aborting, so the original 404 concern doesn't need this.
      // Strip each "other plain canvas" (see otherLiveCanvases above) from the
      // clone by matching DOM order — querySelectorAll order is identical
      // between the live tree and its deep clone, so index-matching is exact.
      if (otherLiveCanvases.length) {
        const cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
        const liveAll = Array.from(el.querySelectorAll("canvas"));
        otherLiveCanvases.forEach((liveCanvas) => {
          const idx = liveAll.indexOf(liveCanvas);
          const cloned = idx >= 0 ? cloneCanvases[idx] : undefined;
          if (cloned) {
            const placeholder = doc.createElement("div");
            placeholder.style.cssText = cloned.style.cssText;
            cloned.replaceWith(placeholder);
          }
        });
      }
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
      clone.style.paddingTop = "44px";
      const tbl = clone.querySelector("table") as HTMLElement | null;
      if (tbl) {
        tbl.style.height = `${contentH}px`;
      } else {
        // Grid/card layout (e.g. options chain): un-clamp the flex scroll body so
        // every row renders and the clone collapses to its real content height
        // — no blank space below the data box.
        // Pair clone children with the LIVE element's children so we can read
        // their real rendered height (the clone isn't laid out yet).
        const liveKids = Array.from(el.children) as HTMLElement[];
        Array.from(clone.children).forEach((c, i) => {
          const ch = c as HTMLElement;
          const live = liveKids[i];
          ch.style.flex = "none";
          ch.style.flexShrink = "0";
          // A flex-1 chart card holds its chart via absolute inset-0 children, so
          // height:auto collapses it to 0. Pin it to the real rendered height.
          const liveH = live ? live.offsetHeight : ch.offsetHeight;
          if (liveH > 0) ch.style.height = `${liveH}px`;
          ch.style.overflow = "visible";
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

  // lt (looked up above) composited over the chart layer's position so the
  // candles appear — html2canvas copies lightweight-charts' internal canvases
  // blank.
  if (lt) {
    const scale = window.devicePixelRatio || 1;
    const elRect = el.getBoundingClientRect();
    const tRect = lt.target.getBoundingClientRect();
    // Offset of the chart layer within the captured element, in canvas px.
    // The clone reserves 44px of paddingTop for the title band, so shift the
    // composited candle bitmap down by that same amount.
    const dx = (tRect.left - elRect.left) * scale;
    const dy = (tRect.top - elRect.top + 44) * scale;
    const dw = tRect.width * scale;
    const dh = tRect.height * scale;
    const ctx = base.getContext("2d");
    if (ctx) ctx.drawImage(lt.canvas, dx, dy, dw, dh);
  }

  // Composite each "other plain canvas" (see otherLiveCanvases above) — e.g.
  // EsGexRail — using its own live bounding rect, same technique as the lt
  // chart composite just above.
  if (otherLiveCanvases.length) {
    const scale = window.devicePixelRatio || 1;
    const elRect = el.getBoundingClientRect();
    const ctx = base.getContext("2d");
    if (ctx) {
      for (const liveCanvas of otherLiveCanvases) {
        const cRect = liveCanvas.getBoundingClientRect();
        const dx = (cRect.left - elRect.left) * scale;
        const dy = (cRect.top - elRect.top + 44) * scale;
        const dw = cRect.width * scale;
        const dh = cRect.height * scale;
        ctx.drawImage(liveCanvas, dx, dy, dw, dh);
      }
    }
  }

  // fitContent: DOM-based height estimates keep overshooting (some ancestor
  // stretches the live panels row taller than its rendered rows), so guarantee
  // "no empty space" at the bitmap level — scan the rendered pixels for the
  // last row/column that differs from the page background and crop there.
  if (fitContent) {
    try {
      const ctx = base.getContext("2d");
      if (ctx && base.width > 4 && base.height > 4) {
        const { width: bw, height: bh } = base;
        const data = ctx.getImageData(0, 0, bw, bh).data;
        // Sample the background from the bottom-right corner (blank region).
        const ci = ((bh - 2) * bw + (bw - 2)) * 4;
        const bgR = data[ci], bgG = data[ci + 1], bgB = data[ci + 2];
        const isContent = (i: number) =>
          Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB) > 24;
        let bottom = bh - 1;
        outerY: for (let y = bh - 1; y >= 0; y--) {
          for (let x = 0; x < bw; x += 2) {
            if (isContent((y * bw + x) * 4)) { bottom = y; break outerY; }
          }
        }
        let right = bw - 1;
        outerX: for (let x = bw - 1; x >= 0; x--) {
          for (let y = 0; y <= bottom; y += 2) {
            if (isContent((y * bw + x) * 4)) { right = x; break outerX; }
          }
        }
        const scale = window.devicePixelRatio || 1;
        const pad = Math.round(10 * scale);
        const newH = Math.min(bh, bottom + 1 + pad);
        const newW = Math.min(bw, right + 1 + pad);
        // Only re-encode if the crop actually removes something meaningful.
        if (newH < bh - 4 || newW < bw - 4) {
          const out = document.createElement("canvas");
          out.width = newW;
          out.height = newH;
          const octx = out.getContext("2d")!;
          octx.fillStyle = "#05080d";
          octx.fillRect(0, 0, newW, newH);
          octx.drawImage(base, 0, 0);
          return out.toDataURL("image/png");
        }
      }
    } catch { /* tainted canvas or getImageData failure — return uncropped */ }
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
export function BoxSnapBtn({ targetRef, title, onBeforeCapture, onAfterCapture, fitContent = false }: { targetRef: RefObject<HTMLElement | null>; label?: string; title?: string; onBeforeCapture?: () => void | Promise<void>; onAfterCapture?: () => void; /** Element hugs its content during capture — crop the PNG to the real content box. */ fitContent?: boolean }) {
  const [s, set] = useState<BtnState>("idle");
  const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      await onBeforeCapture?.();
      const img = await captureElement(targetRef.current, title, fitContent);
      // Convert base64 data URL → Blob → ClipboardItem
      const base64 = img.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      set("ok");
    } catch (e) { console.error("[snap] capture failed:", e); set("err"); }
    finally { onAfterCapture?.(); setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, title, onBeforeCapture, onAfterCapture, fitContent]);

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
  onBeforeCapture,
  onAfterCapture,
  fitContent = false,
}: {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
  /** Full message text to send. Defaults to "📸 **label** — HH:MM ET" */
  message?: string;
  /** Title baked into the top-left of the screenshot, e.g. "SPX GEX • Fri 6/26" */
  title?: string;
  /** Run (and await) right before capture — e.g. to trim rows for the shot. */
  onBeforeCapture?: () => void | Promise<void>;
  /** Run right after capture — restore the pre-capture view. */
  onAfterCapture?: () => void;
  /** Element hugs its content during capture — crop the PNG to the real content box. */
  fitContent?: boolean;
}) {
  const [s, set] = useState<BtnState>("idle");
  const isOwner = useIsOwner();
    const run = useCallback(async () => {
    if (s === "busy" || !targetRef.current) return;
    set("busy");
    try {
      await onBeforeCapture?.();
      const img = await captureElement(targetRef.current, title, fitContent);
      const now = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
      const content = message ?? `📸 **${label || "Panel"}** — ${now} ET`;
      await postToDiscord(img, content);
      set("ok");
    } catch { set("err"); }
    finally { onAfterCapture?.(); setTimeout(() => set("idle"), 1800); }
  }, [s, targetRef, label, message, title, onBeforeCapture, onAfterCapture, fitContent]);

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

