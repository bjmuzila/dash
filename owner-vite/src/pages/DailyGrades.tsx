// ─────────────────────────────────────────────────────────────────────────────
// /owner/daily-grades — the Daily Grades board.
//
// ROSTER = THE WATCHLIST. Rows are the scanner universe from
// GET /proxy/scanner-tickers (lib/tickers.ts) — the same list the ΔGEX Board
// runs over — NOT whatever tickers happen to be in the payload. A watchlist
// name the seal didn't grade still gets a row, marked "not graded"; a graded
// name that isn't on the watchlist is off-roster and hidden behind the scope
// toggle rather than quietly padding the board.
//
// THE BOARD IS LIVE. `/proxy/daily-grades` serves the board sealed at 09:26 ET
// by server-v2/daily-grades-recorder.js. Everything on screen comes from one
// `DgPayload` (see lib/dailyGrades.ts) and this component never fetches a board
// itself — `loadGrades()` is the only door. The bundled 2026-08-25 sample is
// the fallback for a session with no seal (a fresh database, a missed run), and
// the header badge always says which of the three is on screen: Live, Imported
// or Sample board. Paste-JSON stays as the manual path for a board built
// somewhere else.
//
// TWO TABS, ONE FETCH. LEVELS is the board as it was sealed; GRADES is what the
// session did to it. `/proxy/daily-grades` returns the seal and the grades in
// one response, so switching tabs is a re-render and never a refetch. The
// grades are simply absent until the 16:20 ET run writes them — that is the
// normal state for most of a trading day, not an error, and the tab says so.
//
// THE THIRD TAB IS THE BACK CATALOGUE, and it is the one thing here that DOES
// fetch on its own. SESSIONS is `daily_grade_days` — every graded session, newest
// first — read through `/proxy/daily-grades-days`. It loads the first time that
// tab is opened and not before: the session on screen needs no history to render,
// and most visits never leave the board.
//
// CLICK A TICKER, ON EITHER BOARD. Every ticker opens its own record —
// `/proxy/daily-grades-history?symbol=`, one row per session it was sealed for,
// ungraded sessions included. The modal fetches on open and drops the rows on
// close rather than caching a table that goes stale the moment the 16:20 run
// lands. A "not graded" gap in that table is a real state, not a hole.
//
// NAMING: the payload field is `apex`; the level is CB and the UI says CB. The
// key is not renamed because it is the sealed board's own wire format — see the
// glossary in lib/dailyGrades.ts.
//
// SURFACES: this page paints on the flat `SURFACE` ramp from lib/theme rather
// than the frosted `panelBg` the older owner pages use — shell behind, card for
// each panel, card2 for anything inset in a card (tiles, the sticky table head,
// inputs), cardHi for row hover. Every fill is opaque, so the cards drop their
// backdrop blur. Text is white throughout: rank and state are carried by the
// pills and the accent colours, never by dimming the type.
//
// Colours come from lib/theme — no hardcoded hex.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell, Card } from "../components/PageCard";
import {
  OWNER_THEME as T,
  SURFACE,
  TYPE,
  ownerRgba,
  homeInputStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { useTickerUniverse } from "../lib/tickers";
import {
  deriveRows,
  summarize,
  parsePayload,
  loadGrades,
  loadTickerHistory,
  loadDayHistory,
  fmtPrice,
  fmtPct,
  fmtSealed,
  fmtDay,
  fmtWeekday,
  NEAR_PCT,
  type DgPayload,
  type DgRow,
  type DgSource,
  type DgFlagKind,
  type DgGradeRow,
  type DgDay,
  type DgTickerHistory,
  type DgDayHistory,
} from "../lib/dailyGrades";

const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** Flat card, no blur — the SURFACE ramp is opaque by design. */
const CARD: React.CSSProperties = {
  background: SURFACE.card,
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
};
/** Inset surface inside a card: stat tiles, the sticky table head, inputs. */
const INSET: React.CSSProperties = {
  background: SURFACE.card2,
  border: `1px solid ${T.border}`,
};

type FilterId = "all" | "above" | "below" | "near" | "breach" | "ungraded";
type SortKey =
  | "ticker" | "spot" | "floor" | "dFloor" | "apex" | "cap" | "dCap" | "flip" | "dFlip";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "above", label: "Above flip" },
  { id: "below", label: "Below flip" },
  { id: "near", label: `Within ${NEAR_PCT}%` },
  { id: "breach", label: "Outside range" },
  { id: "ungraded", label: "Not graded" },
];

const FLAG_ACCENT: Record<DgFlagKind, string> = {
  near: T.gold,
  breach: T.orange,
  inverted: T.red,
  ungraded: T.purple,
  offroster: T.lightBlue,
};

/** Letter → accent. A+/A read as good, F as bad, the middle a ramp between. */
const GRADE_ACCENT: Record<string, string> = {
  "A+": T.green, A: T.green, B: T.cyan, C: T.gold, D: T.orange, F: T.red,
};

/**
 * Outcome string → what it says on screen and how it reads. The recorder's
 * vocabulary is deliberately narrow (see daily-grades-recorder.js); anything not
 * in here renders as the raw string rather than silently vanishing, so a new
 * outcome added server-side shows up as itself instead of a blank cell.
 */
const OUTCOME_META: Record<string, { label: string; accent: string }> = {
  tagged_held: { label: "tagged · held", accent: T.green },
  untested_held: { label: "untested", accent: T.lightBlue },
  tagged_broke: { label: "tagged · broke", accent: T.red },
  gapped_through: { label: "gapped through", accent: T.orange },
  held_clean: { label: "held clean", accent: T.green },
  held_after_test: { label: "held · tested", accent: T.gold },
  flipped: { label: "flipped", accent: T.red },
  pinned: { label: "pinned", accent: T.green },
  close: { label: "close", accent: T.cyan },
  near: { label: "near", accent: T.gold },
  loose: { label: "loose", accent: T.orange },
  far: { label: "far", accent: T.red },
  contained: { label: "contained", accent: T.green },
  one_side_out: { label: "one side out", accent: T.gold },
  both_out: { label: "both out", accent: T.red },
};

