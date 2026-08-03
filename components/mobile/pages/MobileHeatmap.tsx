"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { metricBg } from "@/lib/calculations/optionChain";
import { netGEXOf, type ChainRow } from "@/lib/calculations/calculations";
import { useMobileGex } from "@/hooks/useMobileGex";
import LevelsBar from "../LevelsBar";
import MobileShell from "../MobileShell";
import { expiryChips } from "../mobileNav";
import { MChipRow, MEmpty, MRow, MSheet, MStatusDot } from "../MobileUI";
import {
  M_COLOR,
  MONO,
  RADIUS,
  TYPE,
  fmtCount,
  fmtMoney,
  fmtPrice,
  fmtStrike,
  gridCols,
  noTapHighlight,
  rgba,
} from "../mobileTheme";

/**
 * MobileHeatmap — the per-strike GEX heat grid, rebuilt for a phone.
 *
 * WHY NOT REUSE components/dashboard/GexHeatmap
 * ---------------------------------------------
 * That component is a fixed six-column CSS grid (`68px repeat(N, 1fr)`) with
 * `overflow: hidden` on its root and no horizontal scroll. At 390px each data
 * column gets 53px, of which padding leaves ~42px of text — and a single cell
 * reads "-$1,234M". Every value clips, and headers like "30 MIN ROLLING NET
 * GEX" wrap to four lines. It also has no column-selection prop, so there is no
 * way to ask it for fewer columns from the outside.
 *
 * So the layout is new and the DATA and the COLOR RAMP are not: values come
 * from the same `netGEXOf` the chart uses, and the tint comes from the same
 * `metricBg` the desktop chain uses. A strike that is the deepest red here is
 * the deepest red there.
 *
 * Three columns is the honest maximum at this width. NET (OI+Vol), VOL (volume
 * only) and DEX cover what the desktop's six say; the rest — rolling, speed,
 * GEX+VEX — move into the per-strike sheet where they have room.
 */

const WINDOWS = [
  { id: "10", label: "±10" },
  { id: "20", label: "±20" },
  { id: "40", label: "±40" },
  { id: "all", label: "All" },
];

const GRID = gridCols("56px repeat(3, minmax(0, 1fr))");
const ROW_H = 34;

type Row = {
  strike: number;
  raw: ChainRow;
  net: number;
  vol: number;
  dex: number;
};

