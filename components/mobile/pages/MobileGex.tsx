"use client";

import { useMemo, useState } from "react";
import GexChart from "@/components/dashboard/GexChart";
import type { ChainRow } from "@/lib/calculations/calculations";
import { callGEXOf, putGEXOf, netGEXOf } from "@/lib/calculations/calculations";
import { useMobileGex, type GexDataMode } from "@/hooks/useMobileGex";
import LevelsBar from "../LevelsBar";
import MobileShell from "../MobileShell";
import { expiryChips } from "../mobileNav";
import { MChipRow, MEmpty, MRow, MSegmented, MSheet, MStatusDot } from "../MobileUI";
import { M_COLOR, MONO, TYPE, fmtCount, fmtMoney, fmtPrice, fmtStrike } from "../mobileTheme";

/**
 * MobileGex — the GEX profile chart, phone edition.
 *
 * Reuses the desktop `GexChart` canvas verbatim. That is deliberate: it already
 * measures its container through a ResizeObserver, backs its canvas at
 * devicePixelRatio (so it is crisp on a 3x phone screen), and self-limits its
 * x-axis labels. Re-drawing it for mobile would mean maintaining two renderers
 * for the same numbers.
 *
 * Two things the desktop page does NOT have to solve, handled here:
 *
 *   1. GexChart sets `touchAction: "none"` on its root so it can own drag-pan.
 *      Inside a scrolling column that would eat the page's scroll gesture, so
 *      this page renders with MobileShell's `fill` mode — the chart occupies
 *      the exact remaining height and nothing below it scrolls.
 *   2. The chart's tooltip is hover-driven and therefore unreachable on touch.
 *      `onStrikeClick` opens a bottom sheet with the same numbers instead.
 */

const MODES: { id: GexDataMode; label: string }[] = [
  { id: "oi-vol", label: "OI+Vol" },
  { id: "vol-only", label: "Vol" },
];

export default function MobileGex() {
  const [dataMode, setDataMode] = useState<GexDataMode>("oi-vol");
  const [picked, setPicked] = useState<ChainRow | null>(null);
  const g = useMobileGex(dataMode);

  // 0DTE is called out by name because it is the one every SPX trader looks for
  // first. Built by the shared helper so the heatmap labels dates identically.
  const chips = useMemo(() => expiryChips(g.expirations), [g.expirations]);

  const sheetRow = picked;
  const sheetGex = sheetRow ? netGEXOf(sheetRow, dataMode === "vol-only" ? "vol" : "net", g.spot) : 0;

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
          {chips.length > 0 && (
            <MChipRow items={chips} activeId={g.expiry} onSelect={g.setExpiry} />
          )}
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
            <span style={{ fontSize: TYPE.micro, color: M_COLOR.faint, lineHeight: 1.25 }}>
              drag to pan · tap a bar
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
            flipPoint={g.flip}
            gexProfile={g.profile}
            expiry={g.expiry}
            mode="net"
            dataMode={dataMode}
            showFlipCurve
            transparentBg
            compact
            onStrikeClick={(row) => setPicked(row)}
          />
        ) : (
          <MEmpty tall>
            {g.connected ? "Loading the SPX chain…" : "Connecting to the live feed…"}
          </MEmpty>
        )}
      </div>

      <MSheet
        open={!!sheetRow}
        title={sheetRow ? fmtStrike(sheetRow.strike) : ""}
        subtitle={
          sheetRow
            ? `${g.expiry || "front expiry"} · ${sheetRow.strike >= g.spot ? "above" : "below"} spot ${fmtPrice(g.spot)}`
            : undefined
        }
        onClose={() => setPicked(null)}
      >
        {sheetRow && (
          <>
            <MRow
              label={dataMode === "vol-only" ? "Net GEX (vol)" : "Net GEX"}
              value={fmtMoney(sheetGex)}
              accent={sheetGex >= 0 ? M_COLOR.pos : M_COLOR.neg}
            />
            <MRow
              label="Call GEX"
              value={fmtMoney(callGEXOf(sheetRow, dataMode === "vol-only" ? "vol" : "net", g.spot))}
              accent={M_COLOR.pos}
            />
            <MRow
              label="Put GEX"
              value={fmtMoney(putGEXOf(sheetRow, dataMode === "vol-only" ? "vol" : "net", g.spot))}
              accent={M_COLOR.neg}
            />
            <MRow label="Net DEX" value={fmtMoney(sheetRow.netDEX ?? 0)} />
            <div style={{ height: 1, background: M_COLOR.border, margin: "2px 0" }} />
            <MRow label="Call OI" value={fmtCount(sheetRow.callOI ?? 0)} accent={M_COLOR.pos} />
            <MRow label="Put OI" value={fmtCount(sheetRow.putOI ?? 0)} accent={M_COLOR.neg} />
            <MRow label="Call volume" value={fmtCount(sheetRow.callVolume ?? 0)} accent={M_COLOR.pos} />
            <MRow label="Put volume" value={fmtCount(sheetRow.putVolume ?? 0)} accent={M_COLOR.neg} />
            {(sheetRow.callIV ?? 0) > 0 && (
              <MRow label="Call IV" value={`${((sheetRow.callIV ?? 0) * 100).toFixed(1)}%`} />
            )}
            {(sheetRow.putIV ?? 0) > 0 && (
              <MRow label="Put IV" value={`${((sheetRow.putIV ?? 0) * 100).toFixed(1)}%`} />
            )}
          </>
        )}
      </MSheet>
    </MobileShell>
  );
}