/**
 * The rubric, in the recorder's own words. Each level is worth 25 and is scored
 * on two questions at once — did price REACH it, and did it close back on the
 * side the seal left it on — because either answer alone is misleading.
 */
const GRADE_LEGEND: [string, string][] = [
  ["Score", "Points ÷ points-available × 100. A name with no flip has 100 available instead of 125, so it is never punished for a component it never had."],
  ["Grade", "A+ 85 · A 72 · B 58 · C 44 · D 28 · F — the same bands the picks board uses, so a B means the same thing on both."],
  ["Cap / Floor", "tagged · held 25 (reached it and closed back inside) · untested 15 · tagged · broke 5 · gapped through 0."],
  ["Flip", "held clean 25 · held after an intraday test 18 · flipped 5."],
  ["CB", "A magnet, so it is scored on where the CLOSE landed: pinned ≤0.25% 25 · close ≤0.5% 21 · near ≤1% 15 · loose ≤2% 8 · far 0."],
  ["Range", "Did the floor→cap band contain the session — contained 25 · one side out 12 · both out 0. Skipped when floor sits above cap."],
  ["No grade", "no levels / no candles store a NULL grade, never an F. An F is a claim the board was wrong; no board is no claim."],
  ["Session", "The day row sums points over points-available across every graded ticker — not the mean of their percentages."],
];

/** The running record's own glossary — what a row of `daily_grade_days` means. */
const SESSION_LEGEND: [string, string][] = [
  ["Sessions", "One row per graded session from daily_grade_days, newest first. The seal is immutable once its session opens, so a row here never changes except by an explicit regrade."],
  ["Score", "That session's points ÷ points-available × 100, summed across every graded ticker — not the mean of their percentages."],
  ["Average", "The same sum applied over the whole window, so the tile and a single day row are the same kind of number."],
  ["Graded", "Graded tickers out of tickers sealed. The gap is names with no levels or no candles — never counted as failures."],
  ["Spread", "The letter distribution for that session. Only letters that occurred are drawn."],
  ["Held / tested", "Cap and floor: how many were reached, and how many of those closed back inside. Untested levels are not in either count."],
  ["Window", "How far back to read — 30, 60, 120 or 250 sessions. Clamped server-side at 500."],
];

// ── small pieces ─────────────────────────────────────────────────────────────

function Pill({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        marginRight: 5,
        borderRadius: 999,
        fontSize: TYPE.micro,
        fontWeight: 800,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        background: ownerRgba(accent, 0.16),
        border: `1px solid ${ownerRgba(accent, 0.36)}`,
        color: accent,
      }}
    >
      {children}
    </span>
  );
}

