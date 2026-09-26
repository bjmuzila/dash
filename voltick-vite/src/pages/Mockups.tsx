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
import { ACCENT, LINE, PANEL, PAPER, R_LG, R_MD, SANS, rgba } from "../theme";

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
      lede="A proposal for cleaner Voltick menus: fewer buttons, fewer places to look, nothing duplicated. Every screen is clickable, nothing is wired to the live site."
      maxWidth={1500}
    >
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20, padding: 6, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, width: "fit-content", maxWidth: "100%" }}>
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
      {tab === "chart" && <ChartProposed />}
      {tab === "flow" && <FlowProposed />}
      {tab === "account" && <AccountProposed />}
      {tab === "settings" && <SettingsProposed />}
    </PageShell>
  );
}
