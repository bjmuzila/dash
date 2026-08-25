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
  fmtPrice,
  fmtPct,
  fmtSealed,
  NEAR_PCT,
  type DgPayload,
  type DgRow,
  type DgSource,
  type DgFlagKind,
  type DgGradeRow,
  type DgDay,
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

// ── page ─────────────────────────────────────────────────────────────────────

export default function DailyGrades() {
  const [payload, setPayload] = useState<DgPayload | null>(null);
  const [source, setSource] = useState<DgSource>("sample");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grades, setGrades] = useState<DgGradeRow[]>([]);
  const [day, setDay] = useState<DgDay | null>(null);
  const [tab, setTab] = useState<"levels" | "grades">("levels");
  const [gradeFilter, setGradeFilter] = useState<"all" | "A+" | "A" | "B" | "C" | "D" | "F">("all");

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
                      style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 800, letterSpacing: "0.02em" }}
                    >
                      {r.ticker}
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
                      <th scope="row" style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 800 }}>
                        {g.symbol}
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


      {/* ── legend ───────────────────────────────────────────────────────── */}
      {/* Each tab gets the glossary it needs: what the levels ARE, or what the
          verdicts on them MEAN. Both are the recorder's own vocabulary — keep
          them in step with daily-grades-recorder.js if the rubric moves. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, flexShrink: 0 }}>
        {(tab === "grades" ? GRADE_LEGEND : [
          ["Roster", "The scanner watchlist from /proxy/scanner-tickers — the same universe the ΔGEX Board runs over."],
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
