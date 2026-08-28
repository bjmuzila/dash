import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { ThemedSelect } from "../components/ThemedSelect";

/**
 * /owner/labs — the GEX SURFACE.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The ΔGEX Board answers "what changed between two closes". This page answers
 * the question that one structurally cannot: "where is dealer positioning
 * BUILDING, over time, and is it building or is it just following price".
 *
 * Those two are the same picture in a ladder and completely different pictures
 * here, which is the entire reason the page exists. A wall that thickens at a
 * fixed strike while spot wanders is positioning being ADDED. A wall that keeps
 * its distance from spot as spot moves is positioning FOLLOWING. The ladder
 * cannot tell them apart because it has no time axis and no price on it. The
 * surface has both.
 *
 * ── THE TWO VIEWS, AND WHY BOTH ─────────────────────────────────────────────
 * SURFACE — strike up the side, sessions across, colour is the level, and spot
 *   drawn straight over the top. No occlusion, so it takes 45 sessions as
 *   easily as 7, and the shape you are looking for (a band that WIDENS toward
 *   the right edge) is a shape, not a number to read. This is the glance view.
 * SCRUB — one profile at full size with a slider through the same sessions and
 *   the previous five drawn as fading ghosts. The surface tells you something
 *   happened; this is where you go to watch it happen and find the session it
 *   started. Needs your hand on it, which is why it is second.
 *
 * Both read ONE payload — GET /api/eod-strike-gex-surface — so they can never
 * disagree, and switching between them costs nothing.
 *
 * ── WHY A DEDICATED ENDPOINT ────────────────────────────────────────────────
 * The obvious build is to call /api/eod-strike-gex-change once per session in
 * the window. That is 45 round trips for one symbol, and it makes each view
 * rebuild the strike × session rectangle itself — which is exactly how two
 * views of "the same" data end up drawing different pictures. The rectangle is
 * built once, server-side, in getStrikeGexSurface().
 *
 * ── NULL IS NOT ZERO ────────────────────────────────────────────────────────
 * The recorder writes ±40 strikes around each session's close, so over a long
 * window the far strikes genuinely have no reading on the sessions where spot
 * was somewhere else. Those come back as null and are drawn as EMPTY, not as
 * the neutral middle of the scale. Painting them as zero would draw a hard edge
 * across the surface that is an artefact of the recording window rather than a
 * fact about the book, and it would be the most confident-looking wrong thing
 * on the page.
 */

const T = HOME_THEME;
// Same two literals GexGrowth.tsx defines, for the same reason: OWNER_THEME has
// no true green (`green` is the light blue), and a gamma sign that reads green
// on one page and blue on the next is worse than one shared local constant.
// If a real +/− pair ever lands in the theme, both pages take it from there.
const POS = "#22C55E";
const NEG = "#EF4444";
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INK = "#E6EDF5";
const DIM = "rgba(255,255,255,0.42)";
const GRIDLINE = "rgba(255,255,255,0.07)";
const CELL_EMPTY = "rgba(255,255,255,0.025)";

type Surface = {
  ok?: boolean;
  error?: string;
  symbol?: string;
  basis?: string;
  leg?: string;
  dates?: string[];
  spots?: (number | null)[];
  strikes?: number[];
  grid?: (number | null)[][];
  window?: { lo: number; hi: number } | null;
  capturedAt?: string | null;
  clipped?: boolean;
};

const SYMBOLS = ["SPX", "SPY", "QQQ", "NDX", "IWM", "NVDA", "TSLA", "AAPL", "META", "AMZN"];
const BASES = [
  { value: "oivol", label: "OI + Volume" },
  { value: "oi", label: "OI only" },
  { value: "vol", label: "Volume only" },
  { value: "flow", label: "Flow (signed)" },
];
const WINDOWS = [
  { value: "20", label: "20 sessions" },
  { value: "45", label: "45 sessions" },
  { value: "90", label: "90 sessions" },
];
// How far either side of the price path to draw, as a PERCENTAGE of spot — the
// only unit that means the same thing on SPY at 770 and SPX at 7700.
const WIDTHS = [
  { value: "2", label: "±2% strikes" },
  { value: "5", label: "±5% strikes" },
  { value: "10", label: "±10% strikes" },
  { value: "20", label: "±20% strikes" },
];

