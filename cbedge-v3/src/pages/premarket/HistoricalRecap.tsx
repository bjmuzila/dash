/**
 * /premarket → the SESSION PICKER's past-date view.
 *
 * The Premarket and Post-Market tabs are both LIVE surfaces: every number on
 * them comes off the current chain (lib/gexSocket → useMobileGex) or off a
 * quote fetched now. Point the page's date picker at a previous session and
 * none of that applies — the live chain still describes TODAY. Feeding a past
 * date into PostMarketTab would therefore have printed today's walls, today's
 * net GEX and today's premium under yesterday's headline, which is the one
 * failure mode that whole tab's header rules out ("NOTHING HERE IS SYNTHETIC").
 *
 * So a past session gets its own view, built on the stores that are actually
 * keyed by date. There are four, and they have very different reach — which is
 * the whole reason this file reads from all of them instead of one:
 *
 *   /proxy/gex-levels-history     THE DEEP ONE. One settled row per session,
 *   (useGexLevelsHistory)         kept FOREVER, and gap-filled from settled
 *                                 ThetaData OI on boot. Spot, call wall, put
 *                                 wall, gamma flip, dollar gamma, call/put
 *                                 gamma ratio, the second wall each side, total
 *                                 OI and a 48-point cumulative GEX curve. This
 *                                 is what makes an ARBITRARY past date work,
 *                                 and it is also what fills the picker.
 *   /api/eod-gex                  the other settled per-day row: the 0DTE /
 *   (useEodGex)                   ex-0DTE split and the recorder's own pin
 *                                 (strike + share of board gamma).
 *   /api/snapshots/candles        the session's ES 5m bars, so the day has a
 *   (useSessionEsBars)            real price path and a real range. ES, not
 *                                 SPX, and labelled as such — see the hook.
 *   /proxy/walls?date&symbol      the intraday GRADE: the 09:29 capture, every
 *   (useRecordedWalls)            move of each level, and every classified
 *                                 touch (reject / break / pin / new wall / …).
 *                                 Only exists for days the recorder was up.
 *   /api/snapshots/option-strike-gex-history?minutes=0&date=
 *   (useIntradayLadder)           the per-minute strike ladder. Pruned to about
 *                                 TWO SESSIONS, so this one is a bonus on
 *                                 recent dates and legitimately empty before
 *                                 that. Never back-filled, always said out loud.
 *
 * Anything a store cannot answer renders as "—" or as an explicit note. The
 * live-only panels (written-vs-traded, the positioned/written split, premium,
 * next-expiry structure) are absent rather than approximated: each needs that
 * session's own chain with its marks, volumes and open interest, and nothing
 * stores that per strike per past day.
 *
 * Styling: the same `.pmk` scope as the other two tabs. Like PostMarketTab this
 * file exports its CSS and Premarket.tsx concatenates it into the one <style>.
 *
 * NO BACKTICKS anywhere inside the CSS string below — it is a template literal
 * and one stray backtick ends it. Same warning, same reason, as the other two.
 */

import { HISTORICAL_CSS } from "@/pages/premarket/historicalRecap.css";
// Re-exported so the old import path still resolves; Premarket.tsx takes the
// stylesheet from the .css module so it can lazy() this file.
export { HISTORICAL_CSS };

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtPts, fmtPx, fmtUsd, nf, pillClass } from "@/pages/premarket/format";
import {
  etHm,
  sessionLabel,
  useEodGex,
  useGexLevelsHistory,
  useIntradayLadder,
  useRecordedWalls,
  useSessionEsBars,
  LEVEL_LABEL,
  NOTES_KEY,
  REACTION_LABEL,
  REACTION_TONE,
  type CurvePt,
  type GexLevelDay,
  type WallLevel,
} from "./postMarketData";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS — appended to the Premarket + Post-Market blocks, same .pmk scope
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_ORDER: WallLevel[] = ["call_wall", "put_wall", "cb"];
const LEVEL_COLOR: Record<WallLevel, string> = {
  call_wall: "var(--cw)", put_wall: "var(--pw)", cb: "var(--violet)",
};


