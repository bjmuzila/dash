"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";
import { captureAndCopy } from "@/lib/snapshot";

/**
 * Snapshot button — renders a DOM subtree to a PNG and puts it on the clipboard,
 * so it can be pasted straight into Discord/Slack/a doc.
 *
 * All the capture mechanics (background, scale, the html2canvas workarounds, the
 * clipboard-with-download fallback) live in lib/snapshot.ts and are shared with
 * every other snapshot path in the app. This component is only the button.
 */

type State = "idle" | "working" | "copied" | "saved" | "err";

/**
 * Wait for a capture-layout switch to be fully on screen.
 *
 * html2canvas reads the LIVE element, so a capture fired in the same tick as the
 * switch photographs the old geometry. Two frames cover React's commit and the
 * browser's re-layout; the timeout after them covers a passive effect that has
 * to repaint something at the new size (the GEX map's terrain canvas does
 * exactly this, and its bitmap is what ends up in the PNG). ~110ms, once, on a
 * click that already takes a second or two.
 */
function settle(): Promise<void> {
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  return frame()
    .then(frame)
    .then(() => new Promise<void>((r) => setTimeout(r, 80)))
    .then(frame);
}

export default function CopySnapButton({
  targetRef,
  filename = "snapshot.png",
  label = "Snapshot",
  title = "Copy a PNG of this page to the clipboard",
  onBeforeCapture,
  onAfterCapture,
}: {
  /** Element to capture. Falls back to <body> if the ref isn't attached yet. */
  targetRef: RefObject<HTMLElement | null>;
  filename?: string;
  label?: string;
  title?: string;
  /**
   * Optional capture-layout switch. Called BEFORE html2canvas reads the DOM, so
   * a panel can render a print-only variant of itself (drop live-only chrome,
   * widen a chart into the space that frees up). The button waits two animation
   * frames afterwards so React has committed and the browser has laid the new
   * tree out — html2canvas reads the LIVE element, and a capture fired in the
   * same tick would photograph the old geometry.
   */
  onBeforeCapture?: () => void;
  /** Restore the live layout. Always runs, including when the capture throws. */
  onAfterCapture?: () => void;
}) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((s: State) => {
    setState(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200);
  }, []);

  const onClick = useCallback(async () => {
    if (state === "working") return;
    setState("working");
    try {
      if (onBeforeCapture) {
        onBeforeCapture();
        await settle();
      }
      const el = targetRef.current ?? document.body;
      flash(await captureAndCopy(el, filename));
    } catch (e) {
      console.error("[CopySnapButton]", e);
      flash("err");
    } finally {
      onAfterCapture?.();
    }
  }, [state, targetRef, filename, flash, onBeforeCapture, onAfterCapture]);

  const text =
    state === "working" ? "Capturing…" :
    state === "copied"  ? "✓ Copied" :
    state === "saved"   ? "✓ Downloaded" :
    state === "err"     ? "✕ Failed" :
    `📸 ${label}`;

  const color =
    state === "copied" || state === "saved" ? HT.green :
    state === "err" ? HT.red :
    HT.cyan;

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        // Vertical centring comes from the global `button` rule in globals.css.
        // Do not set `display` here — an inline value would override it and the
        // label would ride high in the box on touch widths, and the emoji/text
        // label swap ("📸 Snapshot" ↔ "Capturing…") would visibly jump.
        padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${color === HT.cyan ? "rgba(33,158,188,.35)" : color}`,
        background: "linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))",
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        cursor: state === "working" ? "default" : "pointer",
        opacity: state === "working" ? 0.65 : 1,
        transition: "color .2s, border-color .2s, opacity .2s",
      }}
    >
      {text}
    </button>
  );
}