/* ── colour ──────────────────────────────────────────────────────────────── */

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
const NEUTRAL = [26, 32, 41];
function mixTo(hex: string, t: number) {
  const c = rgbOf(hex);
  return `rgb(${NEUTRAL.map((v, i) => Math.round(v + (c[i] - v) * t)).join(",")})`;
}
/**
 * Diverging: two hues, a neutral midpoint, and a dead zone so a 2% deviation
 * does not shout as loudly as a 200% one. Never a rainbow, and zero is grey
 * rather than green — a strike with no gamma is not a bullish strike.
 */
function divColor(v: number | null, max: number): string {
  if (v == null || !Number.isFinite(v)) return CELL_EMPTY;
  const t = max > 0 ? Math.min(1, Math.abs(v) / max) : 0;
  if (t < 0.05) return `rgb(${NEUTRAL.join(",")})`;
  const u = (t - 0.05) / 0.95;
  return mixTo(v > 0 ? POS : NEG, 0.1 + 0.9 * Math.pow(u, 0.85));
}

const fmtB = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
};
const shortDate = (d: string) => {
  const p = d.split("-");
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : d;
};
const fmtEtStamp = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(d).replace(", ", " ")} ET`;
};

/* ── page ────────────────────────────────────────────────────────────────── */

export default function GexSurface() {
  const [symbol, setSymbol] = useState("SPY");
  const [basis, setBasis] = useState("oivol");
  const [days, setDays] = useState("45");
  const [sidePct, setSidePct] = useState("5");
  const [data, setData] = useState<Surface | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(
        `/api/eod-strike-gex-surface?symbol=${encodeURIComponent(symbol)}`
        + `&days=${days}&basis=${basis}&sidePct=${sidePct}`,
        { cache: "no-store" },
      );
      const j: Surface = await res.json();
      // Stale-response guard: the symbol picker can fire faster than the query
      // returns, and an out-of-order resolve would paint the wrong name's book
      // under the right name's header.
      if (id !== reqId.current) return;
      if (!res.ok || j.ok === false) { setErr(j.error || `HTTP ${res.status}`); setData(null); }
      else { setData(j); }
    } catch (e) {
      if (id !== reqId.current) return;
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [symbol, basis, days, sidePct]);

  useEffect(() => { void load(); }, [load]);

  const dates = data?.dates ?? [];
  const strikes = data?.strikes ?? [];
  const grid = data?.grid ?? [];
  const spots = data?.spots ?? [];
  const ready = dates.length > 1 && strikes.length > 1;

  /** Δ vs the prior session. Derived, never fetched — one source, two readings. */
  const dgrid = useMemo(() => grid.map((row, d) => row.map((v, i) => {
    if (d === 0) return null;
    const p = grid[d - 1][i];
    return v == null || p == null ? null : v - p;
  })), [grid]);

  const vmax = useMemo(() => {
    let m = 0;
    for (const row of grid) for (const v of row) if (v != null && Math.abs(v) > m) m = Math.abs(v);
    return m;
  }, [grid]);
  const dmax = useMemo(() => {
    let m = 0;
    for (const row of dgrid) for (const v of row) if (v != null && Math.abs(v) > m) m = Math.abs(v);
    return m;
  }, [dgrid]);

  const [scrub, setScrub] = useState(0);
  useEffect(() => { setScrub(Math.max(0, dates.length - 1)); }, [dates.length]);

  return (
    <PageShell>
      <Card
        variant="classic"
        title="GEX Surface · labs"
        subtitle="Where positioning is building, over time — and whether it is building or following price"
        padding={20}
      >
        <p style={{ margin: "0 0 16px", fontSize: 13, color: T.text, opacity: 0.72, maxWidth: "92ch", lineHeight: 1.6 }}>
          One payload, two views. The ΔGEX Board diffs two closes; this draws every strike against every
          session with spot on top. A band that <b>widens</b> toward the right edge is positioning being added.
          A band that <b>holds its distance</b> from the price line as price moves is positioning following.
          Those look identical on a ladder.
        </p>

        <Controls
          symbol={symbol} setSymbol={setSymbol}
          basis={basis} setBasis={setBasis}
          days={days} setDays={setDays}
          sidePct={sidePct} setSidePct={setSidePct}
          onReload={load} loading={loading}
        />

        {err ? (
          <div style={{ ...noteStyle, borderLeftColor: NEG, color: NEG }}>
            Could not read the surface: {err}
          </div>
        ) : null}

        {!err && !loading && data && !ready ? (
          <div style={noteStyle}>
            {dates.length === 0
              ? `No recorded sessions for ${symbol} on the ${BASES.find((b) => b.value === basis)?.label} basis. `
                + "The bases start at their own migration dates — try OI + Volume, which has the full history."
              : "Only one session on file for this reading. A surface needs at least two."}
          </div>
        ) : null}

        {ready ? (
          <>
            <Meta data={data} loading={loading} />
            <SectionLabel
              n="A" title="The surface"
              sub={`strike × session · colour is the level · ${dates.length} sessions`}
            />
            <SurfaceChart
              dates={dates} strikes={strikes} grid={grid} spots={spots} max={vmax} withSpot
            />
            <SectionLabel n="" title="Δ vs prior session" sub="same axes" small />
            {/* The oldest session has no prior, so its column is all null. Dropped
                rather than drawn: an empty leading column reads as "nothing
                happened that day", which is not what it means. */}
            <SurfaceChart
              dates={dates.slice(1)} strikes={strikes} grid={dgrid.slice(1)}
              spots={spots.slice(1)} max={dmax} withSpot
            />
            <Legend max={vmax} />

            <SectionLabel
              n="D" title="Scrub"
              sub="one profile, a slider, and the trail behind it"
            />
            <Scrub
              dates={dates} strikes={strikes} grid={grid} spots={spots} max={vmax}
              idx={Math.min(scrub, dates.length - 1)} setIdx={setScrub}
            />
          </>
        ) : null}

        {loading && !ready ? (
          <div style={{ ...noteStyle, color: T.text, opacity: 0.6 }}>Reading {symbol}…</div>
        ) : null}
      </Card>
    </PageShell>
  );
}

/* ── chrome ──────────────────────────────────────────────────────────────── */

const noteStyle: CSSProperties = {
  borderLeft: `2px solid ${T.cyan}`,
  background: "rgba(33,158,188,0.06)",
  padding: "11px 14px",
  borderRadius: "0 8px 8px 0",
  fontSize: 12.5,
  color: T.text,
  margin: "14px 0 0",
  lineHeight: 1.55,
};

function Controls({
  symbol, setSymbol, basis, setBasis, days, setDays, sidePct, setSidePct, onReload, loading,
}: {
  symbol: string; setSymbol: (v: string) => void;
  basis: string; setBasis: (v: string) => void;
  days: string; setDays: (v: string) => void;
  sidePct: string; setSidePct: (v: string) => void;
  onReload: () => void; loading: boolean;
}) {
  const [typed, setTyped] = useState(symbol);
  useEffect(() => { setTyped(symbol); }, [symbol]);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
      <div style={{ width: 150 }}>
        <ThemedSelect
          value={SYMBOLS.includes(symbol) ? symbol : ""}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
          onChange={setSymbol}
          ariaLabel="Symbol"
          placeholder={symbol || "symbol"}
        />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); const v = typed.trim().toUpperCase(); if (v) setSymbol(v); }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Any symbol"
          placeholder="any ticker"
          style={{
            width: 108, background: T.panelInset, color: T.text, fontFamily: MONO, fontSize: 12,
            border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 10px", textTransform: "uppercase",
          }}
        />
      </form>
      <div style={{ width: 168 }}>
        <ThemedSelect value={basis} options={BASES} onChange={setBasis} ariaLabel="Basis" />
      </div>
      <div style={{ width: 148 }}>
        <ThemedSelect value={days} options={WINDOWS} onChange={setDays} ariaLabel="Lookback" />
      </div>
      <div style={{ width: 152 }}>
        <ThemedSelect value={sidePct} options={WIDTHS} onChange={setSidePct} ariaLabel="Strike range" />
      </div>
      <button
        type="button" onClick={onReload} disabled={loading}
        style={{ ...homeButtonStyle, padding: "7px 15px", fontSize: 12, opacity: loading ? 0.5 : 1 }}
      >
        {loading ? "…" : "↻"}
      </button>
    </div>
  );
}

function Meta({ data, loading }: { data: Surface | null; loading: boolean }) {
  if (!data) return null;
  const n = data.dates?.length ?? 0;
  return (
    <div style={{
      display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center",
      fontFamily: MONO, fontSize: 10.5, color: DIM, marginTop: 14,
    }}>
      <span style={{ color: T.cyan }}>{data.symbol}</span>
      <span>{n} sessions · {data.dates?.[0]} → {data.dates?.[n - 1]}</span>
      <span>
        {data.strikes?.length} strikes
        {data.window ? ` · ${Math.round(data.window.lo)}–${Math.round(data.window.hi)}` : ""}
      </span>
      {data.capturedAt ? <span>run {fmtEtStamp(data.capturedAt)}</span> : null}
      {data.clipped ? (
        <span
          title="The union of every session's recorded window is wider than what is drawn. The grid is clipped to the strikes around the latest close — the ones you are actually looking at."
          style={{ color: T.gold }}
        >
          clipped to the live window
        </span>
      ) : null}
      {loading ? <span style={{ color: T.cyan }}>reloading…</span> : null}
    </div>
  );
}

function SectionLabel({ n, title, sub, small }: { n: string; title: string; sub?: string; small?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap",
      margin: small ? "18px 0 7px" : "26px 0 10px",
      paddingTop: small ? 12 : 0,
      borderTop: small ? `1px dashed ${T.border}` : undefined,
    }}>
      {n ? (
        <span style={{
          fontFamily: MONO, fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
          color: T.bg, background: T.cyan, borderRadius: 5, padding: "2px 7px",
        }}>{n}</span>
      ) : null}
      <span style={{ fontSize: small ? 12 : 15, fontWeight: 700, color: T.text }}>{title}</span>
      {sub ? (
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: DIM }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function Legend({ max }: { max: number }) {
  const steps = Array.from({ length: 21 }, (_, i) => ((i - 10) / 10) * max);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12,
      fontFamily: MONO, fontSize: 9.5, color: DIM, letterSpacing: ".04em",
    }}>
      <span>short γ</span>
      <span style={{ display: "flex", width: 170, height: 9, borderRadius: 3, overflow: "hidden" }}>
        {steps.map((v, i) => <i key={i} style={{ flex: 1, background: divColor(v, max) }} />)}
      </span>
      <span>long γ</span>
      <span><i style={{ display: "inline-block", width: 10, height: 2, background: INK, verticalAlign: 3, marginRight: 5 }} />spot</span>
      <span><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: CELL_EMPTY, border: `1px solid ${T.border}`, verticalAlign: -1, marginRight: 5 }} />not recorded — never drawn as zero</span>
      <span>hover any cell for the number</span>
    </div>
  );
}

/* ── A · the surface ─────────────────────────────────────────────────────── */

function SurfaceChart({
  dates, strikes, grid, spots, max, withSpot,
}: {
  dates: string[]; strikes: number[]; grid: (number | null)[][];
  spots: (number | null)[]; max: number; withSpot?: boolean;
}) {
  const CH = strikes.length > 70 ? 7 : strikes.length > 45 ? 9 : 12;
  const W = 1000, L = 46, R = 16, TP = 10, BM = 26;
  const H = strikes.length * CH + TP + BM;
  const cw = (W - L - R) / dates.length;
  const x = (d: number) => L + d * cw;
  // Strikes ascending in the payload; the surface reads high-at-top, so the row
  // index is inverted here rather than the array being reversed — the grid's
  // column order has to stay aligned with `strikes` for the tooltips.
  const y = (i: number) => TP + (strikes.length - 1 - i) * CH;

  // Spot is mapped onto the STRIKE axis and then CLAMPED to the plot box.
  //
  // The server sizes the window off the spot path so this should not bite, but
  // "should not" is not a guarantee: the 240-row ceiling can tighten the window
  // past an old session's close, and a symbol whose ladder is finer than its
  // range will hit that. An unclamped point becomes a line running off the top
  // or bottom of the chart into the margin — which is exactly how this looked
  // on SPX with a fixed ±45-point window. Clamped, an out-of-frame session
  // pins to the edge and is flagged below the chart instead.
  const loK = strikes[0], hiK = strikes[strikes.length - 1];
  const yTop = TP + CH / 2;
  const yBot = TP + (strikes.length - 1) * CH + CH / 2;
  const yPrice = (p: number) => {
    if (hiK === loK) return yTop;
    return TP + (hiK - p) * ((strikes.length - 1) * CH) / (hiK - loK) + CH / 2;
  };
  const clampY = (v: number) => Math.min(yBot, Math.max(yTop, v));
  const offFrame = spots.filter((p) => p != null && (p < loK || p > hiK)).length;
  const spotPts = spots
    .map((p, d) => (p == null ? null : `${(x(d) + cw / 2).toFixed(1)},${clampY(yPrice(p)).toFixed(1)}`))
    .filter(Boolean).join(" ");

  const strikeTicks = useMemo(() => {
    const span = strikes[strikes.length - 1] - strikes[0];
    const step = span > 120 ? 20 : span > 60 ? 10 : span > 24 ? 5 : 2;
    return strikes.map((s, i) => ({ s, i })).filter(({ s }) => s % step === 0);
  }, [strikes]);
  const dateStep = Math.max(1, Math.ceil(dates.length / 9));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, height: "auto", display: "block", fontFamily: MONO }}>
        {grid.map((row, d) => row.map((v, i) => (
          <rect
            key={`${d}-${i}`}
            x={x(d).toFixed(2)} y={y(i)} width={(cw + 0.6).toFixed(2)} height={CH}
            fill={divColor(v, max)}
          >
            <title>{`${strikes[i]} · ${dates[d]}\n${fmtB(v)}${v == null ? " (not recorded this session)" : ""}`}</title>
          </rect>
        )))}

        {withSpot && spotPts ? (
          <>
            {/* Drawn twice: a dark casing under a light line, so the price stays
                legible over both the green and the red side of the surface. */}
            <polyline points={spotPts} fill="none" stroke="#05070B" strokeWidth={3.4} strokeLinejoin="round" />
            <polyline points={spotPts} fill="none" stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />
          </>
        ) : null}

        {strikeTicks.map(({ s, i }) => (
          <text key={s} x={L - 7} y={y(i) + CH / 2 + 3.5} fill={DIM} fontSize={9} textAnchor="end">{s}</text>
        ))}
        {dates.map((d, i) => (
          i % dateStep === 0 && i < dates.length - 2 ? (
            <text key={d} x={(x(i) + cw / 2).toFixed(1)} y={H - 9} fill={DIM} fontSize={9} textAnchor="middle">
              {shortDate(d)}
            </text>
          ) : null
        ))}
        <text x={W - R} y={H - 9} fill={T.cyan} fontSize={9} textAnchor="end">
          {shortDate(dates[dates.length - 1])}
        </text>
      </svg>
      {withSpot && offFrame > 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.gold, marginTop: 4 }}>
          {offFrame} session{offFrame === 1 ? "'s" : "s'"} close sits outside the drawn strike range — the price
          line is pinned to the edge there. Widen the window or shorten the lookback.
        </div>
      ) : null}
    </div>
  );
}

/* ── D · scrub ───────────────────────────────────────────────────────────── */

function Scrub({
  dates, strikes, grid, spots, max, idx, setIdx,
}: {
  dates: string[]; strikes: number[]; grid: (number | null)[][];
  spots: (number | null)[]; max: number; idx: number; setIdx: (n: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) { if (timer.current) { window.clearInterval(timer.current); timer.current = null; } return; }
    let d = idx >= dates.length - 1 ? 0 : idx;
    setIdx(d);
    timer.current = window.setInterval(() => {
      d += 1;
      if (d >= dates.length) { setPlaying(false); setIdx(dates.length - 1); return; }
      setIdx(d);
    }, 140);
    return () => { if (timer.current) { window.clearInterval(timer.current); timer.current = null; } };
    // idx is deliberately not a dep: including it would restart the interval on
    // every tick and the animation would never advance past the first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, dates.length]);

  const W = 1000, L = 52, R = 18, TP = 16, BM = 34, H = 300;
  const BASE = TP + (H - TP - BM) * 0.58;
  const AMP = (H - TP - BM) * 0.5;
  const lo = strikes[0], hi = strikes[strikes.length - 1];
  const x = (s: number) => (hi === lo ? L : L + (s - lo) * (W - L - R) / (hi - lo));
  const yv = (v: number) => BASE - (max > 0 ? v / max : 0) * AMP;

  /** One session's profile. Nulls break the path rather than reading as zero. */
  const pathFor = (d: number) => {
    const row = grid[d] || [];
    const out: string[] = [];
    let pen = false;
    row.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      out.push(`${pen ? "L" : "M"}${x(strikes[i]).toFixed(1)} ${yv(v).toFixed(1)}`);
      pen = true;
    });
    return out.join(" ");
  };
  const areaFor = (d: number) => {
    const p = pathFor(d);
    if (!p) return "";
    const first = strikes.find((_, i) => grid[d]?.[i] != null);
    const lastI = [...strikes.keys()].reverse().find((i) => grid[d]?.[i] != null);
    if (first == null || lastI == null) return "";
    return `M${x(first).toFixed(1)} ${BASE} ${p.replace(/^M/, "L")} L${x(strikes[lastI]).toFixed(1)} ${BASE} Z`;
  };

  const row = grid[idx] || [];
  let bi = -1, wi = -1;
  row.forEach((v, i) => {
    if (v == null) return;
    if (bi < 0 || (row[bi] as number) < v) bi = i;
    if (wi < 0 || (row[wi] as number) > v) wi = i;
  });
  const spot = spots[idx];

  const gridLines: number[] = [];
  if (max > 0) { const st = max / 2; for (let g = -max; g <= max + 1e-9; g += st) gridLines.push(g); }

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, height: "auto", display: "block", fontFamily: MONO }}>
          <defs>
            <clipPath id="scrubUp"><rect x={0} y={0} width={W} height={BASE} /></clipPath>
            <clipPath id="scrubDn"><rect x={0} y={BASE} width={W} height={H} /></clipPath>
          </defs>

          {gridLines.map((g) => (
            <g key={g}>
              <line x1={L} y1={yv(g)} x2={W - R} y2={yv(g)} stroke={g === 0 ? "rgba(255,255,255,0.18)" : GRIDLINE} strokeWidth={1} />
              <text x={L - 8} y={yv(g) + 3.5} fill={DIM} fontSize={9} textAnchor="end">{fmtB(g)}</text>
            </g>
          ))}

          {/* GHOSTS — the previous five sessions, fading back. This is the trail:
              you see where the walls were as well as where they are. */}
          {[5, 4, 3, 2, 1].map((k) => {
            const d = idx - k;
            if (d < 0) return null;
            const p = pathFor(d);
            if (!p) return null;
            const op = 0.30 - 0.045 * k;
            return (
              <g key={k}>
                <path d={p} fill="none" stroke={POS} strokeWidth={1.2} opacity={op} clipPath="url(#scrubUp)" strokeLinejoin="round" />
                <path d={p} fill="none" stroke={NEG} strokeWidth={1.2} opacity={op} clipPath="url(#scrubDn)" strokeLinejoin="round" />
              </g>
            );
          })}

          <path d={areaFor(idx)} fill={POS} opacity={0.22} clipPath="url(#scrubUp)" />
          <path d={areaFor(idx)} fill={NEG} opacity={0.22} clipPath="url(#scrubDn)" />
          <path d={pathFor(idx)} fill="none" stroke={POS} strokeWidth={2.2} clipPath="url(#scrubUp)" strokeLinejoin="round" />
          <path d={pathFor(idx)} fill="none" stroke={NEG} strokeWidth={2.2} clipPath="url(#scrubDn)" strokeLinejoin="round" />

          {spot != null ? (
            <>
              <line x1={x(spot)} y1={TP} x2={x(spot)} y2={H - BM} stroke={T.cyan} strokeWidth={1} strokeDasharray="3 4" opacity={0.75} />
              <path d={`M${x(spot) - 4.5} ${H - BM + 9} L${x(spot)} ${H - BM + 2} L${x(spot) + 4.5} ${H - BM + 9} Z`} fill={T.cyan} />
            </>
          ) : null}

          {strikes.filter((s) => s % (hi - lo > 60 ? 10 : hi - lo > 24 ? 5 : 2) === 0).map((s) => (
            <text key={s} x={x(s).toFixed(1)} y={H - 8} fill={DIM} fontSize={9.5} textAnchor="middle">{s}</text>
          ))}
        </svg>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap", fontFamily: MONO, fontSize: 11 }}>
        <button
          type="button" onClick={() => setPlaying((p) => !p)}
          style={{
            background: T.panelInset, border: `1px solid ${T.borderStrong}`, color: T.text,
            borderRadius: 7, padding: "5px 13px", fontFamily: MONO, fontSize: 11, cursor: "pointer",
          }}
        >
          {playing ? "❚❚ pause" : "▶ play"}
        </button>
        <input
          type="range" min={0} max={Math.max(0, dates.length - 1)} value={idx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          aria-label="Session"
          style={{ flex: 1, minWidth: 180, accentColor: T.cyan }}
        />
        <span style={{ color: idx === dates.length - 1 ? T.cyan : T.text, minWidth: 86 }}>
          {dates[idx]}{idx === dates.length - 1 ? " · latest" : ""}
        </span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, marginTop: 6 }}>
        {spot != null ? `spot ${spot.toFixed(2)} · ` : ""}
        {bi >= 0 ? `heaviest long γ ${strikes[bi]} ${fmtB(row[bi])}` : "no long γ recorded"}
        {wi >= 0 ? ` · heaviest short γ ${strikes[wi]} ${fmtB(row[wi])}` : ""}
        {" · ghosts = the previous five sessions"}
      </div>
    </>
  );
}
