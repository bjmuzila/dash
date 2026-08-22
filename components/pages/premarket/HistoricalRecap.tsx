"use client";

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
 * So a past session gets its own, smaller view. It renders ONLY what is
 * genuinely stored per-date, and says plainly what is missing:
 *
 *   /proxy/walls?date&symbol      server-v2/walls-recorder.js — the 09:29
 *                                 capture, every subsequent MOVE of the call
 *                                 wall / put wall / CORE, and every classified
 *                                 touch (reject / break / pin / new wall / …).
 *                                 This is a real, server-side grade of that
 *                                 day and it is kept well past the ladder's
 *                                 retention, so it is the spine of this view.
 *   /api/snapshots/option-strike-gex-history?minutes=0&date=
 *                                 the per-minute strike ladder for that exact
 *                                 session (useIntradayLadder's `date` mode).
 *                                 pruneOptionStrikeGexHistory keeps ~2
 *                                 SESSIONS, so anything older answers empty —
 *                                 rendered as "not retained", never filled in.
 *   localStorage journal          the same per-date note the live tab writes,
 *                                 through the shared NOTES_KEY.
 *
 * What is deliberately NOT here: the snapshot row, build-time bars,
 * written-vs-traded, the positioned/written split, premium and tomorrow's
 * structure. Each of those needs the day's own chain with its marks and
 * volumes, and nothing in this app stores that per strike per past session.
 * A blank is honest; a live number under a past date is not.
 *
 * Styling: the same `.pmk` scope as the other two tabs. Like PostMarketTab this
 * file exports its CSS and Premarket.tsx concatenates it into the one <style>.
 *
 * NO BACKTICKS anywhere inside the CSS string below — it is a template literal
 * and one stray backtick ends it. Same warning, same reason, as the other two.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  etHm,
  sessionLabel,
  useIntradayLadder,
  useRecordedWalls,
  LEVEL_LABEL,
  NOTES_KEY,
  REACTION_LABEL,
  REACTION_TONE,
  type WallLevel,
} from "./postMarketData";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS — appended to the Premarket + Post-Market blocks, same .pmk scope
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORICAL_CSS = `
.pmk .hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pmk .hev{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.pmk .hrow{display:grid;grid-template-columns:64px 1fr 104px 96px;align-items:center;height:22px;gap:9px}
.pmk .hrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .hrow .v{font-size:10px;text-align:right;white-space:nowrap}
.pmk .hrow .track{position:relative;height:13px;border-radius:3px;background:var(--bg);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .hrow .track i{position:absolute;left:0;top:2px;bottom:2px;border-radius:2px}
.pmk .hrow .track i.p{background:var(--pos)}
.pmk .hrow .track i.n{background:var(--neg)}
@media (max-width:1180px){
  .pmk .hgrid{grid-template-columns:1fr}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_ORDER: WallLevel[] = ["call_wall", "put_wall", "cb"];
const LEVEL_COLOR: Record<WallLevel, string> = {
  call_wall: "var(--cw)", put_wall: "var(--pw)", cb: "var(--violet)",
};

const nf = (v: number, dp = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtPx = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) ? "—" : nf(v, dp);
const fmtPts = (v: number) => `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), 0)}`;
function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

const pillClass = (tone: "ok" | "bad" | "warn" | "vio") =>
  tone === "ok" ? "pill cool" : tone === "bad" ? "pill hot" : tone === "warn" ? "pill warn" : "pill";

// ─────────────────────────────────────────────────────────────────────────────

export default function HistoricalRecap({ date, symbol = "SPX" }: { date: string; symbol?: string }) {
  const { log, byLevel, state: wallState } = useRecordedWalls(date, symbol);

  // The 0DTE contract of a past session IS that session's date — the ladder is
  // written under the front expiry of the day it was recorded, so asking for
  // `date` as the expiry asks for exactly the book that expired that afternoon.
  const { cols, state: ladderState } = useIntradayLadder(true, date, date);

  // ── the day's spot path, straight off the recorded ladder ─────────────────
  // The columns are already RTH-filtered and sorted by useIntradayLadder, and
  // each carries the spot the recorder saw. A column with no spot (legacy rows)
  // is skipped rather than counted as zero, which would drag the low to 0.
  const path = useMemo(() => {
    const pts = cols.map((c) => c.spot).filter((s) => s > 0);
    if (!pts.length) return null;
    return {
      open: pts[0],
      close: pts[pts.length - 1],
      hi: Math.max(...pts),
      lo: Math.min(...pts),
      from: etHm(cols[0].ts),
      to: etHm(cols[cols.length - 1].ts),
    };
  }, [cols]);

  // ── where the gamma finished, and where it started ────────────────────────
  const ladderRows = useMemo(() => {
    if (cols.length < 1) return [];
    const first = new Map(cols[0].cells.map((c) => [c.strike, c.net]));
    const last = cols[cols.length - 1].cells;
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

  return (
    <section className="prep is-post">

      {/* ── 1. RECORDED LEVELS ───────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">1</span>Recorded levels · {sessionLabel(date)}</h3>
          <span className="tiny right">{symbol} · wall log</span>
        </div>

        {wallState === "loading" && <div className="warnbar">Reading the {date} wall log…</div>}
        {wallState === "error" && (
          <div className="warnbar">The wall log could not be read for {date}.</div>
        )}
        {wallState === "empty" && (
          <div className="warnbar">
            Nothing recorded in the {symbol} wall log for {date}. The recorder writes from 09:29 ET
            on trading days, so a holiday, a weekend or a day the recorder was down all read this way.
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

      {/* ── 2. THE RECORDED LADDER ───────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">2</span>How the session closed</h3>
          {path && <span className="tiny right">ladder covers {path.from}–{path.to} ET</span>}
        </div>

        {ladderState === "loading" && <div className="warnbar">Reading the {date} strike ladder…</div>}
        {ladderState === "error" && (
          <div className="warnbar">The strike ladder could not be read for {date}.</div>
        )}
        {(ladderState === "empty" || (ladderState === "ok" && !ladderRows.length)) && (
          <div className="warnbar">
            No per-minute ladder retained for {date}. That history is pruned to roughly the last two
            sessions, so anything older than that is genuinely gone — the levels above are still the
            recorded ones.
          </div>
        )}

        {ladderState === "ok" && !!ladderRows.length && (
          <>
            {path && (
              <div className="tiles" style={{ marginBottom: 12 }}>
                <div className="tile"><div className="n2">Open</div><div className="v2 mono">{fmtPx(path.open, 2)}</div><div className="m2">first recorded print</div></div>
                <div className="tile"><div className="n2">High</div><div className="v2 mono">{fmtPx(path.hi, 2)}</div><div className="m2">recorded window</div></div>
                <div className="tile"><div className="n2">Low</div><div className="v2 mono">{fmtPx(path.lo, 2)}</div><div className="m2">recorded window</div></div>
                <div className="tile">
                  <div className="n2">Close</div>
                  <div className="v2 mono">{fmtPx(path.close, 2)}</div>
                  <div className="m2">
                    <span className={path.close >= path.open ? "chg-pos" : "chg-neg"}>
                      {fmtPts(path.close - path.open)}
                    </span> on the session
                  </div>
                </div>
              </div>
            )}

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

      {/* ── 3. JOURNAL ───────────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">3</span>Session journal</h3>
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
          This is the <b>recorded</b> view of {date}. The snapshot row, build-time bars,
          written-vs-traded, the positioned/written split, premium and next-expiry structure are not
          shown, because each needs that session&apos;s own chain — with its marks, volumes and open
          interest — and nothing stores that per strike per past day. Switch the picker back to today
          for the full live recap.
        </div>
      </div>
    </section>
  );
}
