// Owner "ΔGEX Board" — which strikes had dealer gamma built or taken off at
// yesterday's close, across the whole scanner watchlist.
//
// SHAPE: master–detail. A ranked rail on the left, one permanent full-size
// ladder on the right. Nothing is hidden behind a click — ↑/↓ walks the rail
// and repaints the ladder, so a daily pass over 169 names is a few seconds of
// arrowing rather than 169 navigations.
//
// DATA — two routes, both server-differenced. Nothing on this page subtracts
// one GEX number from another:
//   GET /api/eod-strike-gex-board?top=5   one call, the whole rail (net Δ +
//                                         top strikes per symbol, ranked)
//   GET /api/eod-strike-gex-change?symbol one call per name you actually open
// Written by server-v2/eod-strike-gex-recorder.js at 16:05 ET into
// eod_strike_gex. Each symbol is diffed against ITS OWN two most recent
// snapshot dates, so a name that missed a sweep compares against the last
// session it actually has instead of reading as flat.
//
// COLOUR: green/red alone fails deuteranope separation (ΔE 7.4), so the sign is
// ALSO carried by which side of the centre rail a bar sits on and by an
// explicit +/− on every value. Do not "simplify" this to colour-only bars.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle, homeSecondaryButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";

const T = HOME_THEME;
// The app's GEX polarity pair, matching the Ticker Lookup ladder on the
// customer side. Deliberately not the owner status palette — a trader reads
// +GEX green / −GEX red everywhere else in this app.
const POS = "#22C55E";
const NEG = "#EF4444";
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── payload shapes ──────────────────────────────────────────────────────────
type BoardStrike = { strike: number; chg: number };
type BoardSymbol = {
  symbol: string;
  date: string | null;
  prevDate: string | null;
  spot: number | null;
  net: number;
  absTot: number;
  strikes: BoardStrike[];
};
type BoardResp = { ok?: boolean; top?: number; symbols?: BoardSymbol[]; error?: string };

type ChangeRow = { strike: number; netGex: number; prevNetGex: number; chg: number; hadPrev: boolean };
type ChangeResp = {
  ok?: boolean; symbol?: string; date?: string | null; prevDate?: string | null;
  spot?: number | null; prevSpot?: number | null; rows?: ChangeRow[]; error?: string;
};

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

