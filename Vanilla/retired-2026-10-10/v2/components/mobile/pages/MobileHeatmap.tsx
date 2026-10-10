"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { metricBg } from "@/lib/calculations/optionChain";
import { netGEXOf, type ChainRow } from "@/lib/calculations/calculations";
import { useMobileGex } from "@/hooks/useMobileGex";
import LevelsBar from "../LevelsBar";
import ExpiryBadge from "../ExpiryBadge";
import { deriveMobileLevels } from "../gexLevels";
import MobileShell from "../MobileShell";
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

/**
 * Strike column width.
 *
 * 56px was measured against a bare 4-digit strike and forgot the CB/CW/PW tag
 * that rides beside it: 6px pad + 3px marker rail + gaps + ~29px of strike +
 * the tag runs past 56 and spills into NET — and because the value cells paint
 * a tinted background, the tag ended up sitting ON the red. 70px fits the
 * marked case, and the cell clips so nothing can leak into NET again if a
 * strike ever carries a decimal.
 */
const GRID = gridCols("70px repeat(3, minmax(0, 1fr))");
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

/**
 * The CB / CW / PW readout, mirroring Multi Greek's header pills.
 *
 * Same three levels, same colors, same de-duplication rule — see gexLevels.
 * Rendered as pills rather than as a fourth/fifth column because at 390px the
 * grid has room for three data columns and no more, and these are levels
 * (one strike each) rather than per-strike values.
 */
function WallPills({
  cb,
  callWall,
  putWall,
}: {
  cb: number | null;
  callWall: number | null;
  putWall: number | null;
}) {
  const items = [
    { t: "CB", c: M_COLOR.cb, s: cb, title: "Core Bullseye — highest |GEX| strike" },
    { t: "CW", c: M_COLOR.pos, s: callWall, title: "Call Wall — highest +GEX strike" },
    { t: "PW", c: M_COLOR.neg, s: putWall, title: "Put Wall — most −GEX strike" },
  ].filter((x) => x.s != null);
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
      {items.map((x) => (
        <span
          key={x.t}
          title={x.title}
          style={{
            flex: 1,
            minWidth: 0,
            display: "inline-flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 5,
            padding: "5px 6px",
            borderRadius: RADIUS.sm,
            background: rgba(x.c, 0.12),
            border: `1px solid ${rgba(x.c, 0.4)}`,
          }}
        >
          <span style={{ fontSize: TYPE.micro - 2, fontWeight: 900, color: x.c, letterSpacing: "0.05em" }}>
            {x.t}
          </span>
          <span style={{ ...MONO, fontSize: TYPE.label + 1, fontWeight: 800, whiteSpace: "nowrap" }}>
            {fmtStrike(x.s as number)}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function MobileHeatmap() {
  const g = useMobileGex("oi-vol");
  const [win, setWin] = useState("20");
  const [picked, setPicked] = useState<Row | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const centeredRef = useRef(false);

  // CB / CW / PW together, from one chain snapshot, so CB can never collide
  // with a wall — see gexLevels for why the feed's own walls aren't used.
  const levels = useMemo(() => deriveMobileLevels(g.chain, g.spot), [g.chain, g.spot]);

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
          <LevelsBar
            spot={g.spot}
            prevClose={g.prevClose}
            flip={g.flip}
            callWall={g.callWall}
            putWall={g.putWall}
          />
          <WallPills cb={levels.cb} callWall={levels.callWall} putWall={levels.putWall} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MChipRow items={WINDOWS} activeId={win} onSelect={setWin} />
            </div>
            <ExpiryBadge expiry={g.expiry} isZeroDte={g.isZeroDte} dte={g.dte} />
          </div>
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
            // Marker precedence matches Multi Greek's: CB wins, then the two
            // walls. They cannot collide anyway (deriveMobileLevels is
            // cb-aware), but the order documents the intent.
            const markerTag =
              levels.cb === r.strike ? "CB"
              : levels.callWall === r.strike ? "CW"
              : levels.putWall === r.strike ? "PW"
              : null;
            const marker =
              markerTag === "CB" ? M_COLOR.cb
              : markerTag === "CW" ? M_COLOR.pos
              : markerTag === "PW" ? M_COLOR.neg
              : null;
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    paddingLeft: 6,
                    paddingRight: 2,
                    minWidth: 0,
                    // Hard clip: the CB/CW/PW tag belongs to the strike cell and
                    // must never render over the NET column's heat tint.
                    overflow: "hidden",
                  }}
                >
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
                  {markerTag && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: TYPE.micro - 3,
                        fontWeight: 900,
                        letterSpacing: "0.02em",
                        color: "#04121a",
                        background: marker ?? "transparent",
                        borderRadius: 2,
                        padding: "0 2px",
                        lineHeight: 1.3,
                      }}
                    >
                      {markerTag}
                    </span>
                  )}
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