function HeadCell({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div
      style={{
        fontSize: TYPE.micro - 2,
        fontWeight: 800,
        letterSpacing: "0.08em",
        color: M_COLOR.faint,
        textAlign: align,
        padding: "0 8px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </div>
  );
}

function ValueCell({ value, bg }: { value: number; bg: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "0 8px",
        background: bg,
        minWidth: 0,
      }}
    >
      <span
        style={{
          ...MONO,
          fontSize: TYPE.label,
          fontWeight: 700,
          color: value === 0 ? M_COLOR.faint : M_COLOR.text,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value === 0 ? "·" : fmtMoney(value, 1)}
      </span>
    </div>
  );
}

export default function MobileHeatmap() {
  const g = useMobileGex("oi-vol");
  const [win, setWin] = useState("20");
  const [picked, setPicked] = useState<Row | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const centeredRef = useRef(false);

  const chips = useMemo(() => expiryChips(g.expirations), [g.expirations]);

  const atm = useMemo(() => {
    if (!g.chain.length || g.spot <= 0) return 0;
    return g.chain.reduce(
      (best, r) => (Math.abs(r.strike - g.spot) < Math.abs(best - g.spot) ? r.strike : best),
      g.chain[0].strike,
    );
  }, [g.chain, g.spot]);

  const rows: Row[] = useMemo(() => {
    if (!g.chain.length) return [];
    const all = [...g.chain]
      .sort((a, b) => b.strike - a.strike) // highest strike on top, like a ladder
      .map((r) => ({
        strike: r.strike,
        raw: r,
        net: netGEXOf(r, "net", g.spot),
        vol: netGEXOf(r, "vol", g.spot),
        dex: r.netDEX ?? 0,
      }));
    if (win === "all" || !atm) return all;
    const n = Number(win);
    const idx = all.findIndex((r) => r.strike === atm);
    if (idx < 0) return all;
    return all.slice(Math.max(0, idx - n), idx + n + 1);
  }, [g.chain, g.spot, win, atm]);

  // One shared scale per column, so a value's tint means the same thing down
  // the whole column. metricBg additionally gives the top three magnitudes
  // fixed floors, which is what makes the dominant strikes pop.
  const scales = useMemo(() => {
    const build = (get: (r: Row) => number) => {
      const mags = rows.map((r) => Math.abs(get(r))).filter((v) => v > 0);
      const sorted = [...mags].sort((a, b) => b - a);
      return { max: sorted[0] ?? 0, top: sorted.slice(0, 3) };
    };
    return { net: build((r) => r.net), vol: build((r) => r.vol), dex: build((r) => r.dex) };
  }, [rows]);

  // Centre on ATM once, when the first frame lands. Re-centring on every tick
  // would yank the list out from under a user who has scrolled away.
  useEffect(() => {
    if (centeredRef.current || !rows.length || !atm) return;
    const el = bodyRef.current;
    if (!el) return;
    const idx = rows.findIndex((r) => r.strike === atm);
    if (idx < 0) return;
    centeredRef.current = true;
    requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H / 2);
    });
  }, [rows, atm]);

  return (
    <MobileShell
      title="GEX Heatmap"
      fill
      right={<MStatusDot live={g.source === "live" && g.connected} label={g.source === "rest" ? "DELAYED" : undefined} />}
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {chips.length > 0 && <MChipRow items={chips} activeId={g.expiry} onSelect={g.setExpiry} />}
          <LevelsBar
            spot={g.spot}
            prevClose={g.prevClose}
            flip={g.flip}
            callWall={g.callWall}
            putWall={g.putWall}
          />
          <MChipRow items={WINDOWS} activeId={win} onSelect={setWin} />
        </div>
      }
    >
      {/* Column headers — sticky by living outside the scroll body. */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          ...GRID,
          alignItems: "center",
          height: 22,
          margin: "0 12px",
          borderBottom: `1px solid ${M_COLOR.border}`,
        }}
      >
        <HeadCell align="left">STRIKE</HeadCell>
        <HeadCell>NET</HeadCell>
        <HeadCell>VOL</HeadCell>
        <HeadCell>DEX</HeadCell>
      </div>

      <div
        ref={bodyRef}
        className="cbm-vscroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorY: "contain",
          padding: "0 12px 10px",
        }}
      >
        {rows.length === 0 ? (
          <MEmpty tall>{g.connected ? "Loading the SPX chain…" : "Connecting to the live feed…"}</MEmpty>
        ) : (
          rows.map((r) => {
            const isAtm = r.strike === atm;
            const isCallWall = g.callWall != null && r.strike === g.callWall;
            const isPutWall = g.putWall != null && r.strike === g.putWall;
            const isFlip = g.flip != null && Math.abs(r.strike - g.flip) < 0.51;
            const marker = isCallWall ? M_COLOR.pos : isPutWall ? M_COLOR.neg : isFlip ? M_COLOR.orange : null;
            return (
              <button
                key={r.strike}
                type="button"
                onClick={() => setPicked(r)}
                style={{
                  ...noTapHighlight,
                  display: "grid",
                  ...GRID,
                  alignItems: "stretch",
                  width: "100%",
                  height: ROW_H,
                  padding: 0,
                  border: "none",
                  borderRadius: RADIUS.sm,
                  overflow: "hidden",
                  marginBottom: 2,
                  background: isAtm ? rgba(M_COLOR.cyan, 0.09) : "transparent",
                  boxShadow: isAtm ? `inset 0 0 0 1px ${rgba(M_COLOR.cyan, 0.4)}` : "none",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 6, minWidth: 0 }}>
                  {/* Wall / flip marker occupies a fixed 3px rail so strike
                      numbers stay aligned whether or not a row is marked. */}
                  <span
                    aria-hidden
                    style={{
                      width: 3,
                      height: 18,
                      borderRadius: 2,
                      background: marker ?? "transparent",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      ...MONO,
                      fontSize: TYPE.label,
                      fontWeight: isAtm ? 800 : 600,
                      color: isAtm ? M_COLOR.cyan : marker ?? M_COLOR.dim,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtStrike(r.strike)}
                  </span>
                </div>
                <ValueCell value={r.net} bg={metricBg(r.net, scales.net.max, 1.4, scales.net.top)} />
                <ValueCell value={r.vol} bg={metricBg(r.vol, scales.vol.max, 1.4, scales.vol.top)} />
                <ValueCell value={r.dex} bg={metricBg(r.dex, scales.dex.max, 1.4, scales.dex.top)} />
              </button>
            );
          })
        )}
      </div>

      <MSheet
        open={!!picked}
        title={picked ? fmtStrike(picked.strike) : ""}
        subtitle={picked ? `${fmtPrice(Math.abs(picked.strike - g.spot), 0)} pts from spot ${fmtPrice(g.spot)}` : undefined}
        onClose={() => setPicked(null)}
      >
        {picked && (
          <>
            <MRow label="Net GEX (OI+Vol)" value={fmtMoney(picked.net)} accent={picked.net >= 0 ? M_COLOR.pos : M_COLOR.neg} />
            <MRow label="Net GEX (Vol only)" value={fmtMoney(picked.vol)} accent={picked.vol >= 0 ? M_COLOR.pos : M_COLOR.neg} />
            <MRow label="Net DEX" value={fmtMoney(picked.dex)} />
            <MRow label="Net Vanna" value={fmtMoney(picked.raw.netVanna ?? 0)} />
            <div style={{ height: 1, background: M_COLOR.border, margin: "2px 0" }} />
            <MRow label="Call OI" value={fmtCount(picked.raw.callOI ?? 0)} accent={M_COLOR.pos} />
            <MRow label="Put OI" value={fmtCount(picked.raw.putOI ?? 0)} accent={M_COLOR.neg} />
            <MRow label="Call volume" value={fmtCount(picked.raw.callVolume ?? 0)} accent={M_COLOR.pos} />
            <MRow label="Put volume" value={fmtCount(picked.raw.putVolume ?? 0)} accent={M_COLOR.neg} />
          </>
        )}
      </MSheet>
    </MobileShell>
  );
}
