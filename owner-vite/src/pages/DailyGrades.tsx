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
// TEMPLATE. The layout, derivations and states are final; the DATA is not.
// Everything on screen comes from one `DgPayload` (see lib/dailyGrades.ts), and
// the only thing that changes when TT / dxLink lands is `loadGrades()` in that
// file — this component never fetches a board itself. Until then it falls back
// to the sealed 2026-08-25 sample and the header says which source is on
// screen. Paste-JSON is the manual path in the meantime.
//
// Colours come from lib/theme (OWNER_THEME) — no hardcoded hex.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell, Card } from "../components/PageCard";
import {
  OWNER_THEME as T,
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
} from "../lib/dailyGrades";

const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

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
        background: ownerRgba(accent, 0.13),
        border: `1px solid ${ownerRgba(accent, 0.32)}`,
        color: accent,
      }}
    >
      {children}
    </span>
  );
}

function Tile({ value, label, accent }: { value: number | string; label: string; accent: string }) {
  return (
    <div
      style={{
        background: T.panelInset,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: "12px 14px",
      }}
    >
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
          color: ownerRgba(T.text, 0.55),
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Where spot sits inside the floor→cap band. White tick = spot, gold line = flip. */
function BandBar({ row }: { row: DgRow }) {
  if (row.pos == null) {
    return <div style={{ height: 8, borderRadius: 4, background: ownerRgba(T.text, 0.05) }} />;
  }
  const p = Math.max(0, Math.min(1, row.pos)) * 100;
  const fp = row.flipPos != null && row.flipPos >= 0 && row.flipPos <= 1 ? row.flipPos * 100 : null;
  return (
    <div
      title={`floor ${fmtPrice(row.floor)} → cap ${fmtPrice(row.cap)}`}
      style={{ position: "relative", height: 8, borderRadius: 4, background: ownerRgba(T.text, 0.07) }}
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
            background: T.gold, opacity: 0.9, transform: "translateX(-1px)",
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

  // The roster. Same universe the ΔGEX Board runs over.
  const { tickers, loading: rosterLoading, live: rosterLive } = useTickerUniverse();

  const [showOffRoster, setShowOffRoster] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sortKey, setSortKey] = useState<SortKey>("ticker");
  const [sortAsc, setSortAsc] = useState(true);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { payload: p, source: s } = await loadGrades();
      setPayload(p);
      setSource(s);
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

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(k === "ticker"); }
  };

  const sourceAccent = source === "live" ? T.green : source === "import" ? T.cyan : T.gold;
  const sourceLabel =
    source === "live" ? "Live" : source === "import" ? "Imported" : "Sample board";

  // ── table styles ───────────────────────────────────────────────────────────
  const th = (k?: SortKey, align: "left" | "right" = "right"): React.CSSProperties => ({
    position: "sticky",
    top: 0,
    zIndex: 1,
    background: T.panelBgStrong,
    padding: "10px 10px",
    textAlign: align,
    fontSize: TYPE.micro,
    fontWeight: 800,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    color: k === sortKey ? T.cyan : ownerRgba(T.text, 0.55),
    borderBottom: `1px solid ${T.border}`,
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
  };
  const caret = (k: SortKey) => (k === sortKey ? (sortAsc ? " ↑" : " ↓") : "");

  const deltaCell = (v: number | null) => (
    <td
      style={{
        ...td,
        color: v == null ? ownerRgba(T.text, 0.28) : v > 0 ? T.green : v < 0 ? T.red : T.text,
        fontWeight: v != null && Math.abs(v) <= NEAR_PCT ? 800 : 500,
      }}
    >
      {fmtPct(v)}
    </td>
  );
  const priceCell = (v: number | null, strong = false) => (
    <td style={{ ...td, color: v == null ? ownerRgba(T.text, 0.28) : T.text, fontWeight: strong ? 800 : 500 }}>
      {fmtPrice(v)}
    </td>
  );

  return (
    <PageShell>
      {/* ── header ───────────────────────────────────────────────────────── */}
      <Card variant="classic" padding={20}>
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
            <div style={{ marginTop: 6, fontSize: TYPE.label, color: ownerRgba(T.text, 0.6) }}>
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
              marginTop: 14, padding: "10px 13px",
              borderRadius: 10,
              border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${T.purple}`,
              background: T.panelInset,
              fontSize: TYPE.label,
              color: ownerRgba(T.text, 0.75),
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
              style={{ ...homeInputStyle, minHeight: 130, fontFamily: MONO, fontSize: 12, resize: "vertical" }}
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

      {/* ── summary tiles ────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 10 }}>
        <Tile value={stats.total} label="on watchlist" accent={T.text} />
        <Tile value={stats.graded} label="graded" accent={T.cyan} />
        <Tile value={stats.ungraded} label="not graded" accent={T.purple} />
        <Tile value={stats.above} label="above flip" accent={T.green} />
        <Tile value={stats.below} label="below flip" accent={T.red} />
        <Tile value={stats.near} label={`within ${NEAR_PCT}% of a level`} accent={T.gold} />
        <Tile value={stats.breach} label="outside floor/cap" accent={T.orange} />
      </div>

      {/* ── board ────────────────────────────────────────────────────────── */}
      <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 14, borderBottom: `1px solid ${T.border}` }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter ticker…"
            style={{ ...homeInputStyle, minWidth: 200, fontSize: TYPE.body }}
          />
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  padding: "7px 13px",
                  borderRadius: 999,
                  border: `1px solid ${on ? T.cyan : T.border}`,
                  background: on ? ownerRgba(T.cyan, 0.16) : "rgba(255,255,255,0.03)",
                  color: on ? T.cyan : ownerRgba(T.text, 0.7),
                  fontSize: TYPE.label,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {f.label}
              </button>
            );
          })}
          {offRosterCount > 0 && (
            <button
              onClick={() => setShowOffRoster((v) => !v)}
              title="Graded names the watchlist doesn't carry"
              style={{
                padding: "7px 13px",
                borderRadius: 999,
                border: `1px solid ${showOffRoster ? T.lightBlue : T.border}`,
                background: showOffRoster ? ownerRgba(T.lightBlue, 0.16) : "rgba(255,255,255,0.03)",
                color: showOffRoster ? T.lightBlue : ownerRgba(T.text, 0.7),
                fontSize: TYPE.label,
                fontWeight: 800,
                letterSpacing: "0.04em",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              +{offRosterCount} off roster
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: TYPE.label, color: ownerRgba(T.text, 0.45), fontFamily: MONO }}>
            {visible.length} / {rows.length}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1060, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th("ticker", "left")} onClick={() => toggleSort("ticker")}>Ticker{caret("ticker")}</th>
                <th style={th("spot")} onClick={() => toggleSort("spot")}>Spot{caret("spot")}</th>
                <th style={th("floor")} onClick={() => toggleSort("floor")}>Floor{caret("floor")}</th>
                <th style={th("dFloor")} onClick={() => toggleSort("dFloor")}>Δ{caret("dFloor")}</th>
                <th style={th("apex")} onClick={() => toggleSort("apex")}>Apex{caret("apex")}</th>
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
                  style={{
                    borderBottom: `1px solid ${ownerRgba(T.text, 0.05)}`,
                    opacity: r.ungraded ? 0.55 : 1,
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
                      <Pill accent={r.regime === "above" ? T.green : r.regime === "below" ? T.red : ownerRgba(T.text, 0.4)}>
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
                  <td colSpan={11} style={{ ...td, textAlign: "center", padding: 34, color: ownerRgba(T.text, 0.45) }}>
                    {loading || rosterLoading ? "Loading board…" : "Nothing matches that filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── legend ───────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {[
          ["Roster", "The scanner watchlist from /proxy/scanner-tickers — the same universe the ΔGEX Board runs over."],
          ["Floor / Cap", "Lower and upper level on the board — support / put wall and resistance / call wall."],
          ["Apex", "The single biggest level on the board."],
          ["Flip", "Gamma flip. Spot above it is the calmer regime; below it, the chop."],
          ["Δ columns", `How far spot has to travel to reach that level. Positive = the level is above spot; bold = inside ${NEAR_PCT}%.`],
          ["Floor → Cap", "Where spot sits in the band. White tick = spot, gold line = flip."],
        ].map(([k, v]) => (
          <div
            key={k}
            style={{ background: T.panelInset, border: `1px solid ${T.border}`, borderRadius: 12, padding: "11px 14px" }}
          >
            <div style={{ fontSize: TYPE.label, fontWeight: 800, marginBottom: 3 }}>{k}</div>
            <div style={{ fontSize: TYPE.label, color: ownerRgba(T.text, 0.6) }}>{v}</div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
