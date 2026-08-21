"use client";

import { type RefObject, type ReactNode } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { Dock, SegGroup, ToggleTile, DockButton, DockSpacer, DockSep, DockGap, DockCogMenu, DockMenuRow, DockMenuDivider, type SegOption } from "@/components/shared/DockToolbar";
import type { GexMode, DataMode, GexMetric } from "./GexChart";

interface GexToolbarProps {
  gexMode:       GexMode;
  dataMode:      DataMode;
  /**
   * ── Series switch (OPTIONAL) ─────────────────────────────────────────────
   * GEX | DEX, plus an EX-0DTE toggle. The two compose into the four series a
   * host can show: GEX, DEX, GEX ex-0DTE, DEX ex-0DTE.
   *
   * Every field here is optional, and each control renders ONLY when its
   * handler is supplied. That is what lets one host adopt the switch without
   * every other host changing: /home passes none of them and its toolbar is
   * exactly what it was.
   *
   * EX-0DTE is a different DATA SOURCE, not a chart setting — the live socket is
   * single-expiry by construction, so the host has to fetch the summed board
   * itself. Hence `ex0dteBusy` / `ex0dteError`: this toggle has to be able to
   * say "fetching" and "that didn't work", which a display toggle never would.
   */
  metric?:       GexMetric;
  onMetric?:     (m: GexMetric) => void;
  ex0dte?:       boolean;
  onToggleEx0dte?: () => void;
  /** The ex-0DTE board sweep is in flight. */
  ex0dteBusy?:   boolean;
  /** Last ex-0DTE fetch failed — surfaced on the tile's tooltip. */
  ex0dteError?:  string | null;
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
  /**
   * Rendered as the FIRST item inside the dock, before the DTE picker. Exists so
   * a host can put a view switcher in the toolbar it already has rather than
   * stacking another bar above it.
   */
  leading?: ReactNode;
  /** Ref to the GEX chart container — used for snap/discord screenshot */
  containerRef?: RefObject<HTMLElement | null>;
  /** Message text sent to Discord (title + expiry) */
  discordMessage?: string;
  /** Underlying ticker for the screenshot title, e.g. "SPX" */
  ticker?: string;
  /**
   * COMPACT (cog) LAYOUT — opt-in, off by default.
   *
   * Every control on this bar folds into a single cog dropdown, leaving the bar
   * itself with nothing but that cog and the snapshot / Discord buttons. /home
   * runs this way; every other host keeps the wide bar it already had, which is
   * why this is a prop rather than a rewrite.
   */
  compact?: boolean;
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
  metric = "gex", onMetric,
  ex0dte = false, onToggleEx0dte, ex0dteBusy = false, ex0dteError = null,
  onToggleOI, onToggleDex, onToggleFlip,
  onToggleGhost5, onToggleGhost15, onToggleGhost30,
  onRefresh,
  leading,
  containerRef, discordMessage, ticker = "SPX",
  compact = false,
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

