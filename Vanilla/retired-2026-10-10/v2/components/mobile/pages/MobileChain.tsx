"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMobileChain, type ChainStrike } from "@/hooks/useMobileChain";
import MobileShell from "../MobileShell";
import { SearchIcon } from "../MobileIcons";
import { MChipRow, MEmpty, MRow, MSegmented, MSheet } from "../MobileUI";
import {
  M_COLOR,
  MONO,
  RADIUS,
  TYPE,
  fmtCount,
  fmtMoney,
  fmtMoneyAbs,
  fmtPrice,
  fmtStrike,
  gridCols,
  noTapHighlight,
  rgba,
} from "../mobileTheme";

/**
 * MobileChain — a purpose-built option chain for a 390px screen.
 *
 * The desktop /options-chain is not a call/put chain at all: it is a strikes ×
 * expirations matrix of ONE scalar (GEX, or DEX/VEX/CHEX/ΔOI), fourteen columns
 * wide, and the per-side call/put detail exists only in a hover card. Neither
 * of those survives contact with a phone — fourteen columns don't fit, and
 * hover doesn't exist on touch.
 *
 * So the layout here is the classic strike-centred ladder — calls left, strike
 * spine, puts right — and the hover card becomes a tap-through bottom sheet.
 *
 * The DATA is the desktop's, unchanged: useMobileChain calls the same
 * /api/chains endpoint through the same `dedupeFetch`, and runs the same
 * `parseExpiration` from lib/calculations/optionChain. Every number here is
 * computed by the exact code that produces the desktop's, so a strike cannot
 * read one GEX on the phone and another on the monitor.
 */

const QUICK_TICKERS = ["SPX", "SPY", "QQQ", "NDX", "IWM"];
const WINDOWS = [
  { id: "10", label: "±10" },
  { id: "20", label: "±20" },
  { id: "40", label: "±40" },
  { id: "all", label: "All" },
];
const SIDE_METRICS: { id: "oi" | "vol"; label: string }[] = [
  { id: "oi", label: "Open Int" },
  { id: "vol", label: "Volume" },
];

const GRID = gridCols("1fr 62px 1fr");
const ROW_H = 36;

/**
 * One side of a row. The magnitude bar grows from the strike spine outward, so
 * the two sides read as a back-to-back histogram and the imbalance at a strike
 * is visible without reading a single digit.
 */
function SideCell({
  primary,
  secondary,
  ratio,
  color,
  side,
}: {
  primary: number;
  secondary: number;
  ratio: number;
  color: string;
  side: "call" | "put";
}) {
  const isCall = side === "call";
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: isCall ? "flex-end" : "flex-start",
        gap: 8,
        padding: isCall ? "0 9px 0 6px" : "0 6px 0 9px",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 5,
          bottom: 5,
          [isCall ? "right" : "left"]: 0,
          width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
          background: `linear-gradient(${isCall ? "270deg" : "90deg"}, ${rgba(color, 0.22)}, ${rgba(color, 0.02)})`,
          borderRadius: 3,
          pointerEvents: "none",
        }}
      />
      {!isCall && (
        <span style={{ ...MONO, position: "relative", fontSize: TYPE.micro, color: M_COLOR.faint, minWidth: 34, textAlign: "left" }}>
          {secondary ? fmtCount(secondary) : "·"}
        </span>
      )}
      <span
        style={{
          ...MONO,
          position: "relative",
          fontSize: TYPE.body,
          fontWeight: 700,
          color: primary ? M_COLOR.text : M_COLOR.faint,
          whiteSpace: "nowrap",
        }}
      >
        {primary ? fmtCount(primary) : "·"}
      </span>
      {isCall && (
        <span style={{ ...MONO, position: "relative", fontSize: TYPE.micro, color: M_COLOR.faint, minWidth: 34, textAlign: "right" }}>
          {secondary ? fmtCount(secondary) : "·"}
        </span>
      )}
    </div>
  );
}

