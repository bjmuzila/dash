"use client";

/**
 * LayoutBar — the control strip for a page's draggable/resizable card grid.
 *
 *   const L = useDashboardLayout("options", DEFAULT_LAYOUT);
 *   <LayoutBar {...L.bar} />
 *
 * Locked (the default) it's a single quiet "Edit layout" button, so a page that
 * nobody rearranges looks exactly like it did before. Unlocked it exposes the
 * template picker, Save / Save as / Delete and Reset.
 *
 * Colors and control styling come from homeTheme — nothing hardcoded.
 */

import { useState } from "react";
import {
  HOME_THEME,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeInputStyle,
} from "./homeTheme";
import ThemedSelect from "./ThemedSelect";
import type { LayoutBarProps } from "./useDashboardLayout";

const NEW = "__new__";
const ADD = "__add__";

export default function LayoutBar({
  editing,
  setEditing,
  templates,
  activeName,
  saveState,
  canSave,
  dirty,
  onSaveAs,
  onSelect,
  onDelete,
  onReset,
  addOptions,
  onAdd,
}: LayoutBarProps & {
  /** Card types the page can add. Omit to hide the Add-card control. */
  addOptions?: { value: string; label: string }[];
  onAdd?: (value: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  const status =
    saveState === "saving" ? "Saving…" :
    saveState === "saved"  ? "Saved" :
    saveState === "error"  ? "Save failed" :
    dirty                  ? "Unsaved — click Save as" :
    activeName             ? `Template · ${activeName}` : "";

  const statusColor =
    saveState === "error" ? HOME_THEME.red :
    saveState === "saved" ? HOME_THEME.green :
    HOME_THEME.text;

  function commitName() {
    const n = draftName.trim();
    setNaming(false);
    setDraftName("");
    if (n) void onSaveAs(n);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 12,
        minHeight: 30,
      }}
    >
      <button
        type="button"
        onClick={() => setEditing(!editing)}
        style={editing ? homeButtonStyle : homeSecondaryButtonStyle}
        title={editing ? "Lock the cards in place" : "Move and resize the cards"}
      >
        {editing ? "Done" : "Edit layout"}
      </button>

      {editing && (
        <>
          {onAdd && addOptions && addOptions.length > 0 && (
            <div style={{ minWidth: 150 }}>
              <ThemedSelect
                ariaLabel="Add a card"
                value=""
                placeholder="+ Add card"
                width={150}
                options={addOptions.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(v) => { if (v && v !== ADD) onAdd(v); }}
              />
            </div>
          )}

          {templates.length > 0 && (
            <div style={{ minWidth: 180 }}>
              <ThemedSelect
                ariaLabel="Saved layout template"
                value={activeName ?? ""}
                placeholder="Unsaved layout"
                width={180}
                options={[
                  ...templates.map((t) => ({
                    value: t.name,
                    label: t.isDefault ? `${t.name} · default` : t.name,
                  })),
                  { value: NEW, label: "Save as new…" },
                ]}
                onChange={(v) => {
                  if (v === NEW) { setDraftName(""); setNaming(true); }
                  else onSelect(v);
                }}
              />
            </div>
          )}

          {naming ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                autoFocus
                value={draftName}
                maxLength={40}
                placeholder="Template name"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") { setNaming(false); setDraftName(""); }
                }}
                style={{ ...homeInputStyle, fontSize: 12, padding: "5px 10px", width: 170 }}
              />
              <button type="button" onClick={commitName} style={homeButtonStyle}>Save</button>
              <button
                type="button"
                onClick={() => { setNaming(false); setDraftName(""); }}
                style={homeSecondaryButtonStyle}
              >
                Cancel
              </button>
            </span>
          ) : (
            canSave && (
              <button
                type="button"
                onClick={() => { setDraftName(activeName ?? ""); setNaming(true); }}
                style={homeSecondaryButtonStyle}
                title="Save this arrangement as a named template"
              >
                {activeName ? "Save as…" : "Save layout"}
              </button>
            )
          )}

          {activeName && canSave && (
            <button
              type="button"
              onClick={() => onDelete(activeName)}
              style={homeSecondaryButtonStyle}
              title={`Delete the "${activeName}" template`}
            >
              Delete
            </button>
          )}

          <button type="button" onClick={onReset} style={homeSecondaryButtonStyle} title="Back to the default arrangement">
            Reset
          </button>

          {status && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: statusColor,
                opacity: saveState === "idle" ? 0.55 : 0.9,
              }}
            >
              {status}
            </span>
          )}

          {!canSave && (
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.5 }}>
              Sign in to save layouts
            </span>
          )}
        </>
      )}
    </div>
  );
}
