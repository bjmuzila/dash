"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

/**
 * Snapshot button — renders a DOM subtree to a PNG and puts it on the clipboard,
 * so it can be pasted straight into Discord/Slack/a doc.
 *
 * html2canvas is already a dependency (SnapButton's Discord share uses the
 * canvas path); it is imported dynamically here so pages that never click this
 * don't pay for it in their bundle.
 *
 * Clipboard image writes need a secure context and aren't implemented
 * everywhere (Firefox, older Safari), so a failed write falls back to a plain
 * download — the snapshot always lands somewhere.
 *
 * Two things html2canvas can't render are worth knowing about:
 *   • backdrop-filter — frosted panels come out flat. Cosmetic, ignored.
 *   • background-clip:text — gradient headings would render invisible, so mark
 *     them `data-snap-plain="#RRGGBB"` and they're flattened to that color in
 *     the cloned document just for the capture.
 */

type State = "idle" | "working" | "copied" | "saved" | "err";

export default function CopySnapButton({
  targetRef,
  filename = "snapshot.png",
  label = "Snapshot",
  title = "Copy a PNG of this page to the clipboard",
}: {
  /** Element to capture. Falls back to <body> if the ref isn't attached yet. */
  targetRef: RefObject<HTMLElement | null>;
  filename?: string;
  label?: string;
  title?: string;
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
      const el = targetRef.current ?? document.body;
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, {
        backgroundColor: HT.bg,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false,
        onclone: (doc: Document) => {
          doc.querySelectorAll<HTMLElement>("[data-snap-plain]").forEach((n) => {
            const c = n.getAttribute("data-snap-plain") || HT.text;
            n.style.background = "none";
            n.style.webkitTextFillColor = c;
            n.style.color = c;
          });
        },
      });

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("canvas.toBlob returned null");

      try {
        // Promise-valued (rather than Blob-valued) because Safari only accepts
        // that form, and it types cleanly against both lib.dom signatures.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": Promise.resolve(blob) })]);
        flash("copied");
      } catch {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        flash("saved");
      }
    } catch (e) {
      console.error("[CopySnapButton]", e);
      flash("err");
    }
  }, [state, targetRef, filename, flash]);

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