  // ── Compact: one cog + snapshot + Discord ───────────────────────────────────
  // Same controls, same handlers — only the container changes. Ghost overlays
  // ride along here (they had no tile on the wide bar, so /home could never
  // reach them) and are disabled outside Net-GEX + OI, where they mean nothing.
  if (compact) {
    return (
      <div style={{ display: "flex", padding: "6px 8px 2px", flexShrink: 0 }}>
        <Dock className="dock-noscroll" style={{ width: "100%", gap: 8 }} fullWidth flat noScroll>
          {leading}
          {leading && <DockGap />}
          <DockCogMenu title="GEX chart" buttonTitle="GEX chart settings" align="left" width={330}>
            {dteOptions.length > 0 && (
              <DockMenuRow
                label="Expiry"
                hint={ex0dte ? "Showing every expiry except 0DTE — this picker still sets the live feed's expiry for the rest of the page" : undefined}
                stack
              >
                <span style={{ display: "inline-flex", opacity: ex0dte ? 0.45 : 1 }}>
                  <SegGroup options={dteOptions} active={selectedExpiry} onChange={onExpiry} />
                </span>
              </DockMenuRow>
            )}

            {onMetric && (
              <DockMenuRow label="Series">
                <SegGroup
                  options={[{ label: "GEX", value: "gex" }, { label: "DEX", value: "dex" }]}
                  active={metric}
                  onChange={(v) => onMetric(v as GexMetric)}
                />
              </DockMenuRow>
            )}

            {onToggleEx0dte && (
              <DockMenuRow label="Board">
                <ToggleTile
                  label={ex0dteBusy ? "EX-0DTE…" : "EX-0DTE"}
                  on={ex0dte}
                  onClick={onToggleEx0dte}
                  title={ex0dteError
                    ? `Ex-0DTE board unavailable: ${ex0dteError}`
                    : "Every listed expiration EXCEPT today's, summed per strike."}
                />
              </DockMenuRow>
            )}

            <DockMenuDivider />

            <DockMenuRow label="Mode" stack>
              <SegGroup
                options={[{ label: "Net GEX", value: "net" }, { label: "Call−Put", value: "call-put" }]}
                active={gexMode}
                onChange={(v) => onGexMode(v as GexMode)}
              />
            </DockMenuRow>

            <DockMenuRow label="Basis" stack>
              <SegGroup
                options={[{ label: "OI+Vol", value: "oi-vol" }, { label: "Vol Only", value: "vol-only" }, { label: "Flow GEX", value: "flow" }]}
                active={dataMode}
                onChange={(v) => onDataMode(v as DataMode)}
              />
            </DockMenuRow>

            <DockMenuDivider />

            <DockMenuRow label="Overlays" stack>
              <ToggleTile label="OI"   on={showOI}        onClick={onToggleOI} />
              <ToggleTile label="DEX"  on={showDex}       onClick={onToggleDex} />
              <ToggleTile label="Flip" on={showFlipCurve} onClick={onToggleFlip} />
            </DockMenuRow>

            <DockMenuRow
              label="Ghosts"
              hint={ghostEnabled
                ? "Draw the bar profile from 5 / 15 / 30 minutes ago behind the live bars."
                : "Prior-state ghosts only mean anything on Net GEX + OI+Vol."}
              stack
            >
              <span style={{ display: "inline-flex", gap: 6, opacity: ghostEnabled ? 1 : 0.4, pointerEvents: ghostEnabled ? "auto" : "none" }}>
                <ToggleTile label="5m"  on={showGhost5}  onClick={onToggleGhost5} />
                <ToggleTile label="15m" on={showGhost15} onClick={onToggleGhost15} />
                <ToggleTile label="30m" on={showGhost30} onClick={onToggleGhost30} />
              </span>
            </DockMenuRow>

            <DockMenuDivider />

            <DockMenuRow label="Data">
              <DockButton onClick={trigger} title="Refresh the chain" style={{ color: btnStyle.color as string }}>
                {btnLabel}
              </DockButton>
            </DockMenuRow>
          </DockCogMenu>

          <DockSpacer />
          {containerRef && <BoxSnapBtn targetRef={containerRef} label="GEX Chart" title={screenshotTitle} />}
          {containerRef && <BoxDiscordBtn targetRef={containerRef} label="GEX Chart" message={discordMessage} title={screenshotTitle} />}
        </Dock>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", padding: "6px 8px 2px", flexShrink: 0 }}>
      <Dock className="dock-noscroll" style={{ width: "100%", gap: 8 }} fullWidth flat noScroll>
        {leading}
        {leading && <DockGap />}
        {/* DTE / Expiry picker.
            Dimmed while EX-0DTE is on: the bars are then a sum across the whole
            board, so no single expiry is "the" one on screen. It stays LIVE
            rather than disabled on purpose — the picker drives SET_EXPIRY on the
            shared socket, so everything else reading that feed still needs it. */}
        {dteOptions.length > 0 && (
          <>
            <span style={{ display: "inline-flex", opacity: ex0dte ? 0.45 : 1 }}
                  title={ex0dte ? "Showing every expiry except 0DTE — this picker still sets the live feed's expiry for the rest of the page" : undefined}>
              <SegGroup options={dteOptions} active={selectedExpiry} onChange={onExpiry} />
            </span>
            <DockGap />
          </>
        )}

        {/* ── Series: gamma or delta, whole board or ex-0DTE ──────────────────
            Rendered only when the host wires them up (see the props). Placed
            right after the DTE picker, because both answer "WHICH numbers am I
            looking at" — the mode/basis groups after them answer "how are they
            drawn". */}
        {onMetric && (
          <>
            <SegGroup
              options={[{ label: "GEX", value: "gex" }, { label: "DEX", value: "dex" }]}
              active={metric}
              onChange={(v) => onMetric(v as GexMetric)}
            />
            <DockGap />
          </>
        )}
        {onToggleEx0dte && (
          <>
            <ToggleTile
              label={ex0dteBusy ? "EX-0DTE…" : "EX-0DTE"}
              on={ex0dte}
              onClick={onToggleEx0dte}
              title={ex0dteError
                ? `Ex-0DTE board unavailable: ${ex0dteError}`
                : "Every listed expiration EXCEPT today's, summed per strike. Same-day gamma dwarfs the rest of the board and decays to nothing by the close, so excluding it shows the walls that outlive today's pin."}
            />
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
          options={[{ label: "OI+Vol", value: "oi-vol" }, { label: "Vol Only", value: "vol-only" }, { label: "Flow GEX", value: "flow" }]}
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