function Ladder({ rows, spot }: { rows: ChangeRow[]; spot: number | null }) {
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.chg)), 0) || 1;
  // The rung price is actually sitting on — marked, not sorted to the middle.
  const spotStrike = spot == null || !rows.length
    ? null
    : rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), rows[0]).strike;
  const desc = [...rows].sort((a, b) => b.strike - a.strike);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: LADDER_COLS, gap: 8, alignItems: "center", paddingBottom: 5 }}>
        <span style={label}>Strike</span>
        <span style={{ ...label, textAlign: "center" }}>← removed · added →</span>
        <span style={{ ...label, textAlign: "right" }}>Δ 1D</span>
      </div>
      {desc.map((r) => {
        const pos = r.chg >= 0;
        const pct = Math.max(2, (Math.abs(r.chg) / max) * 100);
        const isSpot = spotStrike != null && r.strike === spotStrike;
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
            <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
              <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                {!pos && <span style={{ width: `${pct}%`, height: 12, borderRadius: "4px 0 0 4px", background: NEG }} />}
              </span>
              <span style={{ width: 1, height: 17, background: T.border, flexShrink: 0, margin: "0 2px" }} />
              <span style={{ flex: 1, display: "flex" }}>
                {pos && <span style={{ width: `${pct}%`, height: 12, borderRadius: "0 4px 4px 0", background: POS }} />}
              </span>
            </span>
            <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: col(r.chg) }}>
              {sgn(r.chg)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
const TOP_N = 5;
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

  const [detail, setDetail] = useState<ChangeResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Monotonic token — clicking down the rail faster than the network answers
  // must not let an earlier name's ladder land under a later name's header.
  const detailReq = useRef(0);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/eod-strike-gex-board?top=${TOP_N}`, { cache: "no-store" });
      const json: BoardResp = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setBoard(json.symbols ?? []);
      setBoardErr(null);
    } catch (e) {
      setBoardErr(String((e as Error)?.message || e));
    }
  }, []);

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
      const res = await fetch(`/api/eod-strike-gex-change?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const json: ChangeResp = await res.json();
      if (detailReq.current !== mine) return;
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail(json);
    } catch (e) {
      if (detailReq.current === mine) { setDetail(null); setDetailErr(String((e as Error)?.message || e)); }
    } finally {
      if (detailReq.current === mine) setDetailLoading(false);
    }
  }, []);

  // Rail order + filter. Ranking is done server-side by |absTot|; re-sorting
  // here by signed net is a VIEW of the same numbers, never a re-diff.
  const rail = useMemo(() => {
    const q = filter.trim().toUpperCase();
    let list = (board ?? []).filter((s) => !q || s.symbol.includes(q));
    if (dir === "built") list = [...list].sort((a, b) => b.net - a.net);
    else if (dir === "pulled") list = [...list].sort((a, b) => a.net - b.net);
    return list;
  }, [board, filter, dir]);

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

  const maxAbs = rail.reduce((m, s) => Math.max(m, Math.abs(s.absTot)), 0) || 1;
  const selRow = rail.find((s) => s.symbol === sel) ?? null;
  const withBaseline = (board ?? []).filter((s) => s.prevDate).length;

  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="ΔGEX Board"
        subtitle="Per-strike dealer gamma built or taken off at the close — whole board ex-0DTE, scanner watchlist. Recorded 16:05 ET."
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
          {([["abs", "Biggest move"], ["built", "Most built"], ["pulled", "Most pulled"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setDir(k)} style={dir === k ? homeButtonStyle : homeSecondaryButtonStyle}>
              {lbl}
            </button>
          ))}
          <button onClick={loadBoard} style={homeSecondaryButtonStyle} title="Re-read the recorded board">↻</button>
          <span style={{ ...label, marginLeft: "auto" }}>
            {board == null
              ? "loading…"
              : `${rail.length} symbol${rail.length === 1 ? "" : "s"} · ${withBaseline} with a baseline`}
          </span>
        </div>

        {boardErr ? (
          <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Board failed: {boardErr}</div>
        ) : board != null && board.length === 0 ? (
          <div style={{ color: T.text, opacity: 0.6, fontSize: 13 }}>
            No end-of-day snapshots recorded yet. The first sweep runs at 16:05 ET;
            the Δ column needs a second session before it can say anything.
          </div>
        ) : (
          <div className="gexgrowth-split" style={{ display: "grid", gridTemplateColumns: "268px 1fr", gap: 14, alignItems: "start" }}>

            {/* ── rail ───────────────────────────────────────────────── */}
            <div
              tabIndex={0}
              onKeyDown={onRailKey}
              aria-label="Symbols ranked by absolute ΔGEX"
              style={{
                border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
                maxHeight: 620, overflowY: "auto", outline: "none",
              }}
            >
              {rail.map((s) => {
                const on = s.symbol === sel;
                return (
                  <div
                    key={s.symbol}
                    onClick={() => pick(s.symbol)}
                    title={s.prevDate ? `${s.symbol} · ${s.date} vs ${s.prevDate}` : `${s.symbol} · one snapshot only (${s.date}) — no baseline yet`}
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
                      {/* Magnitude bar — |absTot|, so a name that churned hard
                          both ways still reads as busy even when its net is ~0. */}
                      <span style={{
                        height: 5, borderRadius: 3, background: LIGHT_BLUE, flexShrink: 0,
                        width: Math.max(6, (Math.abs(s.absTot) / maxAbs) * 84),
                        opacity: s.prevDate ? 1 : 0.25,
                      }} />
                    </span>
                    <span style={{ ...oneLine, textAlign: "right", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: s.prevDate ? col(s.net) : T.textMuted, opacity: s.prevDate ? 1 : 0.45 }}>
                      {s.prevDate ? sgn(s.net) : "—"}
                    </span>
                  </div>
                );
              })}
              {rail.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: T.text, opacity: 0.5 }}>No symbol matches that filter.</div>
              )}
            </div>

            {/* ── detail ─────────────────────────────────────────────── */}
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, background: T.panelBg, minWidth: 0 }}>
              {sel == null ? (
                <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a symbol.</div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{sel}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: T.text, opacity: 0.6 }}>
                      {detail?.spot != null ? `spot ${detail.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
                      {detail?.prevDate ? ` · ${detail.date} vs close ${detail.prevDate}` : detail?.date ? ` · ${detail.date} · no baseline yet` : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0 6px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color: selRow ? col(selRow.net) : T.text }}>
                      {selRow?.prevDate ? sgn(selRow.net) : "—"}
                    </span>
                    <span style={label}>net Δ 1D</span>
                    {selRow?.strikes?.length ? (
                      <span style={{ ...label, marginLeft: 10 }}>
                        biggest {selRow.strikes[0].strike} · {sgn(selRow.strikes[0].chg)}
                      </span>
                    ) : null}
                  </div>

                  {/* Top-N strip — the same five the rail ranked on, so the
                      list and the chart can't tell different stories. */}
                  {selRow?.strikes?.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
                      {selRow.strikes.map((k) => (
                        <span key={k.strike} style={{
                          display: "flex", alignItems: "baseline", gap: 6,
                          border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 10px",
                          fontFamily: MONO, fontSize: 11.5,
                        }}>
                          <span style={{ opacity: 0.65 }}>{k.strike}</span>
                          <span style={{ fontWeight: 700, color: col(k.chg) }}>{sgn(k.chg)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {detailErr ? (
                    <div style={{ color: NEG, fontSize: 13, fontFamily: MONO }}>Ladder failed: {detailErr}</div>
                  ) : detailLoading && !detail ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>Reading ladder…</div>
                  ) : detail && detail.date && !detail.prevDate ? (
                    // Checked BEFORE the empty-rows case: a symbol on its first
                    // session has rows but no baseline, and "no recorded
                    // strikes" would be the wrong answer to why it looks blank.
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      One snapshot on file ({detail.date}). The Δ needs a second session — it lands after the next 16:05 ET sweep.
                    </div>
                  ) : !detail?.rows?.length ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>No recorded strikes for {sel}.</div>
                  ) : (
                    // Same cap as the rail, so the two panes stay side by side
                    // instead of the page growing to 81 rows tall next to a
                    // short list — master–detail only works if both are onscreen.
                    <div style={{
                      opacity: detailLoading ? 0.55 : 1, transition: "opacity .12s",
                      maxHeight: 560, overflowY: "auto", paddingRight: 4,
                    }}>
                      <Ladder rows={detail.rows} spot={detail.spot ?? null} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ ...label, marginTop: 12, opacity: 0.35 }}>
          OI+Vol basis · whole board excl. 0DTE · ±40 strikes around the close ·
          each symbol diffed against its own two most recent snapshots
        </div>
      </Card>

      <style>{`
        @media (max-width: 860px) {
          .gexgrowth-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </PageShell>
  );
}
