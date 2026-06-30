"use client";

import { type RefObject } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { Dock, SegGroup, ToggleTile, DockButton, DockSpacer, DockSep, DockGap, type SegOption } from "@/components/shared/DockToolbar";
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
  /** Underlying ticker for the screenshot title, e.g. "SPX" */
  ticker?: string;
}

// Format expiry date → DTE label e.g. "0DTE  Fri 6/13"
function expiryLabel(expiry: string): { day: string; date: string } {
  if (!expiry) return { day: "ALL", date: "EXP" };
  const d = new Date(expiry + "T00:00:00");
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return { day: days[d.getDay()], date: `${d.getMonth() + 1}/${d.getDate()}` };
}

export default function GexToolbar({
  gexMode, dataMode, showOI, showDex, showFlipCurve,
  showGhost5, showGhost15, showGhost30,
  expirations, selectedExpiry, onExpiry,
  onGexMode, onDataMode,
  onToggleOI, onToggleDex, onToggleFlip,
  onToggleGhost5, onToggleGhost15, onToggleGhost30,
  onRefresh,
  containerRef, discordMessage, ticker = "SPX",
}: GexToolbarProps) {
  // Title baked into the top-left of the screenshot: "SPX GEX • Fri 6/26"
  const { day: exDay, date: exDate } = expiryLabel(selectedExpiry);
  const screenshotTitle = `${ticker} GEX  •  ${exDay} ${exDate}`;
  // Prior-state ghost overlays are only meaningful in Net-GEX + OI mode.
  const ghostEnabled = gexMode === "net" && dataMode === "oi-vol";
  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(onRefresh);
  // Only show 0DTE and 1DTE
  const visibleExpirations = expirations.slice(0, 2);

  const dteOptions: SegOption[] = visibleExpirations.map((exp) => {
    const { day, date } = expiryLabel(exp);
    return { value: exp, label: day, sub: day === "ALL" ? undefined : date };
  });

  return (
    <div style={{ display: "flex", padding: "6px 8px 2px", flexShrink: 0 }}>
      <Dock className="dock-noscroll" style={{ width: "100%", gap: 8 }} fullWidth flat noScroll>
        {/* DTE / Expiry picker */}
        {dteOptions.length > 0 && (
          <>
            <SegGroup options={dteOptions} active={selectedExpiry} onChange={onExpiry} />
            <DockGap />
          </>
        )}

        {/* GEX mode */}
        <SegGroup
          options={[{ label: "Net GEX", value: "net" }, { label: "Call−Put", value: "call-put" }]}
          active={gexMode}
          onChange={(v) => onGexMode(v as GexMode)}
        />

        <DockGap />

        {/* Data mode */}
        <SegGroup
          options={[{ label: "OI+Vol", value: "oi-vol" }, { label: "Vol Only", value: "vol-only" }]}
          active={dataMode}
          onChange={(v) => onDataMode(v as DataMode)}
        />

        <DockGap />

        {/* Overlay toggles */}
        <ToggleTile label="OI"   on={showOI}        onClick={onToggleOI} />
        <ToggleTile label="DEX"  on={showDex}       onClick={onToggleDex} />
        <ToggleTile label="Flip" on={showFlipCurve} onClick={onToggleFlip} />

        {/* Actions */}
        <DockSpacer />
        <DockButton onClick={trigger} title="Refresh" style={{ color: btnStyle.color as string }}>
          {btnLabel}
        </DockButton>
        {containerRef && <BoxSnapBtn targetRef={containerRef} label="GEX Chart" title={screenshotTitle} />}
        {containerRef && <BoxDiscordBtn targetRef={containerRef} label="GEX Chart" message={discordMessage} title={screenshotTitle} />}
      </Dock>
    </div>
  );
}
