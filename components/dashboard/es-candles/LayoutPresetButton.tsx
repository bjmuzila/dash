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

  // Escape closes, matching the page's other popovers. Outside-click does not,
  // for the same reason they don't: the charts are what you reach for next.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setConfirmDelete(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60,
            width: PANEL_W, padding: 10, borderRadius: 10,
            border: `1px solid ${HOME_THEME.border}`,
            background: HOME_THEME.panel,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
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
        </div>
      )}
    </div>
  );
}
