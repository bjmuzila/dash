"use client";

/**
 * TickerBoard — the premarket / post-market board for SPY and QQQ.
 *
 * WHY THIS IS A SEPARATE COMPONENT AND NOT A PROP ON THE SPX PAGE
 *
 * The SPX board is built on the live socket: lib/gexSocket carries one symbol,
 * and half the SPX panels (ES basis, overnight range, the gap, the per-minute
 * recorded ladder, the replay scrubber) exist only because that symbol has ES
 * futures behind it and a recorder writing its ladder every minute. None of
 * that is true for SPY or QQQ, so bolting a ticker prop onto Premarket.tsx
 * would have meant a page where a third of the cards render "—" forever.
 *
 * What these two DO have:
 *   /api/expirations + /api/chains   the same REST path the home heatmap's
 *                                    SPY/QQQ columns already use — front expiry,
 *                                    full chain, polled once a minute.
 *   /proxy/walls?symbol=SPY|QQQ      the walls recorder covers them (they are two
 *                                    of the three quick tickers on /level-log),
 *                                    so the post-market grade is the SAME saved,
 *                                    server-classified verdict SPX gets.
 *   the next expiry's chain          tomorrow's structure, same math.
 *
 * So this board carries exactly the panels those three sources can honestly
 * fill, and says "SPX only" where it cannot. One cycle behind is stated on the
 * page; a number that is not really there is not.
 *
 * Styling: the `.pmk` scope, shared with the SPX tab — same CSS block, so the
 * two boards cannot drift apart visually.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  useNextExpiryStructure,
  useRecordedWalls,
  useTickerBoard,
  LEVEL_LABEL,
  REACTION_LABEL,
  REACTION_TONE,
  type TickerRow,
  type WallLevel,
} from "./postMarketData";

// ── formatting (kept local; the SPX tab's copies are private to it) ──────────

const nf = (v: number, dp = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtPx = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : nf(v, dp);

const fmtPts = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), dp)}`;

const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : signed ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** SPY strikes are $1 wide and QQQ's are $1–$2.50 — 2dp on a level reads wrong. */
const strikeDp = (rows: TickerRow[]) => {
  if (rows.length < 2) return 0;
  const step = Math.abs(rows[1].strike - rows[0].strike);
  return step < 1 ? 1 : 0;
};

