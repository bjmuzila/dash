// Owner "ΔGEX Board" — which strikes had dealer gamma built or taken off at
// yesterday's close, across the whole scanner watchlist.
//
// SHAPE: master–detail. A ranked rail on the left, one permanent full-size
// ladder on the right. Nothing is hidden behind a click — ↑/↓ walks the rail
// and repaints the ladder, so a daily pass over 169 names is a few seconds of
// arrowing rather than 169 navigations.
//
// DATA — three routes, all server-differenced. Nothing on this page subtracts
// one GEX number from another:
//   GET /api/eod-strike-gex-board?top=5[&date]   one call, the whole rail
//   GET /api/eod-strike-gex-change?symbol[&date] one call per name you open
//   GET /api/eod-strike-gex-dates                which sessions exist
// Written by server-v2/eod-strike-gex-recorder.js at 16:05 ET into
// eod_strike_gex. Each symbol is diffed against ITS OWN two most recent
// snapshot dates, so a name that missed a sweep compares against the last
// session it actually has instead of reading as flat.
//
// THREE MODES over the SAME payload. Every route returns the absolute level,
// the PRIOR level and the Δ on every strike, so switching modes is a re-render,
// never a fetch:
//   levels  — net GEX as that session closed
//   delta   — that level minus the session before it
//   compare — prior and now drawn on one rail, plus the four-way split below
// Retention is ~400 days, so the date picker reaches back a year. Picking an
// older session switches to `levels`, because "what did the board look like on
// the 8th" is a level question; the Δ tab is right there for the other read.
//
// WHY `compare` EXISTS. A red Δ bar is AMBIGUOUS on its own. `chg` is
// `now − prior` on a signed net_gex, so "net GEX at this strike went down" is
// equally consistent with two opposite tapes:
//   positive (call-dominant) gamma being TAKEN OFF, and
//   negative (put-dominant) gamma being PILED ON.
// The Δ ladder cannot tell those apart and neither can the Most-pulled sort.
// Compare mode draws yesterday as an outline and today as a fill on the same
// rung — so a shrinking green bar and a growing red bar are visibly different
// events — and splitChange() totals the four cases exactly. Do not "simplify"
// this back into a single Δ bar.
//
// COLOUR: green/red alone fails deuteranope separation (ΔE 7.4), so the sign is
// ALSO carried by which side of the centre rail a bar sits on and by an
// explicit +/− on every value. Do not "simplify" this to colour-only bars.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle, homeSecondaryButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { ThemedSelect } from "../components/ThemedSelect";

const T = HOME_THEME;
// The app's GEX polarity pair, matching the Ticker Lookup ladder on the
// customer side. Deliberately not the owner status palette — a trader reads
// +GEX green / −GEX red everywhere else in this app.
const POS = "#22C55E";
const NEG = "#EF4444";
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── payload shapes ──────────────────────────────────────────────────────────
/** Which reading the board is showing. Not a filter — a different number. */
type Mode = "delta" | "levels" | "compare";

type BoardStrike = { strike: number; chg: number };
type BoardLevelStrike = { strike: number; gex: number };
type BoardSymbol = {
  symbol: string;
  date: string | null;
  prevDate: string | null;
  spot: number | null;
  // Δ vs the prior session. Zeroed server-side when there is no prior session,
  // so a name's first day never reads as a landslide.
  net: number;
  absTot: number;
  strikes: BoardStrike[];
  // Absolute level at `date`. Needs no baseline, so these are real on day one.
  gexNet: number;
  gexAbs: number;
  gexStrikes: BoardLevelStrike[];
};
type BoardResp = { ok?: boolean; top?: number; date?: string | null; symbols?: BoardSymbol[]; error?: string };

type ChangeRow = { strike: number; netGex: number; prevNetGex: number; chg: number; hadPrev: boolean };
type ChangeResp = {
  ok?: boolean; symbol?: string; date?: string | null; prevDate?: string | null;
  spot?: number | null; prevSpot?: number | null; rows?: ChangeRow[]; error?: string;
};
type DatesResp = { ok?: boolean; dates?: string[]; error?: string };

