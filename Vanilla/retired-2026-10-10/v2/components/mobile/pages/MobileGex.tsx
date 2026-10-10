"use client";

import { useState } from "react";
import GexChart from "@/components/dashboard/GexChart";
import { useMobileGex, type GexDataMode } from "@/hooks/useMobileGex";
import LevelsBar from "../LevelsBar";
import MobileShell from "../MobileShell";
import ExpiryBadge from "../ExpiryBadge";
import { MEmpty, MSegmented, MStatusDot } from "../MobileUI";
import { M_COLOR, MONO, TYPE, fmtMoney } from "../mobileTheme";

/**
 * MobileGex — the GEX profile chart, phone edition.
 *
 * Reuses the desktop `GexChart` canvas verbatim. That is deliberate: it already
 * measures its container through a ResizeObserver, backs its canvas at
 * devicePixelRatio (so it is crisp on a 3x phone screen), and self-limits its
 * x-axis labels. Re-drawing it for mobile would mean maintaining two renderers
 * for the same numbers.
 *
 * GexChart sets `touchAction: "none"` on its root so it can own drag-pan.
 * Inside a scrolling column that would eat the page's scroll gesture, so this
 * page renders with MobileShell's `fill` mode — the chart occupies the exact
 * remaining height and nothing below it scrolls.
 *
 * Deliberately NOT here:
 *   - an expiry picker. The phone build is 0DTE-only (see useMobileGex).
 *   - the gamma-flip curve. `flipPoint` is passed as null and `showFlipCurve`
 *     is off, so the chart draws bars and nothing else. The flip value is still
 *     in the levels bar above, where it is a number rather than a line across
 *     the only 550px of chart a phone has.
 *   - a tap-a-bar detail sheet. It read well but it fired on every pan that
 *     ended on a bar, and the numbers it showed are the ones the heatmap tab
 *     already lists per strike.
 */

const MODES: { id: GexDataMode; label: string }[] = [
  { id: "oi-vol", label: "OI+Vol" },
  { id: "vol-only", label: "Vol" },
];

export default function MobileGex() {
  const [dataMode, setDataMode] = useState<GexDataMode>("oi-vol");
  const g = useMobileGex(dataMode);

  return (
    <MobileShell
      title="Gamma Exposure"
      fill
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {g.totalNetGex != null && (
            <span
              style={{
                ...MONO,
                fontSize: TYPE.label,
                fontWeight: 800,
                color: g.totalNetGex >= 0 ? M_COLOR.pos : M_COLOR.neg,
              }}
            >
              {fmtMoney(g.totalNetGex)}
            </span>
          )}
          <MStatusDot live={g.source === "live" && g.connected} label={g.source === "rest" ? "DELAYED" : undefined} />
        </div>
      }
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <LevelsBar
            spot={g.spot}
            prevClose={g.prevClose}
            flip={g.flip}
            callWall={g.callWall}
            putWall={g.putWall}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 150 }}>
              <MSegmented options={MODES} value={dataMode} onChange={setDataMode} />
            </div>
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} dte={g.dte} />
            <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, lineHeight: 1.25, marginLeft: "auto" }}>
              drag to pan
            </span>
          </div>
        </div>
      }
    >
      <div style={{ flex: 1, minHeight: 0, position: "relative", padding: "0 6px 6px" }}>
        {g.hasData && g.chain.length > 0 ? (
          <GexChart
            chain={g.chain}
            spotPrice={g.spot}
            // No flip on the phone chart — see the header note.
            flipPoint={null}
            expiry={g.expiry}
            mode="net"
            dataMode={dataMode}
            transparentBg
            compact
          />
        ) : (
          <MEmpty tall>
            {g.connected ? "Loading the SPX chain…" : "Connecting to the live feed…"}
          </MEmpty>
        )}
      </div>
    </MobileShell>
  );
}