/**
 * The cumulative gamma curve for the session, with the day's levels ticked on
 * the strike axis.
 *
 * The stored curve is a running sum of net GEX from the lowest strike up, so
 * its ZERO crossing is the gamma flip the recorder derived independently — the
 * two are drawn together on purpose: when they disagree, the curve is the one
 * with the receipts and the disagreement is worth seeing rather than hiding.
 *
 * Pure SVG, no chart library, no state. It is a static picture of a settled day.
 */
function CurveChart({ curve, day }: { curve: CurvePt[]; day: GexLevelDay }) {
  const W = 1000, H = 132, PAD_T = 10, PAD_B = 16;
  const ks = curve.map((p) => p.k);
  const cs = curve.map((p) => p.c);
  const kMin = Math.min(...ks), kMax = Math.max(...ks);
  const cMax = Math.max(0, ...cs), cMin = Math.min(0, ...cs);
  const kSpan = kMax - kMin || 1;
  const cSpan = cMax - cMin || 1;
  const x = (k: number) => ((k - kMin) / kSpan) * W;
  const y = (c: number) => PAD_T + (1 - (c - cMin) / cSpan) * (H - PAD_T - PAD_B);

  const d = curve.map((p, i) => `${i ? "L" : "M"}${x(p.k).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const zeroY = y(0);

  const marks: { k: number | null; color: string; label: string }[] = [
    { k: day.support, color: "var(--pw)", label: "Put wall" },
    { k: day.neutral, color: "var(--amber)", label: "Flip" },
    { k: day.spot, color: "var(--blue)", label: "Close" },
    { k: day.resistance, color: "var(--cw)", label: "Call wall" },
  ];
  const drawn = marks.filter((m) => m.k != null && m.k >= kMin && m.k <= kMax);

  // preserveAspectRatio="none" so the curve fills the card at any width. That
  // stretches EVERYTHING in the box, which is why there is no <text> in here —
  // glyphs would smear horizontally on a narrow screen — and why every stroke
  // carries vectorEffect="non-scaling-stroke". The labels live in the legend
  // row below, where they are ordinary HTML at an honest size.
  return (
    <div className="hcurve">
      <div className="tiny">Cumulative net gamma by strike · settled close</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label="Cumulative net gamma exposure by strike at the session close">
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--line2)" strokeWidth={1}
          vectorEffect="non-scaling-stroke" />
        {drawn.map((m) => (
          <line key={m.label} x1={x(m.k as number)} x2={x(m.k as number)} y1={PAD_T} y2={H - PAD_B}
            stroke={m.color} strokeWidth={1.5} strokeDasharray={m.label === "Close" ? "" : "4 3"}
            opacity={0.85} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={d} fill="none" stroke="var(--violet)" strokeWidth={2}
          vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="hcurvex">
        <span className="mono">{nf(kMin, 0)}</span>
        <span style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {drawn.map((m) => (
            <span key={m.label} style={{ color: m.color }}>
              {m.label} <span className="mono">{nf(m.k as number, 0)}</span>
            </span>
          ))}
        </span>
        <span className="mono">{nf(kMax, 0)}</span>
      </div>
      <div className="tiny" style={{ marginTop: 4 }}>
        Running total {fmtUsd(cs[cs.length - 1])} across {curve.length} sampled strikes · the
        curve&apos;s zero crossing is the flip the ladder implies
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function HistoricalRecap({ date, symbol = "SPX" }: { date: string; symbol?: string }) {
  // The deep store. Shared with the picker in Premarket.tsx through
  // dedupeFetch, so mounting this does not fire a second copy of the request.
  const { byDate, state: levelsState } = useGexLevelsHistory();
  const day = byDate.get(date) ?? null;

  const { row: eod } = useEodGex(date);
  const { rth: bars, state: barState } = useSessionEsBars(date);
  const { log, byLevel, state: wallState } = useRecordedWalls(date, symbol);

  // The 0DTE contract of a past session IS that session's date — the ladder is
  // written under the front expiry of the day it was recorded, so asking for
  // `date` as the expiry asks for exactly the book that expired that afternoon.
  //
  // The fourth argument is `symbol`, and it used to be OMITTED — which meant
  // the hook fell back to its "SPX" default and section 4 drew SPX's ladder
  // under whatever ticker was picked, silently, with the section heading and
  // the empty-state text both still naming the date rather than the symbol. It
  // was the only section here that read the picker wrong; sections 1 and 5 are
  // SPX-pinned by their STORES and say so in the banner above, which is a
  // different and honest thing.
  const { cols, state: ladderState } = useIntradayLadder(true, date, date, symbol);

  // ── ES session range ──────────────────────────────────────────────────────
  const es = useMemo(() => {
    const first = bars[0];
    const last = bars[bars.length - 1];
    if (!first || !last) return null;
    return {
      open: first.open || first.close,
      close: last.close,
      hi: Math.max(...bars.map((b) => b.high || b.close)),
      lo: Math.min(...bars.map((b) => b.low || b.close)),
      from: etHm(first.ts),
      to: etHm(last.ts),
    };
  }, [bars]);

  // ── where the gamma finished, and where it started (recent dates only) ────
  const ladderRows = useMemo(() => {
    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];
    if (!firstCol || !lastCol) return [];
    const first = new Map(firstCol.cells.map((c) => [c.strike, c.net]));
    const last = lastCol.cells;
    return [...last]
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 10)
      .map((c) => ({ strike: c.strike, net: c.net, open: first.get(c.strike) ?? null }))
      .sort((a, b) => b.strike - a.strike);
  }, [cols]);

  const maxAbs = useMemo(
    () => ladderRows.reduce((m, r) => Math.max(m, Math.abs(r.net)), 0) || 1,
    [ladderRows],
  );

  const ladderPath = useMemo(() => {
    const pts = cols.map((c) => c.spot).filter((s) => s > 0);
    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];
    if (!pts.length || !firstCol || !lastCol) return null;
    return {
      hi: Math.max(...pts), lo: Math.min(...pts),
      close: pts[pts.length - 1],
      from: etHm(firstCol.ts), to: etHm(lastCol.ts),
    };
  }, [cols]);

  // ── did the day stay inside the walls? ────────────────────────────────────
  // ONLY when the SPX intraday path is on file. The ES bars cannot answer it:
  // grading an SPX wall against an ES range needs that day's basis, which is
  // not knowable from a live quote, and a wrong basis turns a hold into a break.
  const heldInside = useMemo(() => {
    if (!ladderPath || !day || day.resistance == null || day.support == null) return null;
    return { cw: ladderPath.hi <= day.resistance, pw: ladderPath.lo >= day.support };
  }, [ladderPath, day]);

  // ── session journal — the same per-date note the live tab writes ──────────
  const [note, setNote] = useState("");
  const [noteReady, setNoteReady] = useState(false);
  useEffect(() => {
    setNoteReady(false);
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      setNote(all[date] ?? "");
    } catch { setNote(""); }
    setNoteReady(true);
  }, [date]);
  const saveNote = useCallback((v: string) => {
    setNote(v);
    if (!noteReady) return;
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      all[date] = v;
      localStorage.setItem(NOTES_KEY, JSON.stringify(all));
    } catch { /* quota — the textarea still holds it for this session */ }
  }, [date, noteReady]);

  const moves = useMemo(
    () => log.filter((r) => r.reason === "change").sort((a, b) => a.slot - b.slot),
    [log],
  );

  const spxOnly = symbol !== "SPX";

  return (
    <section className="prep is-post">

      {/* ── 1. THE SETTLED SESSION ───────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">1</span>{sessionLabel(date)} · settled close</h3>
          <span className="tiny right">
            SPX{day?.source ? ` · ${day.source === "theta" ? "rebuilt from settled OI" : "recorded live"}` : ""}
          </span>
        </div>

        {spxOnly && (
          <div className="warnbar" style={{ marginBottom: 11 }}>
            The per-day history is SPX only — the levels recorder is single-symbol. Sections 1 and 2
            below describe SPX regardless of the symbol picked above; the wall log and the strike
            ladder do read {symbol}.
          </div>
        )}

        {levelsState === "loading" && <div className="warnbar">Reading the settled history…</div>}
        {levelsState === "error" && <div className="warnbar">The settled history could not be read.</div>}
        {levelsState !== "loading" && levelsState !== "error" && !day && (
          <div className="warnbar">
            No settled row on file for {date}. That store keeps one row per session indefinitely and
            back-fills its own gaps from settled OI, so a missing date is usually a market holiday.
          </div>
        )}

        {day && (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="n2">SPX close</div>
                <div className="v2 mono">{fmtPx(day.spot, 2)}</div>
                <div className="m2">settled spot</div>
              </div>
              <div className="tile">
                <div className="n2">Net GEX</div>
                <div className={`v2 mono ${day.dollarGamma >= 0 ? "chg-pos" : "chg-neg"}`}>
                  {fmtUsd(day.dollarGamma)}
                </div>
                <div className="m2">{day.dollarGamma >= 0 ? "dealers long gamma" : "dealers short gamma"}</div>
              </div>
              <div className="tile">
                <div className="n2">0DTE share</div>
                <div className="v2 mono">{fmtUsd(eod?.gex0dte)}</div>
                <div className="m2">
                  {eod?.gexEx0dte != null ? `ex-0DTE ${fmtUsd(eod.gexEx0dte)}` : "not split for this date"}
                </div>
              </div>
              <div className="tile">
                <div className="n2">Pin</div>
                <div className="v2 mono">{fmtPx(eod?.pinStrike)}</div>
                <div className="m2">
                  {eod?.pinShare != null
                    ? `${(eod.pinShare * 100).toFixed(0)}% of board gamma`
                    : "no pin recorded"}
                </div>
              </div>
            </div>

            <div className="hlev">
              <div className="l">
                <div className="n2">Call wall</div>
                <div className="v2 mono" style={{ color: "var(--cw)" }}>{fmtPx(day.resistance)}</div>
                <div className="m2">R2 {fmtPx(day.r2)}</div>
              </div>
              <div className="l">
                <div className="n2">Put wall</div>
                <div className="v2 mono" style={{ color: "var(--pw)" }}>{fmtPx(day.support)}</div>
                <div className="m2">S2 {fmtPx(day.s2)}</div>
              </div>
              <div className="l">
                <div className="n2">Gamma flip</div>
                <div className="v2 mono" style={{ color: "var(--amber)" }}>{fmtPx(day.neutral)}</div>
                <div className="m2">
                  {day.neutral == null ? "—"
                    : day.spot >= day.neutral ? "closed above" : "closed below"}
                </div>
              </div>
              <div className="l">
                <div className="n2">Call / put gamma</div>
                <div className="v2 mono">{day.cpgRatio ? day.cpgRatio.toFixed(2) : "—"}</div>
                <div className="m2">{day.cpgRatio >= 1 ? "call-heavy book" : "put-heavy book"}</div>
              </div>
              <div className="l">
                <div className="n2">Open interest</div>
                <div className="v2 mono">{day.openInt ? nf(day.openInt, 0) : "—"}</div>
                <div className="m2">calls + puts, whole board</div>
              </div>
            </div>

            {heldInside && (
              <div className="biasbox" style={{ marginTop: 12 }}>
                Against the recorded SPX path, the session{" "}
                <b>{heldInside.cw ? "held under" : "traded through"}</b> the call wall and{" "}
                <b>{heldInside.pw ? "held above" : "traded through"}</b> the put wall
                {" "}({fmtPx(ladderPath?.lo)}–{fmtPx(ladderPath?.hi)} on the recorded window).
              </div>
            )}

            {day.curve && day.curve.length > 2 && <CurveChart curve={day.curve} day={day} />}
          </>
        )}
      </div>

      {/* ── 2. THE ES SESSION ────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">2</span>ES session range</h3>
          {es && <span className="tiny right">{es.from}–{es.to} ET · 5m bars</span>}
        </div>

        {barState === "loading" && <div className="warnbar">Reading the {date} ES bars…</div>}
        {(barState === "empty" || (barState === "ok" && !es)) && (
          <div className="warnbar">No ES bars stored for {date}.</div>
        )}
        {barState === "error" && <div className="warnbar">The ES bars could not be read for {date}.</div>}

        {es && (
          <>
            <div className="tiles">
              <div className="tile"><div className="n2">Open</div><div className="v2 mono">{fmtPx(es.open, 2)}</div><div className="m2">first RTH bar</div></div>
              <div className="tile"><div className="n2">High</div><div className="v2 mono">{fmtPx(es.hi, 2)}</div><div className="m2">RTH</div></div>
              <div className="tile"><div className="n2">Low</div><div className="v2 mono">{fmtPx(es.lo, 2)}</div><div className="m2">RTH</div></div>
              <div className="tile">
                <div className="n2">Close</div>
                <div className="v2 mono">{fmtPx(es.close, 2)}</div>
                <div className="m2">
                  <span className={es.close >= es.open ? "chg-pos" : "chg-neg"}>{fmtPts(es.close - es.open)}</span>
                  {" "}on the session
                </div>
              </div>
            </div>
            <div className="tiny" style={{ marginTop: 8 }}>
              ES, not SPX. A past session&apos;s basis is not knowable from a live quote, so these are
              not converted — the SPX side of the day is section 1.
            </div>
          </>
        )}
      </div>

      {/* ── 3. RECORDED LEVELS ───────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">3</span>How the levels behaved</h3>
          <span className="tiny right">{symbol} · wall log</span>
        </div>

        {wallState === "loading" && <div className="warnbar">Reading the {date} wall log…</div>}
        {wallState === "error" && (
          <div className="warnbar">The wall log could not be read for {date}.</div>
        )}
        {wallState === "empty" && (
          <div className="warnbar">
            Nothing in the {symbol} wall log for {date}. That recorder writes from 09:29 ET on
            trading days and only started keeping this symbol at some point — a day before that, a
            holiday, or a day it was down all read this way. The settled levels in section 1 are
            unaffected; what is missing here is the intraday GRADE of them.
          </div>
        )}

        {wallState === "ok" && (
          <div className="hgrid">
            {LEVEL_ORDER.map((lvl) => {
              const rec = byLevel.get(lvl);
              if (!rec) {
                return (
                  <div className="sc" key={lvl}>
                    <div className="nm"><span style={{ color: LEVEL_COLOR[lvl] }}>{LEVEL_LABEL[lvl]}</span></div>
                    <div className="px mono">—</div>
                    <div className="sub">Not recorded on this session.</div>
                  </div>
                );
              }
              const moved = rec.open != null && rec.last != null ? rec.last - rec.open : null;
              return (
                <div className="sc" key={lvl}>
                  <div className="nm">
                    <span style={{ color: LEVEL_COLOR[lvl] }}>{LEVEL_LABEL[lvl]}</span>
                    <span className="pill">{rec.moves} {rec.moves === 1 ? "move" : "moves"}</span>
                  </div>
                  <div className="px mono">{fmtPx(rec.last)}</div>
                  <div className="sub">
                    opened {fmtPx(rec.open)}
                    {moved != null && moved !== 0 && (
                      <span className={moved >= 0 ? "chg-pos" : "chg-neg"}> {fmtPts(moved)}</span>
                    )}
                  </div>
                  <div className="hev">
                    {rec.events.length === 0
                      ? <span className="tiny">no touch classified</span>
                      : rec.events.map((e, i) => (
                        <span
                          key={`${e.hit_slot}-${i}`}
                          className={e.reaction ? pillClass(REACTION_TONE[e.reaction]) : "pill"}
                          title={`${e.kind} at ${String(e.at ?? "").slice(0, 5)} · spot ${fmtPx(e.spot_at_hit)}`}
                        >
                          {String(e.at ?? "").slice(0, 5)} {e.reaction ? REACTION_LABEL[e.reaction] : "UNGRADED"}
                        </span>
                      ))}
                  </div>
                  <div className="src">graded by the wall log</div>
                </div>
              );
            })}
          </div>
        )}

        {wallState === "ok" && moves.length > 0 && (
          <div className="movelog">
            <div className="tiny" style={{ marginBottom: 4 }}>
              Every time a level moved on {date} · {moves.length} {moves.length === 1 ? "move" : "moves"}
            </div>
            <div className="mvscroll">
              {moves.map((r, i) => (
                <div className="mv" key={`${r.level_type}-${r.slot}-${i}`}>
                  <span className="mono">{String(r.at ?? "").slice(0, 5) || `slot ${r.slot}`}</span>
                  <span style={{ color: LEVEL_COLOR[r.level_type] }}>{LEVEL_LABEL[r.level_type]}</span>
                  <span className="mono">
                    {r.prev_strike != null ? `${nf(r.prev_strike, 0)} → ` : ""}{nf(r.strike, 0)}
                    {r.delta != null ? <span className={r.delta >= 0 ? "chg-pos" : "chg-neg"}>{"  "}{fmtPts(r.delta)}</span> : null}
                  </span>
                  <span className="tiny">spot {fmtPx(r.spot)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 4. THE PER-MINUTE LADDER (recent dates only) ─────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">4</span>Where the gamma sat</h3>
          {ladderPath
            ? <span className="tiny right">{symbol} · ladder covers {ladderPath.from}–{ladderPath.to} ET</span>
            : <span className="tiny right">{symbol}</span>}
        </div>

        {ladderState === "loading" && <div className="warnbar">Reading the {symbol} {date} strike ladder…</div>}
        {ladderState === "error" && (
          <div className="warnbar">The {symbol} strike ladder could not be read for {date}.</div>
        )}
        {(ladderState === "empty" || (ladderState === "ok" && !ladderRows.length)) && (
          <div className="warnbar">
            No per-minute {symbol} ladder retained for {date}. That history is pruned to roughly the
            last two sessions — it is the one store here that does not go back, and section 1 does
            not depend on it.
          </div>
        )}

        {ladderState === "ok" && !!ladderRows.length && (
          <>
            <div className="tiny" style={{ marginBottom: 6 }}>
              Ten biggest strikes at the close · bar is the closing net GEX, the right column is what
              it was at the first recorded print
            </div>
            {ladderRows.map((r) => {
              const pos = r.net >= 0;
              const w = Math.min(100, (Math.abs(r.net) / maxAbs) * 100);
              return (
                <div className="hrow" key={r.strike}>
                  <span className="k mono">{nf(r.strike, 0)}</span>
                  <span className="track"><i className={pos ? "p" : "n"} style={{ width: `${w}%` }} /></span>
                  <span className={`v mono ${pos ? "chg-pos" : "chg-neg"}`}>{fmtUsd(r.net)}</span>
                  <span className="v mono muted">
                    {r.open == null ? "—" : `from ${fmtUsd(r.open)}`}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── 5. JOURNAL ───────────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">5</span>Session journal</h3>
          <span className="tiny right">{date} · saved on this device</span>
        </div>
        <textarea
          className="jot"
          value={note}
          onChange={(e) => saveNote(e.target.value)}
          placeholder={`What actually happened on ${sessionLabel(date)}?`}
        />
      </div>

      {/* ── what a past date cannot show ─────────────────────────────────── */}
      <div className="sec">
        <div className="warnbar">
          Written-vs-traded, the positioned/written split, premium and next-expiry structure are not
          shown for a past session: each needs that day&apos;s own chain — with its marks, volumes and
          open interest — and nothing stores that per strike per past day. Switch the picker back to
          today for the full live recap.
        </div>
      </div>
    </section>
  );
}