/** Per-mode wording. Kept in one table so a label can't drift from its number. */
const MODE_COPY: Record<Mode, {
  tab: string; ladderCol: string; bigLabel: string; axis: string;
  sorts: readonly [string, string, string];
}> = {
  delta: {
    tab: "Δ 1 day",
    ladderCol: "Δ 1D",
    bigLabel: "net Δ 1D",
    axis: "← removed · added →",
    sorts: ["Biggest move", "Most built", "Most pulled"],
  },
  levels: {
    tab: "Net GEX",
    ladderCol: "Net GEX",
    bigLabel: "net GEX",
    axis: "← negative · positive →",
    sorts: ["Biggest gamma", "Most positive", "Most negative"],
  },
  // Compare is a Δ reading — same rail numbers, same sorts as `delta`. Only the
  // ladder and the header strip differ, so the two tabs rank identically and a
  // reader can flip between them without the list reshuffling under them.
  compare: {
    tab: "Prior → now",
    ladderCol: "Δ 1D",
    bigLabel: "net Δ 1D",
    axis: "← negative · positive →",
    sorts: ["Biggest move", "Most built", "Most pulled"],
  },
};

/** Δ readings — everything that needs a baseline session to mean anything. */
const isDelta = (m: Mode) => m !== "levels";

/**
 * Split a session's Δ into the four things that can produce it.
 *
 * Positive and negative gamma are tracked SEPARATELY per strike, because the
 * headline Δ is ambiguous: net GEX falling is equally consistent with call
 * gamma being taken off and with put gamma being piled on, and those are
 * opposite reads of the tape.
 *
 * The split is exact and additive by construction:
 *   posPart = max(now,0) − max(prior,0)     change in the positive leg
 *   negPart = min(now,0) − min(prior,0)     change in the negative leg
 *   posPart + negPart === now − prior === chg
 * That identity holds even when a strike FLIPS sign across the session, which
 * is exactly the case a naive `prior > 0 ? …` bucket would misfile. So the four
 * buckets always sum back to the headline net Δ — if they ever don't, the bug
 * is here and not in the reader's arithmetic.
 */
function splitChange(rows: ChangeRow[]) {
  let posBuilt = 0, posPulled = 0, negBuilt = 0, negPulled = 0;
  for (const r of rows) {
    const posPart = Math.max(r.netGex, 0) - Math.max(r.prevNetGex, 0);
    const negPart = Math.min(r.netGex, 0) - Math.min(r.prevNetGex, 0);
    if (posPart >= 0) posBuilt += posPart; else posPulled += posPart;
    // negPart < 0 means the negative leg got DEEPER, i.e. −γ was built.
    if (negPart <= 0) negBuilt += negPart; else negPulled += negPart;
  }
  return { posBuilt, posPulled, negBuilt, negPulled };
}

// ── formatting ──────────────────────────────────────────────────────────────
function fmtBig(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(0)}K`;
  return a.toFixed(0);
}
/** Signed, with a real minus sign — the sign is data, so it never gets dropped. */
const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtBig(v)}`;
const col = (v: number) => (v > 0 ? POS : v < 0 ? NEG : T.textMuted);

const label: CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
  textTransform: "uppercase", color: T.text, opacity: 0.45,
};
const oneLine: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };

// ── the ladder ──────────────────────────────────────────────────────────────
// Bars run out from a centre rail: removed left, added right. Highest strike at
// the top, like a DOM, so the shape matches every other ladder in the app.
const LADDER_COLS = "82px 1fr 78px";

/**
 * One rung's bars, drawn out from a shared centre rail. `compare` passes TWO
 * items (prior as an outline, now as a fill); the other modes pass one.
 *
 * The rail is absolutely positioned behind the stack rather than rendered
 * inline per bar: two inline rails would stack into a dashed line and a
 * two-bar rung would read as two adjacent strikes instead of one strike
 * measured twice.
 */