function Tile({ value, label, accent }: { value: number | string; label: string; accent: string }) {
  return (
    <div style={{ ...INSET, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, color: accent, fontFamily: MONO }}>
        {value}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: TYPE.micro,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: T.text,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** One level's verdict plus what it scored. Unknown strings render as-is. */
function Outcome({ v, pts }: { v: string | null; pts: number | null }) {
  if (!v) return <span style={{ color: T.text, fontFamily: MONO, fontSize: 13 }}>—</span>;
  const meta = OUTCOME_META[v];
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <Pill accent={meta?.accent || T.lightBlue}>{meta?.label || v}</Pill>
      <span style={{ fontFamily: MONO, fontSize: TYPE.label, color: T.text }}>{pts ?? "—"}</span>
    </span>
  );
}

/** Where spot sits inside the floor→cap band. White tick = spot, gold line = flip. */
function BandBar({ row }: { row: DgRow }) {
  if (row.pos == null) {
    return <div style={{ height: 8, borderRadius: 4, background: SURFACE.cardHi }} />;
  }
  const p = Math.max(0, Math.min(1, row.pos)) * 100;
  const fp = row.flipPos != null && row.flipPos >= 0 && row.flipPos <= 1 ? row.flipPos * 100 : null;
  return (
    <div
      title={`floor ${fmtPrice(row.floor)} → cap ${fmtPrice(row.cap)}`}
      style={{ position: "relative", height: 8, borderRadius: 4, background: SURFACE.cardHi }}
    >
      <div
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: `${p}%`,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${ownerRgba(T.purple, 0.85)}, ${ownerRgba(T.cyan, 0.9)})`,
        }}
      />
      {fp != null && (
        <span
          style={{
            position: "absolute", left: `${fp}%`, top: -4, width: 2, height: 16,
            background: T.gold, transform: "translateX(-1px)",
          }}
        />
      )}
      <span
        style={{
          position: "absolute", left: `${p}%`, top: -3, width: 3, height: 14,
          borderRadius: 2, background: T.text, transform: "translateX(-1.5px)",
        }}
      />
    </div>
  );
}

/**
 * The ticker cell on both boards. A real <button> rather than a click handler on
 * the row: the history is the row's one action, and this way it is keyboard
 * reachable and reads as a control instead of a table cell that happens to move
 * when you touch it.
 */
function TickerButton({ ticker, onOpen }: { ticker: string; onOpen: (t: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={() => onOpen(ticker)}
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      title={`${ticker} — grade history`}
      style={{
        width: "100%",
        padding: "8px 10px",
        border: "none",
        background: "transparent",
        color: over ? T.cyan : T.text,
        font: "inherit",
        fontWeight: 800,
        letterSpacing: "0.02em",
        textAlign: "left",
        cursor: "pointer",
        textDecoration: over ? "underline" : "none",
        textUnderlineOffset: 3,
      }}
    >
      {ticker}
    </button>
  );
}

/** How many sessions back the history views ask for. */
const HISTORY_WINDOWS = [30, 60, 120, 250] as const;
type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

/**
 * Score over time, oldest → newest. Deliberately unlabelled: the table under it
 * carries every number, and this only has to answer "is it trending". The 58/72
 * guides are the B and A bands, so the shape reads against the rubric rather
 * than against its own min/max — a fixed 0–100 scale for the same reason.
 */
function ScoreSpark({ scores, accent }: { scores: (number | null)[]; accent: string }) {
  const pts = scores.map((s, i) => ({ s, i })).filter((p) => p.s != null) as { s: number; i: number }[];
  const W = 100;
  const H = 30;
  if (pts.length < 2) {
    return <div style={{ height: H, borderRadius: 6, background: SURFACE.cardHi }} />;
  }
  const n = scores.length - 1;
  const x = (i: number) => (n === 0 ? 0 : (i / n) * W);
  const y = (s: number) => H - (Math.max(0, Math.min(100, s)) / 100) * H;
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)} ${y(p.s).toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: H, display: "block", borderRadius: 6, background: SURFACE.cardHi }}
    >
      {[58, 72].map((band) => (
        <line
          key={band}
          x1={0} x2={W} y1={y(band)} y2={y(band)}
          stroke={ownerRgba(band === 72 ? T.green : T.cyan, 0.28)}
          strokeWidth={0.6}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={d} fill="none" stroke={accent} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.i)} cy={y(last.s)} r={2.2} fill={accent} />
    </svg>
  );
}

/**
 * One ticker's record, session by session — `/proxy/daily-grades-history`.
 *
 * Rows arrive newest-first and stay that way; the spark below reverses them so
 * time runs left → right. Ungraded sessions are kept in the table on purpose: a
 * name the board couldn't grade is part of how the board did on that name.
 */
function TickerHistoryModal({
  symbol,
  onClose,
  windowDays,
  onWindow,
}: {
  symbol: string;
  onClose: () => void;
  windowDays: HistoryWindow;
  onWindow: (d: HistoryWindow) => void;
}) {
  const [hist, setHist] = useState<DgTickerHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    loadTickerHistory(symbol, windowDays)
      .then((h) => { if (live) setHist(h); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load history."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [symbol, windowDays]);

  // Escape closes. Bound on the document because the dialog owns the screen
  // while it is open and focus may sit anywhere inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = hist?.summary;
  const accent = s?.grade ? GRADE_ACCENT[s.grade] || T.cyan : T.cyan;
  const scores = useMemo(
    () => (hist ? hist.rows.slice().reverse().map((r) => (r.score == null ? null : Number(r.score))) : []),
    [hist],
  );

  const hTh: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 2,
    background: SURFACE.card2,
    padding: "9px 10px",
    textAlign: "right",
    fontSize: TYPE.micro,
    fontWeight: 800,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    color: T.text,
    borderBottom: `1px solid ${T.borderStrong}`,
    whiteSpace: "nowrap",
  };
  const hTd: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "right",
    fontFamily: MONO,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    color: T.text,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol} grade history`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: ownerRgba("#000000", 0.66),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: SURFACE.card,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 16,
          width: "min(1080px, 100%)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: TYPE.title, fontWeight: 800, letterSpacing: "0.1em" }}>{symbol}</span>
              {s?.grade && <Pill accent={accent}>{s.grade} · {Number(s.score ?? 0).toFixed(1)}</Pill>}
              {!!s?.sessions && <Pill accent={T.lightBlue}>{s.sessions} sessions</Pill>}
            </div>
            <div style={{ marginTop: 5, fontSize: TYPE.label, color: T.text }}>
              Grade history — every session this name was sealed for, newest first.
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {HISTORY_WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => onWindow(d)}
                style={{
                  padding: "6px 11px",
                  borderRadius: 999,
                  border: `1px solid ${d === windowDays ? T.cyan : T.border}`,
                  background: d === windowDays ? ownerRgba(T.cyan, 0.16) : SURFACE.card2,
                  color: d === windowDays ? T.cyan : T.text,
                  fontSize: TYPE.micro,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}
            <button style={homeSecondaryButtonStyle} onClick={onClose}>Close</button>
          </div>
        </div>

        {/* body */}
        <div className="wall-scroll" style={{ overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div style={{ fontSize: TYPE.label, color: T.red }}>{error}</div>}

          {s && s.sessions > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 10 }}>
                <Tile value={s.score == null ? "—" : Number(s.score).toFixed(1)} label="avg score" accent={accent} />
                <Tile value={s.grade ?? "—"} label="avg grade" accent={accent} />
                <Tile value={`${s.pts} / ${s.max_pts}`} label="points" accent={T.cyan} />
                <Tile value={s.graded} label="graded" accent={T.text} />
                <Tile value={s.ungraded} label="not graded" accent={T.purple} />
                <Tile value={s.best == null ? "—" : Number(s.best).toFixed(1)} label="best" accent={T.green} />
                <Tile value={s.worst == null ? "—" : Number(s.worst).toFixed(1)} label="worst" accent={T.red} />
              </div>

              <div style={{ ...INSET, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
                  <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.text }}>
                    Score over time
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                    {(["A+", "A", "B", "C", "D", "F"] as const).map((g) =>
                      s.counts[g] ? <Pill key={g} accent={GRADE_ACCENT[g]}>{s.counts[g]} {g}</Pill> : null,
                    )}
                  </span>
                </div>
                <ScoreSpark scores={scores} accent={accent} />
              </div>
            </>
          )}

          <div style={{ ...INSET, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...hTh, textAlign: "left" }}>Date</th>
                  <th style={hTh}>Grade</th>
                  <th style={hTh}>Score</th>
                  <th style={hTh}>Pts</th>
                  <th style={{ ...hTh, textAlign: "left" }}>Cap</th>
                  <th style={{ ...hTh, textAlign: "left" }}>Floor</th>
                  <th style={{ ...hTh, textAlign: "left" }}>Flip</th>
                  <th style={{ ...hTh, textAlign: "left" }}>CB</th>
                  <th style={{ ...hTh, textAlign: "left" }}>Range</th>
                  <th style={hTh}>Close</th>
                  <th style={hTh}>Board</th>
                </tr>
              </thead>
              <tbody>
                {hist?.rows.map((r) => (
                  <tr key={r.date} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <th scope="row" style={{ ...hTd, textAlign: "left", fontFamily: "inherit", fontWeight: 800 }}>
                      {fmtDay(r.date)}
                      <span style={{ marginLeft: 6, fontSize: TYPE.micro, fontWeight: 600, color: T.text, opacity: 0.7 }}>
                        {fmtWeekday(r.date)}
                      </span>
                    </th>
                    <td style={hTd}>
                      {r.grade
                        ? <Pill accent={GRADE_ACCENT[r.grade] || T.text}>{r.grade}</Pill>
                        : <Pill accent={T.lightBlue}>{r.status === "no_candles" ? "no candles" : "no levels"}</Pill>}
                    </td>
                    <td style={{ ...hTd, fontWeight: 800 }}>{r.score == null ? "—" : Number(r.score).toFixed(1)}</td>
                    <td style={hTd}>{r.max_pts ? `${r.pts} / ${r.max_pts}` : "—"}</td>
                    <td style={{ ...hTd, textAlign: "left" }}><Outcome v={r.cap_outcome} pts={r.cap_pts} /></td>
                    <td style={{ ...hTd, textAlign: "left" }}><Outcome v={r.floor_outcome} pts={r.floor_pts} /></td>
                    <td style={{ ...hTd, textAlign: "left" }}><Outcome v={r.flip_outcome} pts={r.flip_pts} /></td>
                    <td style={{ ...hTd, textAlign: "left" }}><Outcome v={r.apex_outcome} pts={r.apex_pts} /></td>
                    <td style={{ ...hTd, textAlign: "left" }}><Outcome v={r.range_outcome} pts={r.range_pts} /></td>
                    <td style={{ ...hTd, fontWeight: 800 }}>{fmtPrice(r.c)}</td>
                    {/* What the whole board scored that day — the yardstick for the
                        row beside it. A C on a 48 board is not a C on an 84 board. */}
                    <td style={hTd}>
                      {r.day_score == null
                        ? "—"
                        : <Pill accent={r.day_grade ? GRADE_ACCENT[r.day_grade] || T.text : T.text}>
                            {r.day_grade ?? ""} {Number(r.day_score).toFixed(0)}
                          </Pill>}
                    </td>
                  </tr>
                ))}
                {!hist?.rows.length && (
                  <tr>
                    <td colSpan={11} style={{ ...hTd, textAlign: "center", padding: 34 }}>
                      {loading
                        ? "Loading history…"
                        : error
                          ? "History could not be read."
                          : `No graded session on record for ${symbol} yet.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DailyGrades() {
  const [payload, setPayload] = useState<DgPayload | null>(null);
  const [source, setSource] = useState<DgSource>("sample");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<DgGradeRow[]>([]);
  const [day, setDay] = useState<DgDay | null>(null);
  const [tab, setTab] = useState<"levels" | "grades" | "sessions">("levels");
  const [gradeFilter, setGradeFilter] = useState<"all" | "A+" | "A" | "B" | "C" | "D" | "F">("all");

  // ── history ────────────────────────────────────────────────────────────────
  // The modal is keyed on the symbol and owns its own fetch; this only holds
  // which name is open. The window is shared with the sessions tab so a switch
  // to 250 stays put when the modal is closed and reopened.
  const [histSym, setHistSym] = useState<string | null>(null);
  const [histWindow, setHistWindow] = useState<HistoryWindow>(60);

  const [days, setDays] = useState<DgDayHistory | null>(null);
  const [daysLoading, setDaysLoading] = useState(false);
  const [daysError, setDaysError] = useState<string | null>(null);

  // The roster. Same universe the ΔGEX Board runs over.
  const { tickers, loading: rosterLoading, live: rosterLive } = useTickerUniverse();

  const [showOffRoster, setShowOffRoster] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sortKey, setSortKey] = useState<SortKey>("ticker");
  const [sortAsc, setSortAsc] = useState(true);
  const [hover, setHover] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { payload: p, source: s, grades: g, day: d } = await loadGrades();
      setPayload(p);
      setSource(s);
      setGrades(g);
      setDay(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load grades.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * The running day table. Loaded the FIRST time the sessions tab is opened and
   * whenever the window changes — never on mount, because the board on screen
   * does not need it and most visits never open that tab.
   */
  const loadDays = useCallback(async (windowDays: HistoryWindow) => {
    setDaysLoading(true);
    setDaysError(null);
    try {
      setDays(await loadDayHistory(windowDays));
    } catch (e) {
      setDaysError(e instanceof Error ? e.message : "Could not load session history.");
    } finally {
      setDaysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "sessions") return;
    void loadDays(histWindow);
  }, [tab, histWindow, loadDays]);

  const applyImport = useCallback((text: string) => {
    try {
      setPayload(parsePayload(JSON.parse(text)));
      setSource("import");
      // The grades on screen belong to the SEAL, not to a board pasted over it.
      setGrades([]);
      setDay(null);
      setTab("levels");
      setImportError(null);
      setImportOpen(false);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not parse that JSON.");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      void f.text().then(applyImport);
    },
    [applyImport],
  );

  const roster = rosterLoading && !tickers.length ? null : tickers;
  const rows = useMemo(
    () => deriveRows(payload, roster, showOffRoster),
    [payload, roster, showOffRoster],
  );
  const stats = useMemo(() => summarize(rows), [rows]);

  /** Graded names the watchlist doesn't carry — the count behind the scope toggle. */
  const offRosterCount = useMemo(() => {
    if (!payload || !roster) return 0;
    const on = new Set(roster.map((t) => t.toUpperCase()));
    return Object.keys(payload.boards).filter((t) => !on.has(t)).length;
  }, [payload, roster]);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = rows.filter((r) => {
      if (q && !r.ticker.includes(q)) return false;
      if (filter === "above" && r.regime !== "above") return false;
      if (filter === "below" && r.regime !== "below") return false;
      if (filter === "near" && !r.near) return false;
      if (filter === "breach" && !r.breach) return false;
      if (filter === "ungraded" && !r.ungraded) return false;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    return out.sort((a, b) => {
      if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker) * dir;
      const x = a[sortKey];
      const y = b[sortKey];
      if (x == null) return 1;          // nulls always sink
      if (y == null) return -1;
      return (x - y) * dir;
    });
  }, [rows, query, filter, sortKey, sortAsc]);

  /**
   * The graded half. Sorted worst-first is tempting but wrong for a daily read:
   * the top of this table should be the names the board CALLED, so it sorts by
   * score descending with the ungraded sinking to the bottom either way.
   */
  const gradedRows = grades;
  const visibleGrades = useMemo(() => {
    const q = query.trim().toUpperCase();
    return gradedRows
      .filter((g) => {
        if (q && !g.symbol.toUpperCase().includes(q)) return false;
        if (gradeFilter !== "all" && g.grade !== gradeFilter) return false;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const x = a.score;
        const y = b.score;
        if (x == null && y == null) return a.symbol.localeCompare(b.symbol);
        if (x == null) return 1;
        if (y == null) return -1;
        return y - x;
      });
  }, [gradedRows, query, gradeFilter]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(k === "ticker"); }
  };

  const sourceAccent = source === "live" ? T.green : source === "import" ? T.cyan : T.gold;
  const sourceLabel =
    source === "live" ? "Live" : source === "import" ? "Imported" : "Sample board";

  // ── table styles ───────────────────────────────────────────────────────────
  // The head is sticky INSIDE the scroll box below, so it needs an opaque fill
  // of its own — rows slide under it.
  const th = (k?: SortKey, align: "left" | "right" = "right"): React.CSSProperties => ({
    position: "sticky",
    top: 0,
    zIndex: 2,
    background: SURFACE.card2,
    padding: "10px 10px",
    textAlign: align,
    fontSize: TYPE.micro,
    fontWeight: 800,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    color: k === sortKey ? T.cyan : T.text,
    borderBottom: `1px solid ${T.borderStrong}`,
    whiteSpace: "nowrap",
    cursor: k ? "pointer" : "default",
    userSelect: "none",
  });
  const td: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "right",
    fontFamily: MONO,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    color: T.text,
  };
  const caret = (k: SortKey) => (k === sortKey ? (sortAsc ? " ↑" : " ↓") : "");

  const deltaCell = (v: number | null) => (
    <td
      style={{
        ...td,
        color: v == null ? T.text : v > 0 ? T.green : v < 0 ? T.red : T.text,
        fontWeight: v != null && Math.abs(v) <= NEAR_PCT ? 800 : 500,
      }}
    >
      {fmtPct(v)}
    </td>
  );
  const priceCell = (v: number | null, strong = false) => (
    <td style={{ ...td, fontWeight: strong ? 800 : 500 }}>{fmtPrice(v)}</td>
  );

  const chipStyle = (on: boolean, accent: string): React.CSSProperties => ({
    padding: "7px 13px",
    borderRadius: 999,
    border: `1px solid ${on ? accent : T.border}`,
    background: on ? ownerRgba(accent, 0.16) : SURFACE.card2,
    color: on ? accent : T.text,
    fontSize: TYPE.label,
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <PageShell style={{ background: SURFACE.shell }}>
      {/* ── header ───────────────────────────────────────────────────────── */}
      <Card variant="classic" padding={20} style={{ ...CARD, flexShrink: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: TYPE.title, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Daily Grades
              </span>
              <Pill accent={sourceAccent}>{sourceLabel}</Pill>
              {payload?.sealed_for_session && <Pill accent={T.cyan}>{payload.sealed_for_session}</Pill>}
              <Pill accent={rosterLive ? T.green : T.gold}>
                {rosterLive ? "watchlist live" : rosterLoading ? "watchlist…" : "watchlist cached"}
              </Pill>
            </div>
            <div style={{ marginTop: 6, fontSize: TYPE.label, color: T.text }}>
              Sealed {fmtSealed(payload?.sealed_at)} · {stats.graded} of {stats.total} graded
              {" · scanner watchlist, same roster as the ΔGEX Board"}
              {source === "sample" && " · placeholder board until the TT / dxLink feed is wired"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={homeSecondaryButtonStyle} onClick={() => setImportOpen((v) => !v)}>
              {importOpen ? "Close" : "Paste JSON"}
            </button>
            <button style={homeSecondaryButtonStyle} onClick={() => void refresh()} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {payload?.note && (
          <div
            style={{
              ...INSET,
              marginTop: 14,
              padding: "10px 13px",
              borderRadius: 10,
              fontSize: TYPE.label,
              color: T.text,
            }}
          >
            {payload.note}
          </div>
        )}

        {error && <div style={{ marginTop: 12, fontSize: TYPE.label, color: T.red }}>{error}</div>}

        {importOpen && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Drop a sealed levels JSON here, or paste its contents…"
              spellCheck={false}
              style={{
                ...homeInputStyle,
                background: SURFACE.card2,
                minHeight: 130,
                fontFamily: MONO,
                fontSize: 12,
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={homeSecondaryButtonStyle} onClick={() => applyImport(importText)}>
                Load board
              </button>
              {importError && <span style={{ fontSize: TYPE.label, color: T.red }}>{importError}</span>}
            </div>
          </div>
        )}
      </Card>

      {/* ── tabs ─────────────────────────────────────────────────────────── */}
      {/*
        LEVELS is the board as it was sealed; GRADES is what the session did to
        it. Two views of one payload — /proxy/daily-grades returns the seal and
        the grades together, so switching tabs never refetches.
      */}
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {([
          ["levels", `Levels · ${stats.total}`],
          ["grades", `Grades${gradedRows.length ? ` · ${gradedRows.length}` : ""}`],
          ["sessions", `Sessions${days?.rows.length ? ` · ${days.rows.length}` : ""}`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={chipStyle(tab === id, T.cyan)}>
            {label}
          </button>
        ))}
        {day?.grade && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: TYPE.label, color: T.text }}>Session</span>
            <Pill accent={GRADE_ACCENT[day.grade] || T.text}>
              {day.grade} · {Number(day.score ?? 0).toFixed(1)}
            </Pill>
          </div>
        )}
      </div>

      {tab === "levels" && (
        <>
        {/* ── summary tiles ────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 10, flexShrink: 0 }}>
          <Tile value={stats.total} label="on watchlist" accent={T.text} />
          <Tile value={stats.graded} label="graded" accent={T.cyan} />
          <Tile value={stats.ungraded} label="not graded" accent={T.purple} />
          <Tile value={stats.above} label="above flip" accent={T.green} />
          <Tile value={stats.below} label="below flip" accent={T.red} />
          <Tile value={stats.near} label={`within ${NEAR_PCT}% of a level`} accent={T.gold} />
          <Tile value={stats.breach} label="outside floor/cap" accent={T.orange} />
        </div>

        {/* ── board ────────────────────────────────────────────────────────── */}
        <Card variant="classic" padding={0} style={{ ...CARD, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 14, borderBottom: `1px solid ${T.border}` }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter ticker…"
              style={{ ...homeInputStyle, background: SURFACE.card2, minWidth: 200, fontSize: TYPE.body }}
            />
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={chipStyle(filter === f.id, T.cyan)}>
                {f.label}
              </button>
            ))}
            {offRosterCount > 0 && (
              <button
                onClick={() => setShowOffRoster((v) => !v)}
                title="Graded names the watchlist doesn't carry"
                style={chipStyle(showOffRoster, T.lightBlue)}
              >
                +{offRosterCount} off roster
              </button>
            )}
            <span style={{ marginLeft: "auto", fontSize: TYPE.label, color: T.text, fontFamily: MONO }}>
              {visible.length} / {rows.length}
            </span>
          </div>

          {/*
            The roster is ~169 names, so the board scrolls in its OWN box rather
            than running the page down: vertical for the rows (head stays put),
            horizontal for the columns on a narrow window. `.wall-scroll` is the
            dashboard's own scrollbar (index.css) — cyan thumb on an inset track,
            the same bar the Walls table and the ranked rail use. The default
            white-wash bar reads as browser chrome sitting on the card.

            HEIGHT, not max-height, and `flexShrink: 0` on all four page blocks.
            PageShell's <main> is a fixed-height column flex container, so its
            children shrink by default when they overflow it — which collapsed this
            box to three visible rows no matter what max-height said. The box owns
            its height; the PAGE scrolls past it.
          */}
          <div className="wall-scroll" style={{ height: "clamp(420px, 64vh, 900px)", overflow: "auto" }}>
            <table style={{ width: "100%", minWidth: 1060, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th("ticker", "left")} onClick={() => toggleSort("ticker")}>Ticker{caret("ticker")}</th>
                  <th style={th("spot")} onClick={() => toggleSort("spot")}>Spot{caret("spot")}</th>
                  <th style={th("floor")} onClick={() => toggleSort("floor")}>Floor{caret("floor")}</th>
                  <th style={th("dFloor")} onClick={() => toggleSort("dFloor")}>Δ{caret("dFloor")}</th>
                  <th style={th("apex")} onClick={() => toggleSort("apex")}>CB{caret("apex")}</th>
                  <th style={th("cap")} onClick={() => toggleSort("cap")}>Cap{caret("cap")}</th>
                  <th style={th("dCap")} onClick={() => toggleSort("dCap")}>Δ{caret("dCap")}</th>
                  <th style={th("flip")} onClick={() => toggleSort("flip")}>Flip{caret("flip")}</th>
                  <th style={th("dFlip")} onClick={() => toggleSort("dFlip")}>Δ{caret("dFlip")}</th>
                  <th style={{ ...th(undefined, "left"), minWidth: 150 }}>Floor → Cap</th>
                  <th style={th(undefined, "left")}>State</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.ticker}
                    onMouseEnter={() => setHover(r.ticker)}
                    onMouseLeave={() => setHover((h) => (h === r.ticker ? null : h))}
                    style={{
                      background: hover === r.ticker ? SURFACE.cardHi : "transparent",
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <th
                      scope="row"
                      style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.02em", padding: 0 }}
                    >
                      <TickerButton ticker={r.ticker} onOpen={setHistSym} />
                    </th>
                    {priceCell(r.spot, true)}
                    {priceCell(r.floor)}
                    {deltaCell(r.dFloor)}
                    {priceCell(r.apex)}
                    {priceCell(r.cap)}
                    {deltaCell(r.dCap)}
                    {priceCell(r.flip)}
                    {deltaCell(r.dFlip)}
                    <td style={{ padding: "8px 10px", minWidth: 150 }}>
                      <BandBar row={r} />
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {!r.ungraded && (
                        <Pill accent={r.regime === "above" ? T.green : r.regime === "below" ? T.red : T.lightBlue}>
                          {r.regime === "above" ? "above flip" : r.regime === "below" ? "below flip" : "no flip"}
                        </Pill>
                      )}
                      {r.flags.map((f, i) => (
                        <Pill key={i} accent={FLAG_ACCENT[f.kind]}>{f.label}</Pill>
                      ))}
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={11} style={{ ...td, textAlign: "center", padding: 34 }}>
                      {loading || rosterLoading ? "Loading board…" : "Nothing matches that filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        </>
      )}

      {/* ── grades ───────────────────────────────────────────────────────── */}
      {tab === "grades" && (
        <>
          {/* Session roll-up. Points are SUMMED over points-available across
              every graded ticker — not the mean of their percentages, which
              would let a one-level ticker swing the day as hard as a
              four-level one. See daily-grades-recorder.js rollUpDay(). */}
          {day && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 10, flexShrink: 0 }}>
              <Tile
                value={day.score == null ? "—" : Number(day.score).toFixed(1)}
                label="session score"
                accent={day.grade ? GRADE_ACCENT[day.grade] || T.text : T.text}
              />
              <Tile value={day.grade ?? "—"} label="session grade" accent={day.grade ? GRADE_ACCENT[day.grade] || T.text : T.text} />
              <Tile value={`${day.pts ?? 0} / ${day.max_pts ?? 0}`} label="points" accent={T.cyan} />
              <Tile value={day.graded ?? 0} label="graded" accent={T.text} />
              <Tile value={`${day.cap_held ?? 0} / ${day.cap_tested ?? 0}`} label="cap held / tested" accent={T.green} />
              <Tile value={`${day.floor_held ?? 0} / ${day.floor_tested ?? 0}`} label="floor held / tested" accent={T.green} />
              <Tile value={day.flip_held ?? 0} label="flip held" accent={T.gold} />
              <Tile value={day.range_contained ?? 0} label="range contained" accent={T.purple} />
            </div>
          )}

          <Card variant="classic" padding={0} style={{ ...CARD, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 14, borderBottom: `1px solid ${T.border}` }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter ticker…"
                style={{ ...homeInputStyle, background: SURFACE.card2, minWidth: 200, fontSize: TYPE.body }}
              />
              {(["all", "A+", "A", "B", "C", "D", "F"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGradeFilter(g)}
                  style={chipStyle(gradeFilter === g, g === "all" ? T.cyan : GRADE_ACCENT[g] || T.cyan)}
                >
                  {g === "all" ? "All" : g}
                </button>
              ))}
              {day && (
                <span style={{ fontSize: TYPE.label, color: T.text }}>
                  {day.a_plus ?? 0} A+ · {day.a ?? 0} A · {day.b ?? 0} B · {day.c ?? 0} C · {day.d ?? 0} D · {day.f ?? 0} F
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: TYPE.label, color: T.text, fontFamily: MONO }}>
                {visibleGrades.length} / {gradedRows.length}
              </span>
            </div>

            <div className="wall-scroll" style={{ height: "clamp(420px, 64vh, 900px)", overflow: "auto" }}>
              <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th(undefined, "left")}>Ticker</th>
                    <th style={th(undefined)}>Grade</th>
                    <th style={th(undefined)}>Score</th>
                    <th style={th(undefined)}>Pts</th>
                    <th style={th(undefined, "left")}>Cap</th>
                    <th style={th(undefined, "left")}>Floor</th>
                    <th style={th(undefined, "left")}>Flip</th>
                    <th style={th(undefined, "left")}>CB</th>
                    <th style={th(undefined, "left")}>Range</th>
                    <th style={th(undefined)}>O</th>
                    <th style={th(undefined)}>H</th>
                    <th style={th(undefined)}>L</th>
                    <th style={th(undefined)}>C</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGrades.map((g) => (
                    <tr
                      key={g.symbol}
                      onMouseEnter={() => setHover(g.symbol)}
                      onMouseLeave={() => setHover((h) => (h === g.symbol ? null : h))}
                      style={{
                        background: hover === g.symbol ? SURFACE.cardHi : "transparent",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      <th scope="row" style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 800, padding: 0 }}>
                        <TickerButton ticker={g.symbol} onOpen={setHistSym} />
                      </th>
                      <td style={{ ...td, textAlign: "right" }}>
                        {g.grade
                          ? <Pill accent={GRADE_ACCENT[g.grade] || T.text}>{g.grade}</Pill>
                          : <Pill accent={T.lightBlue}>{g.status === "no_candles" ? "no candles" : "no levels"}</Pill>}
                      </td>
                      <td style={{ ...td, fontWeight: 800 }}>{g.score == null ? "—" : Number(g.score).toFixed(1)}</td>
                      <td style={td}>{g.max_pts ? `${g.pts} / ${g.max_pts}` : "—"}</td>
                      <td style={{ ...td, textAlign: "left" }}><Outcome v={g.cap_outcome} pts={g.cap_pts} /></td>
                      <td style={{ ...td, textAlign: "left" }}><Outcome v={g.floor_outcome} pts={g.floor_pts} /></td>
                      <td style={{ ...td, textAlign: "left" }}><Outcome v={g.flip_outcome} pts={g.flip_pts} /></td>
                      <td style={{ ...td, textAlign: "left" }}><Outcome v={g.apex_outcome} pts={g.apex_pts} /></td>
                      <td style={{ ...td, textAlign: "left" }}><Outcome v={g.range_outcome} pts={g.range_pts} /></td>
                      <td style={td}>{fmtPrice(g.o)}</td>
                      <td style={td}>{fmtPrice(g.h)}</td>
                      <td style={td}>{fmtPrice(g.l)}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{fmtPrice(g.c)}</td>
                    </tr>
                  ))}
                  {!visibleGrades.length && (
                    <tr>
                      <td colSpan={13} style={{ ...td, textAlign: "center", padding: 34 }}>
                        {loading
                          ? "Loading…"
                          : gradedRows.length
                            ? "Nothing matches that filter."
                            : "This session has not been graded yet — the board is graded at 16:20 ET."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}


      {/* ── sessions ─────────────────────────────────────────────────────── */}
      {/*
        The running record: `daily_grade_days`, one row per graded session,
        newest first. This is the ONLY tab that fetches — /proxy/daily-grades-days
        — and it does so the first time it is opened, not on mount.

        The summary tiles sum points over points-available across the window, the
        same arithmetic a single day row uses, so the window average and a day
        score are the same kind of number and can be read side by side.
      */}
      {tab === "sessions" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
            <span style={{ fontSize: TYPE.label, color: T.text }}>Window</span>
            {HISTORY_WINDOWS.map((d) => (
              <button key={d} onClick={() => setHistWindow(d)} style={chipStyle(histWindow === d, T.cyan)}>
                {d}
              </button>
            ))}
            <button
              style={homeSecondaryButtonStyle}
              onClick={() => void loadDays(histWindow)}
              disabled={daysLoading}
            >
              {daysLoading ? "Loading…" : "Refresh"}
            </button>
            {daysError && <span style={{ fontSize: TYPE.label, color: T.red }}>{daysError}</span>}
          </div>

          {days && days.rows.length > 0 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 10, flexShrink: 0 }}>
                <Tile
                  value={days.summary.score == null ? "—" : Number(days.summary.score).toFixed(1)}
                  label={`average over ${days.rows.length} sessions`}
                  accent={days.summary.grade ? GRADE_ACCENT[days.summary.grade] || T.text : T.text}
                />
                <Tile
                  value={days.summary.grade ?? "—"}
                  label="average grade"
                  accent={days.summary.grade ? GRADE_ACCENT[days.summary.grade] || T.text : T.text}
                />
                <Tile value={`${days.summary.pts} / ${days.summary.max_pts}`} label="points" accent={T.cyan} />
                <Tile value={days.summary.best == null ? "—" : Number(days.summary.best).toFixed(1)} label="best session" accent={T.green} />
                <Tile value={days.summary.worst == null ? "—" : Number(days.summary.worst).toFixed(1)} label="worst session" accent={T.red} />
              </div>

              <Card variant="classic" padding={14} style={{ ...CARD, flexShrink: 0 }}>
                <div style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.text, marginBottom: 9 }}>
                  Session score over time
                </div>
                <ScoreSpark
                  scores={days.rows.slice().reverse().map((d) => (d.score == null ? null : Number(d.score)))}
                  accent={days.summary.grade ? GRADE_ACCENT[days.summary.grade] || T.cyan : T.cyan}
                />
              </Card>
            </>
          )}

          <Card variant="classic" padding={0} style={{ ...CARD, overflow: "hidden", flexShrink: 0 }}>
            <div className="wall-scroll" style={{ height: "clamp(420px, 64vh, 900px)", overflow: "auto" }}>
              <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th(undefined, "left")}>Date</th>
                    <th style={th(undefined)}>Grade</th>
                    <th style={th(undefined)}>Score</th>
                    <th style={th(undefined)}>Pts</th>
                    <th style={th(undefined)}>Graded</th>
                    <th style={{ ...th(undefined, "left"), minWidth: 180 }}>Spread</th>
                    <th style={th(undefined)}>Cap held</th>
                    <th style={th(undefined)}>Floor held</th>
                    <th style={th(undefined)}>Flip held</th>
                    <th style={th(undefined)}>CB pinned</th>
                    <th style={th(undefined)}>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {days?.rows.map((d) => (
                    <tr
                      key={d.date}
                      onMouseEnter={() => setHover(d.date)}
                      onMouseLeave={() => setHover((h) => (h === d.date ? null : h))}
                      style={{
                        background: hover === d.date ? SURFACE.cardHi : "transparent",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      <th scope="row" style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 800 }}>
                        {fmtDay(d.date)}
                        <span style={{ marginLeft: 6, fontSize: TYPE.micro, fontWeight: 600, color: T.text, opacity: 0.7 }}>
                          {fmtWeekday(d.date)}
                        </span>
                      </th>
                      <td style={td}>
                        {d.grade
                          ? <Pill accent={GRADE_ACCENT[d.grade] || T.text}>{d.grade}</Pill>
                          : <Pill accent={T.lightBlue}>no grade</Pill>}
                      </td>
                      <td style={{ ...td, fontWeight: 800 }}>{d.score == null ? "—" : Number(d.score).toFixed(1)}</td>
                      <td style={td}>{d.max_pts ? `${d.pts} / ${d.max_pts}` : "—"}</td>
                      <td style={td}>{d.graded ?? 0} / {d.tickers ?? 0}</td>
                      {/* The letter spread for that session, in rubric order. Only
                          the letters that occurred are drawn — an empty band is
                          noise, not information. */}
                      <td style={{ padding: "8px 10px", minWidth: 180 }}>
                        {(["A+", "A", "B", "C", "D", "F"] as const).map((g) => {
                          const n = g === "A+" ? d.a_plus : g === "A" ? d.a : g === "B" ? d.b
                            : g === "C" ? d.c : g === "D" ? d.d : d.f;
                          return n ? <Pill key={g} accent={GRADE_ACCENT[g]}>{n} {g}</Pill> : null;
                        })}
                      </td>
                      <td style={td}>{d.cap_held ?? 0} / {d.cap_tested ?? 0}</td>
                      <td style={td}>{d.floor_held ?? 0} / {d.floor_tested ?? 0}</td>
                      <td style={td}>{d.flip_held ?? 0}</td>
                      <td style={td}>{d.apex_pinned ?? 0}</td>
                      <td style={td}>{d.range_contained ?? 0}</td>
                    </tr>
                  ))}
                  {!days?.rows.length && (
                    <tr>
                      <td colSpan={11} style={{ ...td, textAlign: "center", padding: 34 }}>
                        {daysLoading
                          ? "Loading sessions…"
                          : daysError
                            ? "Session history could not be read."
                            : "No graded session on record yet — the first row lands after a 16:20 ET run."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ── ticker history ───────────────────────────────────────────────── */}
      {histSym && (
        <TickerHistoryModal
          symbol={histSym}
          onClose={() => setHistSym(null)}
          windowDays={histWindow}
          onWindow={setHistWindow}
        />
      )}

      {/* ── legend ───────────────────────────────────────────────────────── */}
      {/* Each tab gets the glossary it needs: what the levels ARE, or what the
          verdicts on them MEAN. Both are the recorder's own vocabulary — keep
          them in step with daily-grades-recorder.js if the rubric moves. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, flexShrink: 0 }}>
        {(tab === "sessions" ? SESSION_LEGEND : tab === "grades" ? GRADE_LEGEND : [
          ["Roster", "The scanner watchlist from /proxy/scanner-tickers — the same universe the ΔGEX Board runs over."],
          ["Click a ticker", "Opens its grade history — every session that name was sealed for, with what each level did and what the whole board scored that day."],
          ["Cap", "Where 80% of the call gamma ladder sits below — the empirical percentile of the settled-OI call GEX, not the single biggest strike."],
          ["Floor", "Where 20% of the put gamma ladder sits below — the same read from the other end."],
          ["CB", "The CB print. Carried as `apex` in the payload — the column is the same number under the name it is actually called."],
          ["Flip", "Gamma flip. Spot above it is the calmer regime; below it, the chop."],
          ["Δ columns", `How far spot has to travel to reach that level. Positive = the level is above spot; bold = inside ${NEAR_PCT}%.`],
          ["Floor → Cap", "Where spot sits between the two, in price. White tick = spot, gold line = flip. Blank when floor sits above cap — nothing to draw."],
        ]).map(([k, v]) => (
          <div key={k} style={{ ...INSET, borderRadius: 12, padding: "11px 14px" }}>
            <div style={{ fontSize: TYPE.label, fontWeight: 800, marginBottom: 3, color: T.text }}>{k}</div>
            <div style={{ fontSize: TYPE.label, color: T.text }}>{v}</div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
