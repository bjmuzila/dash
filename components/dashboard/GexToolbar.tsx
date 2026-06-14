"use client";

import { useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import type { GexMode, DataMode, ChartMode } from "./GexChart";

interface GexToolbarProps {
  gexMode:       GexMode;
  dataMode:      DataMode;
  chartMode:     ChartMode;
  showOI:        boolean;
  showDex:       boolean;
  showFlipCurve: boolean;
  flipPoint:     number | null;
  callWall:      number | undefined;
  putWall:       number | undefined;
  netGex:        string;
  // DTE picker
  expirations:   string[];   // YYYY-MM-DD list
  selectedExpiry: string;    // "" = all / default
  onExpiry:      (v: string) => void;
  onGexMode:     (m: GexMode) => void;
  onDataMode:    (m: DataMode) => void;
  onChartMode:   (m: ChartMode) => void;
  onToggleOI:    () => void;
  onToggleDex:   () => void;
  onToggleFlip:  () => void;
  onRefresh:     () => Promise<void>;
  onExpandChart:   () => void;
  onCollapseChart: () => void;
}

interface PillGroupProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (v: string) => void;
}

const TOOLBAR_FONT_SIZE = 11;
const TOOLBAR_BUTTON_PADDING = "5px 12px";
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
function expiryLabel(expiry: string): string {
  if (!expiry) return "ALL";
  const dte = getExpiryDte(expiry);
  const d = new Date(expiry + "T00:00:00");
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
  if (dte === 0) return `0DTE ${dateStr}`;
  if (dte === 1) return `1DTE ${dateStr}`;
  return `${days[d.getDay()]} ${dateStr}`;
}

function getExpiryDte(expiry: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(expiry + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((d.getTime() - today.getTime()) / 86400000));
}

const SEP = () => <span style={{ color: "#1a2a3a", flexShrink: 0 }}>|</span>;

export default function GexToolbar({
  gexMode, dataMode, chartMode, showOI, showDex, showFlipCurve,
  flipPoint, callWall, putWall, netGex,
  expirations, selectedExpiry, onExpiry,
  onGexMode, onDataMode, onChartMode,
  onToggleOI, onToggleDex, onToggleFlip,
  onRefresh, onExpandChart, onCollapseChart,
}: GexToolbarProps) {
  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(onRefresh);
  const visibleExpirations = expirations.slice(0, 3);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "8px 12px", background: "var(--overview-control-bg, #0a0f16)",
      borderBottom: "1px solid var(--overview-border, #1a2a3a)",
      flexShrink: 0, flexWrap: "nowrap", overflowX: "auto",
    }}>

      {/* DTE / Expiry picker */}
      <div style={{
        display: "flex",
        gap: 2,
        background: "var(--overview-header-bg, #070c14)",
        borderRadius: 2,
        padding: TOOLBAR_GROUP_PADDING,
        flexShrink: 0,
        maxWidth: "100%",
        overflowX: "auto",
      }}>
        <button
          onClick={() => onExpiry("")}
          style={{
            fontSize: TOOLBAR_FONT_SIZE, padding: "5px 10px", border: "none", borderRadius: 2,
            background: selectedExpiry === "" ? "#1a2a3a" : "transparent",
            color: selectedExpiry === "" ? "#00e5ff" : "#fff",
            cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
          }}
        >
          ALL
        </button>
        {visibleExpirations.map(exp => (
          <button
            key={exp}
            onClick={() => onExpiry(exp)}
            style={{
              fontSize: TOOLBAR_FONT_SIZE, padding: "5px 10px", border: "none", borderRadius: 2,
              background: selectedExpiry === exp ? "#1a2a3a" : "transparent",
              color: selectedExpiry === exp ? "#00e5ff" : "#fff",
              cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {expiryLabel(exp)}
          </button>
        ))}
      </div>
      <SEP />

      {/* Chart mode */}
      <PillGroup
        options={[{ label: "Line", value: "line" }, { label: "Bars", value: "bars" }]}
        active={chartMode}
        onChange={v => onChartMode(v as ChartMode)}
      />
      <SEP />

      {/* GEX mode */}
      <PillGroup
        options={[{ label: "Net GEX", value: "net" }, { label: "Call - Put", value: "call-put" }]}
        active={gexMode}
        onChange={v => onGexMode(v as GexMode)}
      />
      <SEP />

      {/* Data mode */}
      <PillGroup
        options={[{ label: "OI + Vol", value: "oi-vol" }, { label: "Vol Only", value: "vol-only" }]}
        active={dataMode}
        onChange={v => onDataMode(v as DataMode)}
      />
      <SEP />

      <ToggleBtn label="OI Overlay" active={showOI}        onClick={onToggleOI} />
      <ToggleBtn label="Net DEX"    active={showDex}       onClick={onToggleDex} />
      <ToggleBtn label="GEX Flip"   active={showFlipCurve} onClick={onToggleFlip} />
      <SEP />

      {/* GEX levels */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: TOOLBAR_FONT_SIZE, fontFamily: "inherit" }}>
        {callWall != null && <span><span style={{ color: "#3a5570" }}>CW </span><span style={{ color: "#22c55e", fontWeight: 700 }}>{callWall.toLocaleString()}</span></span>}
        {putWall  != null && <span><span style={{ color: "#3a5570" }}>PW </span><span style={{ color: "#f97316", fontWeight: 700 }}>{putWall.toLocaleString()}</span></span>}
        {flipPoint != null && <span><span style={{ color: "#3a5570" }}>Flip </span><span style={{ color: "#faad14", fontWeight: 700 }}>{flipPoint.toFixed(0)}</span></span>}
        {netGex && <span><span style={{ color: "#3a5570" }}>GEX </span><span style={{ color: "#00e5ff", fontWeight: 700 }}>{netGex}</span></span>}
      </div>

      {/* Chart size controls */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 3, flexShrink: 0 }}>
        <button
          onClick={onExpandChart}
          title="Expand chart"
          aria-label="Expand chart"
          style={{ padding: "5px 8px", border: "1px solid #1e3050", borderRadius: 4, background: "#0a1628", color: "#00e5ff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#0d2035")}
          onMouseLeave={e => (e.currentTarget.style.background = "#0a1628")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={onCollapseChart}
          title="Collapse chart"
          aria-label="Collapse chart"
          style={{ padding: "5px 8px", border: "1px solid #1e3050", borderRadius: 4, background: "#0a1628", color: "#7a9ab8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#0d2035")}
          onMouseLeave={e => (e.currentTarget.style.background = "#0a1628")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Refresh button */}
      <button
        onClick={trigger}
        style={{ ...btnStyle, fontSize: TOOLBAR_FONT_SIZE, padding: TOOLBAR_BUTTON_PADDING }}
      >
        {btnLabel}
      </button>
    </div>
  );
}
