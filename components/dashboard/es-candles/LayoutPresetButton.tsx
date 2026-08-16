"use client";

/**
 * The "Layout" control for /es-candles: save the current page as a named
 * preset, switch between presets, pick which one loads by default.
 *
 * Self-contained on purpose. The page file already carries three popovers and
 * a portalled dock; adding a fourth inline would have meant four more pieces of
 * state up there for a control that owns all of its own. The page renders
 * <LayoutPresetButton /> and knows nothing else about it.
 *
 * WHAT "DEFAULT" MEANS HERE
 * ─────────────────────────
 * Nothing auto-applies on load. localStorage already restores your last state,
 * which is almost always what you want, and silently overwriting that from the
 * server on every page load would make the page feel like it forgot what you
 * did. The default preset is instead surfaced as a one-click "Load default" —
 * marked in the list, one keystroke away, never surprising.
 *
 * If you'd rather it applied automatically, the hook exposes `defaultName` and
 * the store exposes applyPreset — a mount effect gated on "no local state yet"
 * would do it without the surprise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DockButton } from "@/components/shared/DockToolbar";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED } from "@/components/shared/homeTheme";
import { usePagePresets } from "@/hooks/usePagePresets";
import {
  ES_CANDLES_PRESET_PAGE,
  capturePreset,
  applyPresetAndReload,
  isPreset,
  type EsCandlesPreset,
} from "@/components/dashboard/es-candles/presetStore";

const PANEL_W = 300;

export default function LayoutPresetButton() {
  const P = usePagePresets<EsCandlesPreset>(ES_CANDLES_PRESET_PAGE);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The portaled panel, so the outside-click handler can tell "inside the menu"
  // from "outside" — the panel is not a DOM descendant of the button.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Escape closes, and so does a click anywhere outside the button or the panel.
  //
  // Outside-click used to be deliberately absent here, on the reasoning that the
  // page's other popovers skip it: those hover OVER the charts, and click-away
  // would shut the indicator menu the instant you tried to scrub the chart to
  // see what you had just turned on. This panel is nothing like that — it is a
  // list of saved layouts, you are done with it the moment you pick one, and
  // leaving it parked over the chart until you find the button again is just a
  // menu that will not go away.
  //
  // `mousedown`, not `click`, and the same shape as the Overlays menu in
  // EsChartCard: a `click` handler fires after the target has already been
  // re-rendered, so a click on a row that removes itself lands on nothing and
  // reads as outside.
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setConfirmDelete(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;   // the button itself toggles
      if (menuRef.current?.contains(t)) return;   // typing a name, hitting Save
      close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  // FIXED, not absolute — measured off the button each time it opens.
  //
  // `position: absolute` looked right and rendered UNDER the symbol row of the
  // card below. This button lives inside the chart card's dock, which on a
  // multi-chart row is PORTALED into the page (see dockMode in EsChartCard), so
  // an absolutely-positioned child is laid out against whatever stacking
  // context that dock happens to sit in — and a z-index of 60 inside a context
  // the cards paint over is worth nothing. The page's own Charts/Indicators
  // popovers hit this first and solved it the same way; see the comment above
  // their render in components/pages/EsCandles.tsx.
  //
  // Re-measured on resize and scroll (capture phase, so it catches scrolls in
  // any ancestor) because the dock's height moves with the FitScale factor and
  // the compact breakpoint — a fixed offset would drift the moment the window
  // changed size.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 6,
        // Right-aligned to the button, but never past the viewport edge: at the
        // compact breakpoint this button sits close enough to the right that a
        // naive offset would push the panel off-screen.
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const doSave = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    const ok = await P.save(n, capturePreset());
    if (ok) setName("");
  }, [name, P]);

  const doApply = useCallback((p: EsCandlesPreset) => {
    if (!isPreset(p)) return;   // a row that isn't ours — do nothing rather than half-apply
    applyPresetAndReload(p);
  }, []);

  const label = HOME_THEME.muted;
  const rowBtn = (active: boolean) => ({
    height: 26, padding: "0 8px", borderRadius: 7,
    border: `1px solid ${active ? LIGHT_BLUE : HOME_THEME.border}`,
    background: active ? "rgba(41,182,246,0.16)" : "rgba(255,255,255,0.03)",
    color: active ? LIGHT_BLUE : HOME_THEME.muted,
    fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const,
  });

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <DockButton
        onClick={() => { setOpen((v) => !v); setConfirmDelete(null); }}
        title="Save and switch page layouts"
        caret
        open={open}
        style={open ? { color: LIGHT_BLUE, borderColor: LIGHT_BLUE } : undefined}
      >
        <span>Layout</span>
        {P.presets.length ? <span style={{ opacity: 0.5, fontSize: 10 }}>{P.presets.length}</span> : null}
      </DockButton>

      {/* PORTALED TO document.body.
          `position: fixed` + z-index 60 was not enough on its own: this button
          renders inside the chart card's dock, which on a multi-chart row is
          itself portaled into a container with z-index 35, so the panel's 60 is
          scoped INSIDE that context and loses to anything painting above it.
          Confirmed in the browser — computed `fixed`, z-index 60, rect fully on
          screen, still covered. The page's own Charts/Indicators panels dodge
          this by being rendered at page root; a body portal gets us the same
          place from inside a nested tree. */}
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="es-candles-popover"
          style={{
            // Same treatment as the page's Charts / Indicators panels so the
            // three read as one control surface.
            position: "fixed", top: pos.top, right: pos.right, zIndex: 200,
            width: PANEL_W, maxWidth: "calc(100vw - 16px)",
            padding: 12, borderRadius: 14,
            border: `1px solid ${HOME_THEME.border}`,
            background: "rgba(10,14,20,0.97)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          {/* Save-as row */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: label }}>
              Save current layout
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void doSave(); }}
                placeholder="Name…"
                maxLength={40}
                style={{
                  flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: 7,
                  border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.04)",
                  color: HOME_THEME.text, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => void doSave()}
                disabled={!name.trim() || !P.canSave || P.saveState === "saving"}
                style={{ ...rowBtn(!!name.trim() && P.canSave), height: 28, opacity: name.trim() && P.canSave ? 1 : 0.45 }}
              >
                {P.saveState === "saving" ? "…" : P.saveState === "saved" ? "✓" : "Save"}
              </button>
            </div>
            {/* Overwriting an existing name is allowed and is how you update a
                preset — say so, rather than letting it look like a mistake. */}
            {name.trim() && P.presets.some((p) => p.name === name.trim()) && (
              <span style={{ fontSize: 10, color: HOME_THEME.muted }}>Overwrites “{name.trim()}”.</span>
            )}
          </div>

          <div style={{ height: 1, background: HOME_THEME.border }} />

          {/* Preset list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
            {P.loading && <span style={{ fontSize: 11, color: label }}>Loading…</span>}
            {!P.loading && !P.canSave && (
              <span style={{ fontSize: 11, color: label }}>
                Sign in to save layouts. This page still remembers your last one locally.
              </span>
            )}
            {!P.loading && P.canSave && !P.presets.length && (
              <span style={{ fontSize: 11, color: label }}>No saved layouts yet.</span>
            )}
            {P.presets.map((p) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => doApply(p.preset)}
                  title="Load this layout (reloads the page)"
                  style={{ ...rowBtn(false), flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", color: HOME_THEME.text }}
                >
                  {p.name}
                  {p.isDefault && <span style={{ marginLeft: 6, fontSize: 9, color: LIGHT_BLUE, fontWeight: 800 }}>DEFAULT</span>}
                </button>
                <button
                  onClick={() => void P.setDefault(p.name)}
                  disabled={p.isDefault}
                  title={p.isDefault ? "Already the default" : "Make this the default layout"}
                  style={{ ...rowBtn(p.isDefault), opacity: p.isDefault ? 0.4 : 1 }}
                >
                  ★
                </button>
                {confirmDelete === p.name ? (
                  <button
                    onClick={() => { void P.remove(p.name); setConfirmDelete(null); }}
                    title="Confirm delete"
                    style={{ ...rowBtn(false), borderColor: SOFT_RED, color: SOFT_RED }}
                  >
                    Sure?
                  </button>
                ) : (
                  <button onClick={() => setConfirmDelete(p.name)} title="Delete" style={rowBtn(false)}>✕</button>
                )}
              </div>
            ))}
          </div>

          {P.error && (
            <span style={{ fontSize: 10, color: SOFT_RED }}>{P.error}</span>
          )}
          <span style={{ fontSize: 10, color: label, lineHeight: 1.4 }}>
            Saves chart count, tickers, timeframe, overlays, expiry picks and indicators.
            Loading one reloads the page.
          </span>
        </div>,
        document.body,
      )}
    </div>
  );
}