export default function TickerBoard({
  ticker,
  view,
  etDate,
}: {
  ticker: string;
  view: "pre" | "post";
  etDate: string;
}) {
  const { board, state } = useTickerBoard(ticker, true);
  const { next, state: nextState } = useNextExpiryStructure(
    view === "post" && !!board,
    board?.expiry ?? "",
    board?.spot ?? 0,
  );
  const { byLevel: recorded, state: wallState, log: wallLog } = useRecordedWalls(etDate, ticker);

  const spot = board?.spot ?? 0;
  const dp = board ? strikeDp(board.rows) : 0;
  const posGamma = (board?.netGex ?? 0) >= 0;
  const distFlip = spot > 0 && board?.flip ? spot - board.flip : null;

  /** ±12 strikes for the bar scale, ±60 rendered — same rule as the SPX profile. */
  const nearBars = useMemo(() => windowAround(board?.rows ?? [], spot, 12), [board, spot]);
  const bars = useMemo(() => windowAround(board?.rows ?? [], spot, 60), [board, spot]);
  const maxP = Math.max(1, ...nearBars.filter((b) => b.net > 0).map((b) => b.net));
  const maxN = Math.max(1, ...nearBars.filter((b) => b.net < 0).map((b) => -b.net));

  const rail = useMemo(() => {
    if (!board) return null;
    const marks: { code: string; name: string; px: number; color: string }[] = [];
    const add = (code: string, name: string, px: number | null | undefined, color: string) => {
      if (px != null && Number.isFinite(px) && px > 0) marks.push({ code, name, px, color });
    };
    add("PW", "Put Wall", board.putWall, "var(--pw)");
    add("FLIP", "Gamma Flip", board.flip, "var(--amber)");
    add("CORE", "max γ strike", board.cb, "var(--violet)");
    add("SPOT", "Spot", spot > 0 ? spot : null, "#ffffff");
    add("CW", "Call Wall", board.callWall, "var(--cw)");
    if (marks.length < 2) return null;
    const lo = Math.min(...marks.map((m) => m.px));
    const hi = Math.max(...marks.map((m) => m.px));
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.14;
    const pos = (px: number) => ((px - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100;
    const placed = marks.slice().sort((a, b) => a.px - b.px).map((m, i) => ({
      ...m, pos: pos(m.px), side: i % 2 === 0 ? "dn" : "up",
      dist: spot > 0 && m.code !== "SPOT" ? m.px - spot : null,
    }));
    const band = board.putWall != null && board.callWall != null
      ? { left: Math.min(pos(board.putWall), pos(board.callWall)),
          width: Math.abs(pos(board.callWall) - pos(board.putWall)) }
      : null;
    return { placed, band };
  }, [board, spot]);

  /**
   * The ladder renders ±60 strikes, so left alone it opens sixty strikes above
   * the money where every bar is a sliver. Same rule as the SPX profile: centre
   * on the spot row while pinned, un-pin the moment the reader scrolls (so a far
   * wall stays put once you go looking at it), and flag our own scrollTop writes
   * so the scroll event they fire is not read as the user's hand.
   */
  const chartRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const progRef = useRef(false);
  const [pinned, setPinned] = useState(true);

  const spotRowIdx = useMemo(() => {
    if (!bars.length || !(spot > 0)) return -1;
    return bars.reduce((b, r, i) => (Math.abs(r.strike - spot) < Math.abs(bars[b].strike - spot) ? i : b), 0);
  }, [bars, spot]);

  const centerOnSpot = useCallback(() => {
    const el = chartRef.current;
    if (!el || spotRowIdx < 0) return;
    progRef.current = true;
    el.scrollTop = Math.max(0, spotRowIdx * 20 + 10 - el.clientHeight / 2);
    requestAnimationFrame(() => { progRef.current = false; });
  }, [spotRowIdx]);

  useEffect(() => { if (pinnedRef.current) centerOnSpot(); }, [centerOnSpot]);

  const onChartScroll = useCallback(() => {
    if (progRef.current) return;
    if (pinnedRef.current) { pinnedRef.current = false; setPinned(false); }
  }, []);

  const repin = useCallback(() => {
    pinnedRef.current = true;
    setPinned(true);
    centerOnSpot();
  }, [centerOnSpot]);

  const wallBand = board?.callWall != null && board?.putWall != null
    ? Math.abs(board.callWall - board.putWall) : null;

  if (state !== "ok" || !board) {
    return (
      <section className="prep">
        <div className="sec">
          <div className="warnbar">
            {state === "loading"
              ? `Loading the ${ticker} chain…`
              : state === "empty"
                ? `${ticker} has no listed front expiry right now.`
                : `Could not load the ${ticker} chain. It rides /api/chains, not the live socket — a proxy hiccup shows up here first.`}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`prep${posGamma ? "" : " is-neg"}`}>

      {/* ── REGIME ────────────────────────────────────────────────────────── */}
      <div className="regime">
        <div className="regbadge">
          <span className={`dot${posGamma ? "" : " neg"}`} />
          <div>
            <div className={`lbl${posGamma ? "" : " neg"}`}>
              {posGamma ? "POSITIVE GAMMA" : "NEGATIVE GAMMA"}
            </div>
            <div className="sub">
              {posGamma ? "Dealers long gamma · mean-reverting tape" : "Dealers short gamma · moves get amplified"}
            </div>
          </div>
        </div>
        <div className="vr" />
        <div className="kpi">
          <div className="k">Net GEX</div>
          <div className="v mono">{fmtUsd(board.netGex)}</div>
        </div>
        <div className="vr" />
        <div className="kpi">
          <div className="k">Gamma Flip</div>
          <div className="v mono">
            {fmtPx(board.flip, dp)}{" "}
            <small className={distFlip == null ? undefined : distFlip >= 0 ? "chg-pos" : "chg-neg"}>
              {distFlip == null ? "" : `${fmtPts(distFlip)} / ${fmtPct(spot > 0 ? (distFlip / spot) * 100 : null)}`}
            </small>
          </div>
        </div>
        <div className="vr" />
        <div className="kpi">
          <div className="k">{ticker}</div>
          <div className="v mono">{fmtPx(spot, 2)}</div>
        </div>
        <div className={`bias${posGamma ? "" : " neg"}`}>
          <div className="t">{posGamma ? "Range day — fade the walls" : "Trend day — follow the breaks"}</div>
          <div className="d">
            {distFlip == null
              ? "No flip crossing in the current chain."
              : `${distFlip >= 0 ? "Above" : "Below"} flip by ${nf(Math.abs(distFlip), 2)}. ${
                  posGamma ? `Suppression until ${fmtPx(board.flip, dp)} breaks.` : `Acceleration until ${fmtPx(board.flip, dp)} is reclaimed.`}`}
          </div>
        </div>
      </div>

      {/* ── LEVEL RAIL ────────────────────────────────────────────────────── */}
      <div className="gexrail">
        <div className="rh">
          <h3>GEX Levels · one axis</h3>
          <span className="tiny">
            {board.expiry}
            {wallBand != null ? ` · ${nf(wallBand, dp)} wide` : ""} · polled
          </span>
        </div>
        {rail ? (
          <div className="rail">
            <div className="track2">
              {rail.band && <div className="band" style={{ left: `${rail.band.left}%`, width: `${rail.band.width}%` }} />}
            </div>
            {rail.placed.map((m) => (
              <div key={m.code}>
                <div className={`mk2${m.code === "SPOT" ? " spot" : ""}`} style={{ left: `${m.pos}%`, background: m.color }} />
                <div className={`cap2 ${m.side}`} style={{ left: `${Math.max(4, Math.min(96, m.pos))}%` }}>
                  <div className="n2" style={{ color: m.color }}>{m.code}<span className="ln"> · {m.name}</span></div>
                  <div className="v2 mono">{fmtPx(m.px, dp)}</div>
                  <div className="d2 mono">{m.code === "SPOT" ? "live chain" : fmtPts(m.dist)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rail-empty">Not enough of the chain to draw a rail.</div>
        )}
      </div>

      {/* ── KEY LEVELS ────────────────────────────────────────────────────── */}
      <div className="levels" style={{ gridTemplateColumns: "repeat(5, 1fr)" } as CSSProperties}>
        <div className="lvl call">
          <div className="name">Call Wall <em>resistance</em></div>
          <div className="px mono">{fmtPx(board.callWall, dp)}</div>
          <div className="es mono">{fmtUsd(gexAt(board.rows, board.callWall, "call"), false)}</div>
          <div className="dist">
            <span className={`mono ${board.callWall != null && board.callWall >= spot ? "chg-pos" : "chg-neg"}`}>
              {board.callWall != null ? fmtPts(board.callWall - spot) : "—"}
            </span>
            <span className="pill">resistance</span>
          </div>
        </div>

        <div className="lvl magnet">
          <div className="name">CORE <em>max γ</em></div>
          <div className="px mono">{fmtPx(board.cb, dp)}</div>
          <div className="es mono">{fmtUsd(gexAt(board.rows, board.cb, "net"), false)}</div>
          <div className="dist">
            <span className="mono">{board.cb != null ? fmtPts(board.cb - spot) : "—"}</span>
            <span className="pill">{board.cb != null && Math.abs(board.cb - spot) <= spot * 0.002 ? "pinning" : "magnet"}</span>
          </div>
        </div>

        <div className="lvl spot">
          <div className="name">Spot <em>chain</em></div>
          <div className="px mono">{fmtPx(spot, 2)}</div>
          <div className="es mono">{ticker} · {board.rows.length} strikes</div>
          <div className="dist"><span className="mono muted">1 min poll</span></div>
        </div>

        <div className="lvl pain">
          <div className="name">Max Pain <em>OI</em></div>
          <div className="px mono">{fmtPx(board.maxPain, dp)}</div>
          <div className="es mono">OI-weighted</div>
          <div className="dist">
            <span className={`mono ${board.maxPain != null && board.maxPain - spot >= 0 ? "chg-pos" : "chg-neg"}`}>
              {board.maxPain != null ? fmtPts(board.maxPain - spot) : "—"}
            </span>
            <span className="pill">{board.maxPain != null ? (board.maxPain > spot ? "drift ↑" : "drift ↓") : "—"}</span>
          </div>
        </div>

        <div className="lvl put">
          <div className="name">Put Wall <em>support</em></div>
          <div className="px mono">{fmtPx(board.putWall, dp)}</div>
          <div className="es mono">{fmtUsd(gexAt(board.rows, board.putWall, "put"), false)}</div>
          <div className="dist">
            <span className={`mono ${board.putWall != null && board.putWall <= spot ? "chg-pos" : "chg-neg"}`}>
              {board.putWall != null ? fmtPts(board.putWall - spot) : "—"}
            </span>
            <span className="pill">support</span>
          </div>
        </div>
      </div>

      {/* ── PROFILE + (PRE: range / POST: grades) ─────────────────────────── */}
      <div className="body" style={{ gridTemplateColumns: "1.5fr 1fr" } as CSSProperties}>
        <div className="col">
          <div className="colhead">
            <h3>GEX Profile by Strike</h3>
            <span className="tiny">OI + Vol · {bars.length} strikes · scroll</span>
          </div>
          <div style={{ position: "relative" }}>
          <div className="chart" ref={chartRef} onScroll={onChartScroll}>
            {bars.map((b) => {
              const pos = b.net >= 0;
              const w = (Math.abs(b.net) / (pos ? maxP : maxN)) * 50;
              const tag = tagFor(board, b.strike);
              return (
                <div className={`row${tag ? " key" : ""}`} key={b.strike}>
                  <div className="k mono">{nf(b.strike, dp)}</div>
                  <div className="track">
                    <div className={`bar ${pos ? "p" : "n"}`} style={{ width: `${w}%` }} />
                    {tag && (
                      <div
                        className="tag"
                        style={pos
                          ? { left: `${50 + w}%`, marginLeft: 6, color: tag.color, border: `1px solid ${tag.color}55` }
                          : { right: `${50 + w}%`, marginRight: 6, color: tag.color, border: `1px solid ${tag.color}55` }}
                      >
                        {tag.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {!pinned && bars.length > 0 && (
            <button type="button" className="recenter" onClick={repin}>⤒ back to spot</button>
          )}
          </div>
          <div className="axis">
            <span>{fmtUsd(-maxN, false)}</span><span>0</span><span>{fmtUsd(maxP, false)}</span>
          </div>

          <div className="greeks" style={{ gridTemplateColumns: "repeat(2,1fr)" } as CSSProperties}>
            <div className="g">
              <div className="n">Call γ</div>
              <div className="v mono chg-pos">{fmtUsd(board.callGex, false)}</div>
              <div className="m">{Math.abs(board.callGex) >= Math.abs(board.putGex) ? "call side heavier" : "put side heavier"}</div>
            </div>
            <div className="g">
              <div className="n">Put γ</div>
              <div className="v mono chg-neg">{fmtUsd(Math.abs(board.putGex), false)}</div>
              <div className="m">net {fmtUsd(board.netGex)}</div>
            </div>
          </div>
        </div>

        <div className="col">
          {view === "pre" ? (
            <>
              <div className="colhead"><h3>Expected range</h3><span className="tiny">ATM straddle × 0.85</span></div>
              <div className="stat"><span className="l">Expected move</span><span className="r mono">
                {board.em == null ? "—" : `±${nf(board.em, 2)} / ${fmtPct(spot > 0 ? (board.em / spot) * 100 : null)}`}
              </span></div>
              <div className="stat"><span className="l">EM band</span><span className="r mono">
                {board.em == null ? "—" : `${fmtPx(spot - board.em, 2)} – ${fmtPx(spot + board.em, 2)}`}
              </span></div>
              <div className="stat"><span className="l">Wall band</span><span className="r mono">
                {board.putWall != null && board.callWall != null
                  ? `${fmtPx(board.putWall, dp)} – ${fmtPx(board.callWall, dp)} (${nf(wallBand ?? 0, dp)})`
                  : "—"}
              </span></div>
              <div className="stat"><span className="l">Flip distance</span><span className="r mono">
                {distFlip == null ? "—" : `${fmtPts(distFlip)} / ${fmtPct(spot > 0 ? (distFlip / spot) * 100 : null)}`}
              </span></div>

              <div className="play">
                <div className="h">Playbook</div>
                <p>
                  {board.putWall != null && board.callWall != null ? (
                    <>
                      <b>Base case</b> <span className="k">{fmtPx(board.putWall, dp)}–{fmtPx(board.callWall, dp)}</span>.{" "}
                      {posGamma
                        ? <>Fade the edges toward <span className="k">{fmtPx(board.cb, dp)}</span>.</>
                        : <>Two-sided and fast — size down and trade the breaks.</>}{" "}
                      {board.flip != null && <>Regime turns through <span className="k">{fmtPx(board.flip, dp)}</span>.</>}
                    </>
                  ) : "Waiting for both walls before calling a base case."}
                </p>
              </div>

              <div className="warnbar" style={{ marginTop: 10 }}>
                {ticker} rides /api/chains on a one-minute poll, not the live socket — SPX-only panels
                (ES basis, overnight range, the gap, the recorded ladder and replay) are not shown rather
                than shown empty.
              </div>
            </>
          ) : (
            <>
              <div className="colhead">
                <h3>Level grades</h3>
                <span className="tiny">{wallState === "ok" ? `${ticker} wall log` : wallState === "loading" ? "loading…" : "no log"}</span>
              </div>

              {wallState !== "ok" ? (
                <div className="warnbar">
                  {wallState === "loading"
                    ? `Loading the ${ticker} wall log…`
                    : `Nothing recorded for ${ticker} on ${etDate}. The recorder covers it, so this fills in on the next sweep.`}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {(["call_wall", "cb", "put_wall"] as WallLevel[]).map((lvl) => {
                    const rec = recorded.get(lvl);
                    const last = rec?.events.length ? rec.events[rec.events.length - 1] : null;
                    const rx = last?.reaction ?? null;
                    const tone = rx ? REACTION_TONE[rx] : null;
                    const color = lvl === "call_wall" ? "var(--cw)" : lvl === "put_wall" ? "var(--pw)" : "var(--violet)";
                    return (
                      <div className="sc" key={lvl}>
                        <div className="nm">
                          <span style={{ color }}>{LEVEL_LABEL[lvl]}</span>
                          <span className={`pill${tone === "ok" ? " cool" : tone === "bad" ? " hot" : tone === "warn" ? " warn" : ""}`}>
                            {rx ? REACTION_LABEL[rx] : rec ? "UNTESTED" : "—"}
                          </span>
                        </div>
                        <div className="px mono">{fmtPx(rec?.last ?? null, dp)}</div>
                        <div className="sub">
                          {rec
                            ? [
                                rec.open != null && rec.last != null && rec.open !== rec.last
                                  ? `${nf(rec.open, dp)} → ${nf(rec.last, dp)}`
                                  : "never moved",
                                rec.moves ? `moved ${rec.moves}×` : null,
                                rec.events.length ? `${rec.events.length} events` : "no touches",
                              ].filter(Boolean).join(" · ")
                            : "not in today's log"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="colhead" style={{ marginTop: 14 }}>
                <h3>Tomorrow · after the roll</h3>
                <span className="tiny">{nextState === "ok" && next ? next.expiry : nextState === "loading" ? "loading…" : "unavailable"}</span>
              </div>
              {nextState === "ok" && next ? (
                <>
                  <div className="stat"><span className="l">Call wall</span><span className="r mono" style={{ color: "var(--cw)" }}>{fmtPx(next.callWall, dp)}</span></div>
                  <div className="stat"><span className="l">Put wall</span><span className="r mono" style={{ color: "var(--pw)" }}>{fmtPx(next.putWall, dp)}</span></div>
                  <div className="stat"><span className="l">Flip</span><span className="r mono">{fmtPx(next.flip, dp)}</span></div>
                  <div className="stat"><span className="l">Net GEX rolls to</span><span className="r mono">{fmtUsd(next.netGex)}</span></div>
                </>
              ) : (
                <div className="warnbar">
                  {nextState === "loading" ? "Pulling the next expiry…" : "Next expiry chain unavailable."}
                </div>
              )}

              {wallState === "ok" && wallLog.some((r) => r.reason === "change") && (
                <div className="movelog">
                  <div className="tiny" style={{ marginBottom: 4 }}>Level moves today</div>
                  {wallLog.filter((r) => r.reason === "change").sort((a, b) => a.slot - b.slot).slice(-6).map((r, i) => (
                    <div className="mv" key={`${r.level_type}-${r.slot}-${i}`}>
                      <span className="mono">{String(r.at ?? "").slice(0, 5) || `#${r.slot}`}</span>
                      <span style={{ color: r.level_type === "call_wall" ? "var(--cw)" : r.level_type === "put_wall" ? "var(--pw)" : "var(--violet)" }}>
                        {LEVEL_LABEL[r.level_type]}
                      </span>
                      <span className="mono">
                        {r.prev_strike != null ? `${nf(r.prev_strike, dp)} → ` : ""}{nf(r.strike, dp)}
                      </span>
                      <span className="tiny">spot {fmtPx(r.spot, 2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="footbar">
        <span className="l mono">
          {ticker} · {board.expiry} · spot {fmtPx(spot, 2)} · {board.rows.length} strikes ·
          {" "}updated {new Date(board.updatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET
        </span>
        <div className="chips">
          <span className="chip on">REST · 1 min</span>
          <span className="chip">{wallState === "ok" ? "wall log: recorded" : "wall log: none"}</span>
        </div>
      </div>
    </section>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** ±half strikes around spot, high strike first. */
function windowAround(rows: TickerRow[], spot: number, half: number): TickerRow[] {
  if (!rows.length || !(spot > 0)) return [];
  const idx = rows.reduce((b, r, i) => (Math.abs(r.strike - spot) < Math.abs(rows[b].strike - spot) ? i : b), 0);
  return rows.slice(Math.max(0, idx - half), Math.min(rows.length, idx + half + 1)).slice().reverse();
}

function gexAt(rows: TickerRow[], strike: number | null, side: "call" | "put" | "net"): number | null {
  if (strike == null) return null;
  const r = rows.find((x) => x.strike === strike);
  return r ? r[side] : null;
}

function tagFor(
  board: { callWall: number | null; putWall: number | null; cb: number | null; maxPain: number | null; flip: number | null },
  strike: number,
): { text: string; color: string } | null {
  if (board.callWall != null && strike === board.callWall) return { text: "CALL WALL", color: "var(--cw)" };
  if (board.putWall != null && strike === board.putWall) return { text: "PUT WALL", color: "var(--pw)" };
  if (board.cb != null && strike === board.cb) return { text: "CORE", color: "var(--violet)" };
  if (board.maxPain != null && strike === board.maxPain) return { text: "MAX PAIN", color: "var(--blue)" };
  return null;
}
