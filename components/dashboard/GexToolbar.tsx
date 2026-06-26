"use client";

import { type RefObject } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import type { GexMode, DataMode } from "./GexChart";

interface GexToolbarProps {
  gexMode:       GexMode;
  dataMode:      DataMode;
  showOI:        boolean;
  showDex:       boolean;
  showFlipCurve: boolean;
  showGhost5:    boolean;
  showGhost15:   boolean;
  showGhost30:   boolean;
  // DTE picker
  expirations:   string[];
  selectedExpiry: string;
  onExpiry:      (v: string) => void;
  onGexMode:     (m: GexMode) => void;
  onDataMode:    (m: DataMode) => void;
  onToggleOI:    () => void;
  onToggleDex:   () => void;
  onToggleFlip:  () => void;
  onToggleGhost5:  () => void;
  onToggleGhost15: () => void;
  onToggleGhost30: () => void;
  onRefresh:     () => Promise<void>;
  /** Ref to the GEX chart container — used for snap/discord screenshot */
  containerRef?: RefObject<HTMLElement | null>;
  /** Message text sent to Discord (title + expiry) */
  discordMessage?: string;
}

interface PillGroupProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (v: string) => void;
}

const TOOLBAR_FONT_SIZE = 12;
const TOOLBAR_BUTTON_PADDING = "5px 10px";
const TOOLBAR_GROUP_PADDING = 3;

function PillGroup({ options, active, onChange }: PillGroupProps) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--overview-header-bg, #070c14)", borderRadius: 2, padding: TOOLBAR_GROUP_PADDING }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            fontSize: TOOLBAR_FONT_SIZE, padding: TOOLBAR_BUTTON_PADDING, border: "none", borderRadius: 2,
            background: active === o.value ? "#1a2a3a" : "transparent",
            color: active === o.value ? "#00e5ff" : "#fff",
            cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: TOOLBAR_FONT_SIZE, padding: TOOLBAR_BUTTON_PADDING, border: "1px solid #1e3050", borderRadius: 2,
        background: active ? "#0c2535" : "transparent",
        color: active ? "#00e5ff" : "#fff",
        cursor: "pointer", fontWeight: 700, fontFamily: "inherit", flexShrink: 0,
      }}
    >
      {active ? "✓ " : "+ "}{label}
    </button>
  );
}

// Format expiry date → DTE label e.g. "0DTE", "1DTE", "Fri 6/13"
function expiryLabel(expiry: string): { day: string; date: string } {
  if (!expiry) return { day: "ALL", date: "EXP" };
  const d = new Date(expiry + "T00:00:00");
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return {
    day: days[d.getDay()],
    date: `${d.getMonth() + 1}/${d.getDate()}`,
  };
}


const SEP = () => <span style={{ color: "#1a2a3a", flexShrink: 0 }}>|</span>;

export default function GexToolbar({
  gexMode, dataMode, showOI, showDex, showFlipCurve,
  showGhost5, showGhost15, showGhost30,
  expirations, selectedExpiry, onExpiry,
  onGexMode, onDataMode,
  onToggleOI, onToggleDex, onToggleFlip,
  onToggleGhost5, onToggleGhost15, onToggleGhost30,
  onRefresh,
  containerRef, discordMessage,
}: GexToolbarProps) {
  // Prior-state ghost overlays are only meaningful in Net-GEX + OI mode
  // (baselines store OI-based net GEX only).
  const ghostEnabled = gexMode === "net" && dataMode === "oi-vol";
  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(onRefresh);
  // Only show 0DTE and 1DTE
  const visibleExpirations = expirations.slice(0, 2);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 8px", background: "var(--overview-control-bg, #0a0f16)",
      borderBottom: "1px solid var(--overview-border, #1a2a3a)",
      flexShrink: 0, flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden",
      scrollbarWidth: "none", msOverflowStyle: "none" as const,
    }}
    className="gex-toolbar-noscroll">
      <style>{`.gex-toolbar-noscroll::-webkit-scrollbar{display:none;height:0}`}</style>

      {/* DTE / Expiry picker — 0DTE and 1DTE only */}
      <div style={{ display: "flex", gap: 2, background: "var(--overview-header-bg, #070c14)", borderRadius: 2, padding: TOOLBAR_GROUP_PADDING, flexShrink: 0 }}>
        {visibleExpirations.map(exp => (
          <button
            key={exp}
            onClick={() => onExpiry(exp)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0,
              minWidth: 50,
              fontSize: TOOLBAR_FONT_SIZE,
              padding: "5px 10px",
              border: "none",
              borderRadius: 2,
              background: selectedExpiry === exp ? "#1a2a3a" : "transparent",
              color: selectedExpiry === exp ? "#00e5ff" : "#fff",
              cursor: "pointer",
              fontWeight: 700,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              flexShrink: 0,
              lineHeight: 1.05,
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.9, letterSpacing: "0.05em" }}>{expiryLabel(exp).day}</span>
            <span style={{ fontSize: 12.5 }}>{expiryLabel(exp).date}</span>
          </button>
        ))}
      </div>
      <SEP />

      <PillGroup options={[{ label: "Net GEX", value: "net" }, { label: "Call - Put", value: "call-put" }]} active={gexMode} onChange={v => onGexMode(v as GexMode)} />
      <SEP />
      <PillGroup options={[{ label: "OI + Vol", value: "oi-vol" }, { label: "Vol Only", value: "vol-only" }]} active={dataMode} onChange={v => onDataMode(v as DataMode)} />
      <SEP />

      <ToggleBtn label="OI Overlay" active={showOI}        onClick={onToggleOI} />
      <ToggleBtn label="Net DEX"    active={showDex}       onClick={onToggleDex} />
      <ToggleBtn label="GEX Flip"   active={showFlipCurve} onClick={onToggleFlip} />

      {ghostEnabled && (
        <>
          <SEP />
          <ToggleBtn label="5m"  active={showGhost5}  onClick={onToggleGhost5} />
          <ToggleBtn label="15m" active={showGhost15} onClick={onToggleGhost15} />
          <ToggleBtn label="30m" active={showGhost30} onClick={onToggleGhost30} />
        </>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <button onClick={trigger} style={{ ...btnStyle, fontSize: TOOLBAR_FONT_SIZE, padding: TOOLBAR_BUTTON_PADDING }}>{btnLabel}</button>
        {containerRef && <BoxSnapBtn    targetRef={containerRef} label="GEX Chart" />}
        {containerRef && <BoxDiscordBtn targetRef={containerRef} label="GEX Chart" message={discordMessage} />}
      </div>
    </div>
  );
}