export default function MobileChain() {
  const c = useMobileChain("SPX");
  const [win, setWin] = useState("20");
  const [metric, setMetric] = useState<"oi" | "vol">("oi");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ChainStrike | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const centeredForRef = useRef("");

  const rows = useMemo(() => {
    if (!c.strikes.length) return [];
    // Highest strike at the top, like every trading ladder.
    const all = [...c.strikes].sort((a, b) => b.strike - a.strike);
    if (win === "all" || !c.atm) return all;
    const n = Number(win);
    const idx = all.findIndex((r) => r.strike === c.atm);
    if (idx < 0) return all;
    return all.slice(Math.max(0, idx - n), idx + n + 1);
  }, [c.strikes, c.atm, win]);

  // One shared denominator across both sides so a call bar and a put bar of the
  // same length mean the same number of contracts.
  const maxSide = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const cv = metric === "oi" ? r.cell.callOI : r.cell.callVol;
      const pv = metric === "oi" ? r.cell.putOI : r.cell.putVol;
      if (cv > m) m = cv;
      if (pv > m) m = pv;
    }
    return m || 1;
  }, [rows, metric]);

  // Centre on ATM once per (ticker, expiry) — not on every poll, which would
  // fight a user who has scrolled up to look at the wings.
  useEffect(() => {
    const key = `${c.ticker}|${c.expiry}`;
    if (!rows.length || !c.atm || centeredForRef.current === key) return;
    const el = bodyRef.current;
    if (!el) return;
    const idx = rows.findIndex((r) => r.strike === c.atm);
    if (idx < 0) return;
    centeredForRef.current = key;
    requestAnimationFrame(() => {
      el.scrollTop = Math.max(0, idx * (ROW_H + 2) - el.clientHeight / 2);
    });
  }, [rows, c.atm, c.ticker, c.expiry]);

  const expiryChips = useMemo(
    () =>
      c.expiries.slice(0, 16).map((e) => ({
        id: e.value,
        label: e.dte === 0 ? "0DTE" : e.label.slice(4),
        sub: e.dte === 0 ? undefined : `${e.dte}d`,
      })),
    [c.expiries],
  );

  const submitTicker = () => {
    const t = query.trim().toUpperCase();
    if (t) {
      c.setTicker(t);
      setQuery("");
      centeredForRef.current = "";
    }
  };

  const sheetCell = picked?.cell;

  return (
    <MobileShell
      title="Option Chain"
      right={
        <span style={{ ...MONO, fontSize: TYPE.label, fontWeight: 800, color: M_COLOR.cyan }}>
          {c.ticker} {c.spot > 0 ? fmtPrice(c.spot) : ""}
        </span>
      }
      fill
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                flex: 1,
                minWidth: 0,
                height: 34,
                padding: "0 10px",
                borderRadius: RADIUS.pill,
                border: `1px solid ${M_COLOR.border}`,
                background: "rgba(255,255,255,0.04)",
                color: M_COLOR.faint,
              }}
            >
              <SearchIcon size={15} />
              <input
                className="cbm-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitTicker();
                }}
                onBlur={submitTicker}
                placeholder="Symbol"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: M_COLOR.text,
                  // 16px (via .cbm-input) so iOS Safari doesn't zoom the page on
                  // focus; the visual size is controlled by the pill's height.
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  padding: 0,
                }}
              />
            </div>
            <div style={{ width: 150, flexShrink: 0 }}>
              <MSegmented options={SIDE_METRICS} value={metric} onChange={setMetric} accent={M_COLOR.up} />
            </div>
          </div>

          <MChipRow
            items={QUICK_TICKERS.map((t) => ({ id: t, label: t }))}
            activeId={c.ticker}
            onSelect={(t) => {
              c.setTicker(t);
              centeredForRef.current = "";
            }}
          />

          {expiryChips.length > 0 && (
            <MChipRow items={expiryChips} activeId={c.expiry} onSelect={c.setExpiry} />
          )}

          <MChipRow items={WINDOWS} activeId={win} onSelect={setWin} />
        </div>
      }
    >
      {/* Column headers */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          ...GRID,
          alignItems: "center",
          height: 22,
          margin: "0 12px",
          borderBottom: `1px solid ${M_COLOR.border}`,
          fontSize: TYPE.micro - 2,
          fontWeight: 800,
          letterSpacing: "0.08em",
        }}
      >
        <div style={{ textAlign: "right", paddingRight: 9, color: rgba(M_COLOR.pos, 0.85) }}>
          CALLS {metric === "oi" ? "OI · VOL" : "VOL · OI"}
        </div>
        <div style={{ textAlign: "center", color: M_COLOR.faint }}>STRIKE</div>
        <div style={{ textAlign: "left", paddingLeft: 9, color: rgba(M_COLOR.neg, 0.85) }}>
          {metric === "oi" ? "OI · VOL" : "VOL · OI"} PUTS
        </div>
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
          padding: "2px 12px 10px",
        }}
      >
        {c.error && !rows.length ? (
          <MEmpty tall>{c.error}</MEmpty>
        ) : !rows.length ? (
          <MEmpty tall>{c.loading ? `Loading the ${c.ticker} chain…` : "No strikes for this expiry."}</MEmpty>
        ) : (
          rows.map((r) => {
            const isAtm = r.strike === c.atm;
            const itm = c.spot > 0;
            const callPrimary = metric === "oi" ? r.cell.callOI : r.cell.callVol;
            const callSecondary = metric === "oi" ? r.cell.callVol : r.cell.callOI;
            const putPrimary = metric === "oi" ? r.cell.putOI : r.cell.putVol;
            const putSecondary = metric === "oi" ? r.cell.putVol : r.cell.putOI;
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
                  marginBottom: 2,
                  padding: 0,
                  border: "none",
                  borderRadius: RADIUS.sm,
                  background: isAtm ? rgba(M_COLOR.cyan, 0.1) : "rgba(255,255,255,0.018)",
                  boxShadow: isAtm ? `inset 0 0 0 1px ${rgba(M_COLOR.cyan, 0.4)}` : "none",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  overflow: "hidden",
                }}
              >
                <SideCell
                  primary={callPrimary}
                  secondary={callSecondary}
                  ratio={callPrimary / maxSide}
                  color={M_COLOR.pos}
                  side="call"
                />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    background: isAtm ? "transparent" : "rgba(255,255,255,0.03)",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      ...MONO,
                      fontSize: TYPE.label,
                      fontWeight: 800,
                      lineHeight: 1,
                      color: isAtm
                        ? M_COLOR.cyan
                        : itm && r.strike > c.spot
                          ? M_COLOR.dim
                          : M_COLOR.text,
                    }}
                  >
                    {fmtStrike(r.strike)}
                  </span>
                  <span
                    style={{
                      ...MONO,
                      fontSize: TYPE.micro - 3,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: r.cell.gex >= 0 ? rgba(M_COLOR.pos, 0.85) : rgba(M_COLOR.neg, 0.85),
                    }}
                  >
                    {r.cell.gex ? fmtMoneyAbs(r.cell.gex).replace("$", "") : "·"}
                  </span>
                </div>
                <SideCell
                  primary={putPrimary}
                  secondary={putSecondary}
                  ratio={putPrimary / maxSide}
                  color={M_COLOR.neg}
                  side="put"
                />
              </button>
            );
          })
        )}
      </div>

      <MSheet
        open={!!picked}
        title={picked ? `${c.ticker} ${fmtStrike(picked.strike)}` : ""}
        subtitle={picked ? `${c.expiry} · spot ${fmtPrice(c.spot)}` : undefined}
        onClose={() => setPicked(null)}
      >
        {sheetCell && (
          <>
            <MRow label="Net GEX" value={fmtMoney(sheetCell.gex)} accent={sheetCell.gex >= 0 ? M_COLOR.pos : M_COLOR.neg} />
            <MRow label="Vol GEX" value={fmtMoney(sheetCell.volGex)} accent={sheetCell.volGex >= 0 ? M_COLOR.pos : M_COLOR.neg} />
            <MRow label="Net DEX" value={fmtMoney(sheetCell.dex)} />
            <MRow label="Net VEX" value={fmtMoney(sheetCell.vex)} />
            <MRow label="Net CHEX" value={fmtMoney(sheetCell.chex)} />
            <div style={{ height: 1, background: M_COLOR.border, margin: "2px 0" }} />
            <MRow label="Call OI" value={fmtCount(sheetCell.callOI)} accent={M_COLOR.pos} />
            <MRow label="Put OI" value={fmtCount(sheetCell.putOI)} accent={M_COLOR.neg} />
            <MRow label="Net OI (C−P)" value={fmtCount(sheetCell.oi)} accent={sheetCell.oi >= 0 ? M_COLOR.pos : M_COLOR.neg} />
            <MRow label="Call volume" value={fmtCount(sheetCell.callVol)} accent={M_COLOR.pos} />
            <MRow label="Put volume" value={fmtCount(sheetCell.putVol)} accent={M_COLOR.neg} />
            <div style={{ height: 1, background: M_COLOR.border, margin: "2px 0" }} />
            <MRow label="Call premium" value={fmtMoneyAbs(sheetCell.callPrem)} accent={M_COLOR.pos} />
            <MRow label="Put premium" value={fmtMoneyAbs(sheetCell.putPrem)} accent={M_COLOR.neg} />
            <MRow
              label="Net premium"
              value={fmtMoney(sheetCell.callPrem - sheetCell.putPrem)}
              accent={sheetCell.callPrem - sheetCell.putPrem >= 0 ? M_COLOR.pos : M_COLOR.neg}
            />
          </>
        )}
      </MSheet>
    </MobileShell>
  );
}