function RailBars({ items, max }: { items: Array<{ v: number; ghost?: boolean }>; max: number }) {
  const h = items.length > 1 ? 8 : 12;
  return (
    <span style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span aria-hidden style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: T.border }} />
      {items.map((it, i) => {
        const pos = it.v >= 0;
        // A 2% floor keeps a real-but-tiny value visible; a true zero draws
        // nothing, so "no change" and "a rounding crumb" stay distinguishable.
        const pct = it.v === 0 ? 0 : Math.max(2, (Math.abs(it.v) / max) * 100);
        const c = pos ? POS : NEG;
        // Outline + wash for the prior session. Two solid bars would compete;
        // the eye should land on TODAY and use yesterday as the reference edge.
        const skin: CSSProperties = it.ghost
          ? { border: `1px solid ${c}`, background: `${c}26`, boxSizing: "border-box" }
          : { background: c, boxSizing: "border-box" };
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
              {!pos && pct > 0 && <span style={{ width: `${pct}%`, height: h, borderRadius: "4px 0 0 4px", ...skin }} />}
            </span>
            <span style={{ width: 1, flexShrink: 0, margin: "0 2px" }} />
            <span style={{ flex: 1, display: "flex" }}>
              {pos && pct > 0 && <span style={{ width: `${pct}%`, height: h, borderRadius: "0 4px 4px 0", ...skin }} />}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Ladder({
  rows, spot, mode,
}: {
  rows: ChangeRow[];
  spot: number | null;
  mode: Mode;
}) {
  // The ONE place the mode picks a number. Everything below — the bar, the
  // scale, the sign, the colour — reads `val`, so the two views cannot drift
  // into drawing one number and labelling it as the other.
  const cmp = mode === "compare";
  const val = (r: ChangeRow) => (mode === "levels" ? r.netGex : r.chg);
  // Compare draws two LEVELS per rung, so its scale has to cover both of them
  // rather than the (much smaller) Δ between them — otherwise every bar pegs.
  const max = rows.reduce(
    (m, r) => Math.max(m, cmp ? Math.max(Math.abs(r.prevNetGex), Math.abs(r.netGex)) : Math.abs(val(r))),
    0,
  ) || 1;
  // The rung price is actually sitting on — marked, not sorted to the middle.
  const spotStrike = spot == null || !rows.length
    ? null
    : rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), rows[0]).strike;
  const desc = [...rows].sort((a, b) => b.strike - a.strike);

  // NO auto-scroll-to-spot. There used to be a useLayoutEffect here that parked
  // the spot rung in the middle of the ladder's own scrolling viewport, because
  // the ladder is ±40 strikes deep and sorted high→low — so scrollTop 0 opened
  // on the far upside wing. That viewport is gone: the ladder now renders full
  // length and the WINDOW scrolls. Recreating the behaviour would mean scrolling
  // the page, which would drag the card header, the split chips and the symbol
  // rail off-screen every time you arrowed to the next name. The cyan spot rung
  // is still marked, and the whole ladder is visible by scrolling normally.

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: LADDER_COLS, gap: 8, alignItems: "center", paddingBottom: 5 }}>
        <span style={label}>Strike</span>
        <span style={{ ...label, textAlign: "center" }}>{MODE_COPY[mode].axis}</span>
        <span style={{ ...label, textAlign: "right" }}>{MODE_COPY[mode].ladderCol}</span>
      </div>
      {desc.map((r) => {
        const v = val(r);
        const isSpot = spotStrike != null && r.strike === spotStrike;
        // Prior first so it sits ABOVE today — the rung reads top-to-bottom as
        // "was → is", which is the direction the tab name promises.
        const bars = cmp
          ? [{ v: r.prevNetGex, ghost: true }, { v: r.netGex }]
          : [{ v }];
        return (
          <div
            key={r.strike}
            title={`${r.strike} · now ${sgn(r.netGex)} · prior ${sgn(r.prevNetGex)} · Δ ${sgn(r.chg)}${r.hadPrev ? "" : " (new strike — no prior row)"}`}
            style={{
              display: "grid", gridTemplateColumns: LADDER_COLS, gap: 8, alignItems: "center",
              padding: "2px 6px", borderRadius: 8,
              border: `1px solid ${isSpot ? T.cyan : "transparent"}`,
              background: isSpot ? "rgba(33,158,188,0.08)" : "transparent",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ ...oneLine, fontFamily: MONO, fontSize: 12.5, fontWeight: isSpot ? 800 : 600, color: isSpot ? T.cyan : T.text }}>
                {r.strike.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              {isSpot && <span style={{ fontSize: 9, fontWeight: 800, color: T.cyan }}>◀</span>}
            </span>
            <RailBars items={bars} max={max} />
            <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: col(v) }}>
              {sgn(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
const TOP_N = 5;
// THE CARD IS FULL LENGTH AND THE PAGE SCROLLS. Both panes used to be pinned to
// `max(340px, calc(100vh - 318px))` with the ladder scrolling INSIDE the card —
// so the ±40-rung ladder was read through a ~400px slot while the page itself
// never moved. Now the detail pane has no height at all: it renders all ~81
// rungs, the card grows to fit, and the browser scrolls the whole page.
//
// The rail is the one thing that CANNOT follow that rule — it is 169 names, far
// taller than any ladder, and letting it size the grid row would leave the card
// several screens of empty space below the last strike. So it keeps its own
// scroll and is sized BY the detail pane rather than by its own content: the
// wrapper is `position: relative` and contributes only RAIL_MIN_H of intrinsic
// height, and the rail inside it is `position: absolute; inset: 0`. Absolute
// means the rail's 169 rows are out of flow and cannot inflate the grid row, so
// the row height comes from the ladder and the rail fills exactly that. That is
// what keeps the two panes level without a magic pixel number.
const RAIL_MIN_H = 340;
// The series only changes once a day at 16:05 ET, so this is a courtesy refresh
// for a tab left open overnight — not a live poll. The ↻ button is the real
// refresh path.
const REFRESH_MS = 15 * 60_000;

export default function GexGrowth() {
  const [board, setBoard] = useState<BoardSymbol[] | null>(null);
  const [boardErr, setBoardErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dir, setDir] = useState<"abs" | "built" | "pulled">("abs");
  const [mode, setMode] = useState<Mode>("delta");

  // Recorded sessions, newest first. "" = latest, which is what both routes do
  // with no date param — kept as the empty string rather than null so it drops
  // straight into a <select> value without a nullable branch.
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");

  const [detail, setDetail] = useState<ChangeResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Monotonic token — clicking down the rail faster than the network answers
  // must not let an earlier name's ladder land under a later name's header.
  const detailReq = useRef(0);

  // Session list. Loaded once — a new date only appears at 16:05 ET, and the ↻
  // button re-reads it along with everything else.
  const loadDates = useCallback(async () => {
    try {
      const res = await fetch(`/api/eod-strike-gex-dates?limit=180`, { cache: "no-store" });
      const json: DatesResp = await res.json();
      if (res.ok && json.ok !== false) setDates(json.dates ?? []);
    } catch { /* the picker just stays on "latest" — not worth an error banner */ }
  }, []);

  const dateQs = date ? `&date=${date}` : "";

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/eod-strike-gex-board?top=${TOP_N}${dateQs}`, { cache: "no-store" });
      const json: BoardResp = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setBoard(json.symbols ?? []);
      setBoardErr(null);
    } catch (e) {
      setBoardErr(String((e as Error)?.message || e));
    }
  }, [dateQs]);

  useEffect(() => { loadDates(); }, [loadDates]);

  useEffect(() => {
    loadBoard();
    const id = setInterval(loadBoard, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadBoard]);

  const loadDetail = useCallback(async (symbol: string) => {
    const mine = ++detailReq.current;
    setDetailLoading(true);
    setDetailErr(null);
    try {
      const res = await fetch(
        `/api/eod-strike-gex-change?symbol=${encodeURIComponent(symbol)}${dateQs}`,
        { cache: "no-store" },
      );
      const json: ChangeResp = await res.json();
      if (detailReq.current !== mine) return;
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail(json);
    } catch (e) {
      if (detailReq.current === mine) { setDetail(null); setDetailErr(String((e as Error)?.message || e)); }
    } finally {
      if (detailReq.current === mine) setDetailLoading(false);
    }
  }, [dateQs]);

  const pickDate = useCallback((d: string) => {
    setDate(d);
    // An older session is a LEVEL question — "what did the board look like on
    // the 8th" — so land there rather than on a Δ against the 7th. Coming back
    // to the newest session restores the Δ, which is what this page is for.
    // Either way the tabs stay live; this is a default, not a lock.
    setMode(d && d !== dates[0] ? "levels" : "delta");
  }, [dates]);

  // Changing the session re-reads the OPEN name's ladder, so the rail and the
  // detail pane can never be showing two different dates.
  //
  // Keyed on loadDetail — whose identity is keyed on the date — rather than on
  // `date` plus `sel`: adding `sel` would re-fetch on every rail click, which
  // pick() already does, and reading it through a ref keeps that out of the
  // dep list without lying to the linter about what the effect depends on.
  const selRef = useRef<string | null>(null);
  selRef.current = sel;
  useEffect(() => {
    const s = selRef.current;
    if (s) loadDetail(s);
  }, [loadDetail]);

  // The rail's two numbers, per mode. Signed drives the value column and the
  // built/pulled sorts; magnitude drives the "biggest" sort and the bar width.
  const railSigned = useCallback((s: BoardSymbol) => (mode === "levels" ? s.gexNet : s.net), [mode]);
  const railMag = useCallback((s: BoardSymbol) => (mode === "levels" ? s.gexAbs : s.absTot), [mode]);

  // Rail order + filter. Both rankings are computed server-side off the same
  // CTE; re-sorting here is a VIEW of those numbers, never a re-diff.
  const rail = useMemo(() => {
    const q = filter.trim().toUpperCase();
    let list = (board ?? []).filter((s) => !q || s.symbol.includes(q));
    if (dir === "built") list = [...list].sort((a, b) => railSigned(b) - railSigned(a));
    else if (dir === "pulled") list = [...list].sort((a, b) => railSigned(a) - railSigned(b));
    // The server's default order is |Δ|. Level mode wants |net GEX|, so "biggest"
    // has to re-sort rather than lean on the payload order.
    else if (mode === "levels") list = [...list].sort((a, b) => Math.abs(b.gexAbs) - Math.abs(a.gexAbs));
    return list;
  }, [board, filter, dir, mode, railSigned]);

  // Auto-select the top name once the board lands, so the detail pane is never
  // an empty box on first paint.
  useEffect(() => {
    if (sel == null && rail.length) { setSel(rail[0].symbol); loadDetail(rail[0].symbol); }
  }, [rail, sel, loadDetail]);

  const pick = useCallback((symbol: string) => { setSel(symbol); loadDetail(symbol); }, [loadDetail]);

  // ↑/↓ walks the rail. The whole point of master–detail is that you can review
  // the board without reaching for the mouse.
  const onRailKey = useCallback((e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = rail.findIndex((s) => s.symbol === sel);
    const next = e.key === "ArrowDown" ? Math.min(rail.length - 1, i + 1) : Math.max(0, i - 1);
    if (rail[next] && rail[next].symbol !== sel) pick(rail[next].symbol);
  }, [rail, sel, pick]);

  const maxAbs = rail.reduce((m, s) => Math.max(m, Math.abs(railMag(s))), 0) || 1;
  const selRow = rail.find((s) => s.symbol === sel) ?? null;
  const withBaseline = (board ?? []).filter((s) => s.prevDate).length;
  // Level mode needs no baseline, so a name on its first session is a real row
  // there and a "—" in Δ mode. One flag, read in both places that care.
  const railHasValue = (s: BoardSymbol) => mode === "levels" || !!s.prevDate;
  // Which strikes the top-N strip shows — the same ranking the rail sorted on.
  const topStrikes: Array<{ strike: number; v: number }> = selRow
    ? (mode === "levels"
      ? (selRow.gexStrikes ?? []).map((k) => ({ strike: k.strike, v: k.gex }))
      : (selRow.strikes ?? []).map((k) => ({ strike: k.strike, v: k.chg })))
    : [];
  const sessionLabel = date || dates[0] || "latest";
  // Compare mode's headline. Read off the DETAIL rows, not the rail row — the
  // board payload carries only `chg` per strike and this needs both levels.
  const split = useMemo(
    () => (mode === "compare" && detail?.rows?.length && detail.prevDate ? splitChange(detail.rows) : null),
    [mode, detail],
  );
  // Labelled so the sign on the value is never a surprise: "built" always adds
  // magnitude on its own side, "pulled" always removes it.
  const splitChips: Array<{ k: string; v: number; t: string }> = split
    ? [
      { k: "+γ built", v: split.posBuilt, t: "Positive (call-dominant) gamma ADDED — net GEX up" },
      { k: "+γ pulled", v: split.posPulled, t: "Positive gamma TAKEN OFF — net GEX down without any new put gamma" },
      { k: "−γ built", v: split.negBuilt, t: "Negative (put-dominant) gamma PILED ON — net GEX down" },
      { k: "−γ pulled", v: split.negPulled, t: "Negative gamma COVERED — net GEX up" },
    ]
    : [];

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="ΔGEX Board"
        subtitle="Per-strike dealer gamma at the close, or what was built and taken off — whole board ex-0DTE, scanner watchlist. Recorded 16:05 ET, ~400 sessions on file."
      >
        {/* Controls: one row above the data, per the house pattern. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value.toUpperCase())}
            placeholder="Filter symbol…"
            aria-label="Filter symbol"
            style={{
              background: T.panelInset, border: `1px solid ${T.border}`, borderRadius: 10,
              padding: "7px 11px", color: T.text, fontFamily: MONO, fontSize: 13, width: 150,
            }}
          />
          {(["abs", "built", "pulled"] as const).map((k, i) => (
            <button key={k} onClick={() => setDir(k)} style={dir === k ? homeButtonStyle : homeSecondaryButtonStyle}>
              {MODE_COPY[mode].sorts[i]}
            </button>
          ))}

          {/* Mode tabs. Both readings are already in the payload, so this is a
              re-render — switching never re-fetches and never re-diffs. */}
          <span style={{ display: "flex", gap: 4, border: `1px solid ${T.border}`, borderRadius: 999, padding: 3 }}>
            {(["levels", "delta", "compare"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                title={m === "levels"
                  ? "Net GEX as that session closed"
                  : m === "delta"
                    ? "That session minus the one before it"
                    : "Prior and current level on the same rung — tells apart +γ taken off from −γ piled on, which a single Δ bar cannot"}
                style={{
                  ...(mode === m ? homeButtonStyle : homeSecondaryButtonStyle),
                  borderRadius: 999, padding: "5px 12px", border: mode === m ? undefined : "1px solid transparent",
                  background: mode === m ? undefined : "transparent",
                }}
              >
                {MODE_COPY[m].tab}
              </button>
            ))}
          </span>

          {/* Session picker. Populated from the rows that actually exist, so a
              holiday or a failed sweep is simply not in the list. */}
          <ThemedSelect
            value={date}
            onChange={pickDate}
            width={168}
            ariaLabel="Session date"
            options={[
              { value: "", label: dates.length ? `Latest · ${dates[0]}` : "Latest" },
              ...dates.slice(1).map((d) => ({ value: d, label: d })),
            ]}
          />

          <button onClick={() => { loadDates(); loadBoard(); }} style={homeSecondaryButtonStyle} title="Re-read the recorded board">↻</button>
          <span style={{ ...label, marginLeft: "auto" }}>
            {board == null
              ? "loading…"
              : mode === "levels"
                ? `${rail.length} symbol${rail.length === 1 ? "" : "s"} · close ${sessionLabel}`
                : `${rail.length} symbol${rail.length === 1 ? "" : "s"} · ${withBaseline} with a baseline`}
          </span>
        </div>

        {boardErr ? (
          <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Board failed: {boardErr}</div>
        ) : board != null && board.length === 0 ? (
          <div style={{ color: T.text, opacity: 0.6, fontSize: 13 }}>
            {date
              ? `Nothing recorded on or before ${date}. Pick a later session.`
              : "No end-of-day snapshots recorded yet. The first sweep runs at 16:05 ET; the Δ column needs a second session before it can say anything."}
          </div>
        ) : (
          <div className="gexgrowth-split" style={{ display: "grid", gridTemplateColumns: "268px 1fr", gap: 14, alignItems: "stretch" }}>

            {/* ── rail ───────────────────────────────────────────────── */}
            {/* Wrapper carries only the floor height; the rail itself is out of
                flow (see RAIL_MIN_H) so 169 names cannot stretch the grid row
                past the ladder. `min-height` not `height`, so a short ladder
                still gets a usable rail instead of a 40px sliver. */}
            <div className="gexgrowth-rail-wrap" style={{ position: "relative", minHeight: RAIL_MIN_H }}>
              <div
                tabIndex={0}
                onKeyDown={onRailKey}
                aria-label={mode === "levels" ? "Symbols ranked by absolute net GEX" : "Symbols ranked by absolute ΔGEX"}
                style={{
                  position: "absolute", inset: 0,
                  border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
                  overflowY: "auto", outline: "none",
                }}
              >
              {rail.map((s) => {
                const on = s.symbol === sel;
                return (
                  <div
                    key={s.symbol}
                    onClick={() => pick(s.symbol)}
                    title={mode === "levels"
                      ? `${s.symbol} · net GEX at close ${s.date}`
                      : s.prevDate
                        ? `${s.symbol} · ${s.date} vs ${s.prevDate}`
                        : `${s.symbol} · one snapshot only (${s.date}) — no baseline yet`}
                    style={{
                      display: "grid", gridTemplateColumns: "1fr 62px", gap: 8, alignItems: "center",
                      padding: "8px 10px", cursor: "pointer",
                      borderBottom: `1px solid rgba(255,255,255,0.05)`,
                      background: on ? "rgba(125,211,252,0.12)" : "transparent",
                      boxShadow: on ? `inset 2px 0 0 ${LIGHT_BLUE}` : "none",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <span style={{ ...oneLine, fontSize: 13, fontWeight: 800 }}>{s.symbol}</span>
                      {/* Magnitude bar — the summed ABSOLUTE of whichever
                          reading is showing, so a name that churned hard both
                          ways still reads as busy even when its net is ~0. */}
                      <span style={{
                        height: 5, borderRadius: 3, background: LIGHT_BLUE, flexShrink: 0,
                        width: Math.max(6, (Math.abs(railMag(s)) / maxAbs) * 84),
                        opacity: railHasValue(s) ? 1 : 0.25,
                      }} />
                    </span>
                    <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: railHasValue(s) ? col(railSigned(s)) : T.textMuted, opacity: railHasValue(s) ? 1 : 0.45 }}>
                      {railHasValue(s) ? sgn(railSigned(s)) : "—"}
                    </span>
                  </div>
                );
              })}
              {rail.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: T.text, opacity: 0.5 }}>No symbol matches that filter.</div>
              )}
              </div>
            </div>

            {/* ── detail ─────────────────────────────────────────────── */}
            {/* No height and no inner scroller — this pane is what SIZES the
                grid row. It renders the header, the big number, the strip and
                the full ladder at natural height, the card grows to fit, and
                the page scrolls. */}
            <div style={{
              border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, background: T.panelBg,
              minWidth: 0, display: "flex", flexDirection: "column",
            }}>
              {sel == null ? (
                <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a symbol.</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{sel}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: T.text, opacity: 0.6 }}>
                      {detail?.spot != null ? `spot ${detail.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
                      {mode === "levels"
                        ? (detail?.date ? ` · close ${detail.date}` : "")
                        : detail?.prevDate ? ` · ${detail.date} vs close ${detail.prevDate}` : detail?.date ? ` · ${detail.date} · no baseline yet` : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0 6px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color: selRow ? col(railSigned(selRow)) : T.text }}>
                      {selRow && railHasValue(selRow) ? sgn(railSigned(selRow)) : "—"}
                    </span>
                    <span style={label}>{MODE_COPY[mode].bigLabel}</span>
                    {topStrikes.length ? (
                      <span style={{ ...label, marginLeft: 10 }}>
                        biggest {topStrikes[0].strike} · {sgn(topStrikes[0].v)}
                      </span>
                    ) : null}
                  </div>

                  {/* Compare replaces the top-N strip with the four-way split —
                      same vertical cost, and it is the whole reason the tab
                      exists. The four values sum EXACTLY back to the net Δ
                      above them (see splitChange), so this strip and the big
                      number can never disagree. */}
                  {splitChips.length ? (
                    <div
                      title="The four ways a session's net Δ can be produced. They sum exactly to the net Δ above."
                      style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}
                    >
                      {splitChips.map((c) => (
                        <span key={c.k} title={c.t} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                          fontFamily: MONO, fontSize: 11.5,
                        }}>
                          <span style={{ opacity: 0.65 }}>{c.k}</span>
                          <span style={{ fontWeight: 700, color: col(c.v) }}>{sgn(c.v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : topStrikes.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
                      {topStrikes.map((k) => (
                        <span key={k.strike} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                          fontFamily: MONO, fontSize: 11.5,
                        }}>
                          <span style={{ opacity: 0.65 }}>{k.strike}</span>
                          <span style={{ fontWeight: 700, color: col(k.v) }}>{sgn(k.v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {detailErr ? (
                    <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Ladder failed: {detailErr}</div>
                  ) : detailLoading && !detail ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>Reading ladder…</div>
                  ) : isDelta(mode) && detail && detail.date && !detail.prevDate ? (
                    // Checked BEFORE the empty-rows case: a symbol on its first
                    // session has rows but no baseline, and "no recorded
                    // strikes" would be the wrong answer to why it looks blank.
                    // Δ mode only — the LEVEL ladder is perfectly readable with
                    // one snapshot on file, so gating it here would hide real
                    // data behind a message about a diff nobody asked for.
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      One snapshot on file ({detail.date}). The Δ needs a second session — it lands after the next 16:05 ET sweep.
                      {" "}Switch to <strong>Net GEX</strong> to read this one on its own.
                    </div>
                  ) : !detail?.rows?.length ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>No recorded strikes for {sel}.</div>
                  ) : (
                    // No flex:1, no overflow — the ladder renders every rung at
                    // natural height and this pane grows with it. The old
                    // flex:1 + minHeight:0 + overflowY:auto was what trapped the
                    // ladder in a ~400px slot inside a fixed-height card.
                    <div style={{ opacity: detailLoading ? 0.55 : 1, transition: "opacity .12s" }}>
                      <Ladder rows={detail.rows} spot={detail.spot ?? null} mode={mode} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ ...label, marginTop: 12, opacity: 0.35 }}>
          OI+Vol basis · whole board excl. 0DTE · ±40 strikes around the close ·
          {mode === "levels"
            ? " net GEX as each symbol's session closed"
            : mode === "compare"
              ? " outline = prior close, fill = current close · the four chips sum to the net Δ"
              : " each symbol diffed against its own two most recent snapshots"}
          {date ? ` · as of ${date}` : ""}
        </div>
      </Card>

      <style>{`
        @media (max-width: 860px) {
          .gexgrowth-split { grid-template-columns: 1fr !important; }
          /* Stacked, the rail's absolute-fill trick has nothing to size against
             — the ladder is no longer beside it, it is below it — so a 169-name
             list would push the ladder a full screen down. Give the rail back a
             capped height of its own and let it scroll there. The detail pane is
             untouched and still renders full length. */
          .gexgrowth-rail-wrap { min-height: 0 !important; height: 46vh; }
        }
      `}</style>
    </PageShell>
  );
}
