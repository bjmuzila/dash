/**
 * Mockups · the proposed, consolidated Voltick menus, one tab per surface.
 *
 *   1. Chart ⚙      one popover, three tabs by intent (Look · Layers · Studies)
 *   2. Flow         four tabs instead of seven + five, one toolbar shape
 *   3. Account      account things only, nothing that duplicates the rail
 *   4. Settings     one searchable page that owns every preference
 *
 * The designs live in MockupsProposed.tsx. Nothing here is wired: every control
 * holds local React state only and nothing touches the live site.
 * Copy rules hold: no em-dashes in anything a person reads, nothing that reads
 * as advice.
 */
import { useState } from "react";
import { PageShell } from "../components/PageCard";
import { AccountProposed, ChartProposed, FlowProposed, SettingsProposed } from "./MockupsProposed";
import { ACCENT, LINE, MONO, PANEL, PAPER, PAPER_QUIET, R_LG, R_MD, SANS, rgba } from "../theme";
import { ChangesCtx, MARK_COLOR } from "./mockupsMark";

type Tab = "chart" | "flow" | "account" | "settings";
const TABS: [Tab, string][] = [
  ["chart", "⚙ Chart"],
  ["flow", "⚡︎ Flow"],
  ["account", "◉ Account menu"],
  ["settings", "☰ Settings"],
];

function readHashTab(): Tab {
  const h = typeof window !== "undefined" ? window.location.hash.slice(1).replace(/^p-/, "") : "";
  return TABS.find(([k]) => k === h)?.[0] ?? "chart";
}

export default function Mockups() {
  const [tab, setTab] = useState<Tab>(readHashTab);
  const [show, setShow] = useState(false);
  const pick = (k: Tab) => {
    setTab(k);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${k}`);
    } catch {
      /* ignore */
    }
  };
  return (
    <PageShell
      title="Mockups"
      maxWidth={1500}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 6, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, width: "fit-content", maxWidth: "100%" }}>
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => pick(k)}
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 700,
              padding: "8px 14px",
              borderRadius: R_MD,
              cursor: "pointer",
              border: `1px solid ${tab === k ? ACCENT : "transparent"}`,
              color: PAPER,
              background: tab === k ? rgba(ACCENT, 0.18) : "transparent",
              boxShadow: tab === k ? `inset 0 -1px 0 ${ACCENT}, 0 0 20px -8px ${ACCENT}` : "none",
            }}
          >
            {l}
          </button>
        ))}
      </div>
        <button
          type="button"
          aria-pressed={show}
          onClick={() => setShow(!show)}
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 700,
            padding: "10px 16px",
            borderRadius: R_MD,
            cursor: "pointer",
            color: PAPER,
            border: `1px solid ${show ? MARK_COLOR.new : LINE}`,
            background: show ? rgba(MARK_COLOR.new, 0.16) : PANEL,
            boxShadow: show ? `0 0 20px -8px ${MARK_COLOR.new}` : "none",
          }}
        >
          {show ? "✓ Showing changes" : "◎ Show changes"}
        </button>
        {show && (
          <span style={{ display: "inline-flex", gap: 14, flexWrap: "wrap", fontFamily: SANS, fontSize: 12, color: PAPER_QUIET }}>
            {(
              [
                ["new", "New or merged"],
                ["moved", "Moved or renamed"],
                ["gone", "Removed from here"],
              ] as const
            ).map(([k, l]) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, border: `2px ${k === "gone" ? "dashed" : "solid"} ${MARK_COLOR[k]}`, background: rgba(MARK_COLOR[k], 0.15) }} />
                <span style={{ fontFamily: MONO, fontSize: 11 }}>{l}</span>
              </span>
            ))}
          </span>
        )}
      </div>
      <ChangesCtx.Provider value={show}>
      {tab === "chart" && <ChartProposed />}
      {tab === "flow" && <FlowProposed />}
      {tab === "account" && <AccountProposed />}
      {tab === "settings" && <SettingsProposed />}
      </ChangesCtx.Provider>
    </PageShell>
  );
}
