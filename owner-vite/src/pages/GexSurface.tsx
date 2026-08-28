import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { HOME_THEME, homeButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { ThemedSelect } from "../components/ThemedSelect";

/**
 * /owner/labs — STRIKE × DAYS, and the levels that walk on top of it.
 *
 * ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 * The ΔGEX Board diffs two closes. It cannot tell "the wall is being BUILT"
 * from "the wall is FOLLOWING price", because it has no time axis and no price
 * on it — and on a ladder those two are the same picture. This page puts both
 * in the frame.
 *
 * ── TWO PANELS, ONE FETCH ───────────────────────────────────────────────────
 * 1. STRIKE × DAYS. Strike up the side, sessions across, price drawn over the
 *    top. Two colour modes off the same numbers:
 *      |GEX|  black → orange → white, sequential. How much gamma sits at a
 *             strike, sign ignored. A band BRIGHTENING left-to-right is the
 *             thing this page exists to catch, and sign only distracts from it.
 *             Unsigned, so a wall and an acceleration zone look identical —
 *             read it beside the signed view, never alone.
 *      NET    green/red diverging, near-black midpoint. Which way each band
 *             pushes.
 * 2. WALL MIGRATION. The levels the grid implies, walked over the same
 *    sessions. Deliberately the SAME DRAWING as WallMigrationChart in
 *    components/pages/LevelLog.tsx, one scale up: that chart's x is 15-minute
 *    slots inside a session, this one's is sessions. Everything else is copied
 *    on purpose so the two surfaces read alike.
 *
 * Both panels read ONE payload — GET /api/eod-strike-gex-surface — and panel 2
 * derives its levels from the same grid panel 1 paints, so they cannot disagree
 * about where a wall was.
 *
 * ── THE RULES PANEL 2 INHERITS FROM LevelLog ────────────────────────────────
 * STEPS, NEVER SLOPES. A wall holds its strike until the book rolls it. A
 * diagonal drawn between two sessions would put the level at prices it never
 * occupied, which is precisely the reading this panel exists for. Spot is the
 * one exception and is drawn as a continuous stroke: price really does move
 * between closes.
 *
 * THE CORE-SIGN RULE, AS TWO ROLES. CORE is the single largest |GEX| node on
 * the board, so it IS one of the walls — drawing the matching wall beside it is
 * the same strike twice in two colours. So: CORE is the heavier wall, OTHER is
 * the lighter one, both lines run the whole window, and when dominance flips
 * the lines swap. OTHER is drawn in the colour of the wall it currently IS, in
 * contiguous same-side runs, so neither colour blinks out mid-run. LevelLog
 * arrived at this after the per-slot masking version made the eye read "a level
 * vanished" instead of "a role swapped"; there is no reason to re-learn it.
 *
 * NULL IS NOT ZERO. The recorder writes ±40 strikes around each session's
 * close, so over a long window the far strikes genuinely have no reading on
 * sessions where spot was elsewhere. Those come back null and draw as EMPTY,
 * not as the middle of the scale — a zero there would paint a hard edge across
 * the surface that is an artefact of the recording window, not a fact about the
 * book, and it would be the most confident-looking wrong thing on the page.
 */

const T = HOME_THEME;
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const DIM = "rgba(255,255,255,0.42)";
const FAINT = "rgba(255,255,255,0.055)";
/**
 * The level palette is LEVEL_COLORS + ES_CANDLE_UP from
 * components/shared/homeTheme.ts, copied rather than imported: owner-vite is a
 * separate Vite app and cannot reach the customer app's module graph. Copied
 * VALUES, not invented ones — the whole point of matching WallMigrationChart is
 * that a CORE line is the same gold on both surfaces. If those tokens ever move
 * they must move here too.
 */
const CORE_GOLD = "#ffd600";
const CALL_GREEN = "#30d158";
const PUT_RED = "#ff4757";
const SPOT_INK = "#FFFFFF";
/** The diverging pair, matching GexGrowth.tsx — OWNER_THEME has no true green. */
const POS = "#22C55E";
const NEG = "#EF4444";
/** Zero is the panel floor, not a grey. A surface should glow out of the dark. */
const FLOOR: [number, number, number] = [10, 13, 19];

type Surface = {
  ok?: boolean; error?: string; symbol?: string; basis?: string; leg?: string;
  dates?: string[]; spots?: (number | null)[]; strikes?: number[];
  grid?: (number | null)[][]; window?: { lo: number; hi: number } | null;
  capturedAt?: string | null; clipped?: boolean;
};

const SYMBOLS = ["SPX", "SPY", "QQQ", "NDX", "IWM", "NVDA", "TSLA", "AAPL", "META", "AMZN"];
const BASES = [
  { value: "oivol", label: "OI + Volume" },
  { value: "oi", label: "OI only" },
  { value: "vol", label: "Volume only" },
  { value: "flow", label: "Flow (signed)" },
];
const WINDOWS = [
  { value: "15", label: "15 sessions" },
  { value: "30", label: "30 sessions" },
  { value: "45", label: "45 sessions" },
  { value: "90", label: "90 sessions" },
];
// A percentage of spot — the only unit that means the same on SPY at 770 and
// SPX at 7700. A fixed point offset draws a sliver on one and empty on the other.
const WIDTHS = [
  { value: "2", label: "±2% strikes" },
  { value: "4", label: "±4% strikes" },
  { value: "8", label: "±8% strikes" },
  { value: "15", label: "±15% strikes" },
];

type Mode = "abs" | "net";
type MigKey = "core" | "other" | "spot";

/* ── colour ──────────────────────────────────────────────────────────────── */

const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const lerp = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

/** Diverging: two hues, a dark neutral midpoint. Never a rainbow. */
function netColor(v: number | null, max: number) {
  if (v == null || !Number.isFinite(v) || max <= 0) return `rgb(${FLOOR.join(",")})`;
  const t = Math.min(1, Math.abs(v) / max);
  if (t < 0.03) return `rgb(${FLOOR.join(",")})`;
  return lerp(FLOOR, rgbOf(v > 0 ? POS : NEG), 0.08 + 0.92 * Math.pow((t - 0.03) / 0.97, 0.7));
}
/**
 * Sequential: one hue family, monotonically lighter. |GEX| has no sign and no
 * meaningful midpoint, so a diverging ramp here would invent one.
 */
const HEAT: number[][] = [FLOOR, [58, 22, 4], [122, 58, 0], rgbOf("#F97316"), rgbOf("#FFB703"), [255, 240, 200], [255, 253, 245]];
function absColor(v: number | null, max: number) {
  if (v == null || !Number.isFinite(v) || max <= 0) return `rgb(${FLOOR.join(",")})`;
  const t = Math.min(1, Math.pow(Math.abs(v) / max, 0.88));
  const k = t * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(k));
  return lerp(HEAT[i], HEAT[i + 1], k - i);
}
const cellColor = (v: number | null, max: number, mode: Mode) =>
  (mode === "abs" ? absColor(v, max) : netColor(v, max));

const fmtB = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v); const s = v > 0 ? "+" : v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string, withMonth: boolean) => {
  const p = d.split("-");
  if (p.length !== 3) return d;
  return withMonth ? `${MON[Number(p[1]) - 1]} ${Number(p[2])}` : `${Number(p[2])}`;
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
/** A round strike step giving ~12 labels, whatever the underlying's scale. */
function tickStep(span: number) {
  const raw = span / 12;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  for (const m of [1, 2, 2.5, 5, 10]) if (mag * m >= raw) return mag * m;
  return mag * 10;
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function GexSurface() {
  const [symbol, setSymbol] = useState("SPX");
  const [basis, setBasis] = useState("oivol");
  const [days, setDays] = useState("15");
  const [sidePct, setSidePct] = useState("4");
  const [mode, setMode] = useState<Mode>("abs");
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
      // Stale-response guard: the pickers fire faster than the query returns and
      // an out-of-order resolve paints the wrong name under the right header.
      if (id !== reqId.current) return;
      if (!res.ok || j.ok === false) { setErr(j.error || `HTTP ${res.status}`); setData(null); }
      else setData(j);
    } catch (e) {
      if (id !== reqId.current) return;
      setErr(e instanceof Error ? e.message : String(e)); setData(null);
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

  const max = useMemo(() => {
    let m = 0;
    for (const row of grid) for (const v of row) if (v != null && Math.abs(v) > m) m = Math.abs(v);
    return m;
  }, [grid]);

  return (
    <PageShell>
      <Card variant="classic" padding={20} style={{ background: T.bg }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", color: T.text }}>
              {data?.symbol || symbol} {mode === "abs" ? "|GEX|" : "GEX"} — Strike × Days
            </h2>
            <div style={{ fontSize: 12.5, color: DIM, marginTop: 4 }}>
              {mode === "abs" ? "Absolute gamma magnitude" : "Signed net gamma"}
              {" · EOD snapshots · "}{dates.length || "—"} sessions
              {data?.capturedAt ? ` · run ${fmtEtStamp(data.capturedAt)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <ModeTab on={mode === "abs"} accent="#F97316" onClick={() => setMode("abs")}>|GEX| magnitude</ModeTab>
            <ModeTab on={mode === "net"} accent={T.cyan} onClick={() => setMode("net")}>signed net</ModeTab>
          </div>
        </div>

        <Controls
          symbol={symbol} setSymbol={setSymbol} basis={basis} setBasis={setBasis}
          days={days} setDays={setDays} sidePct={sidePct} setSidePct={setSidePct}
          onReload={load} loading={loading}
        />

        {err ? <div style={{ ...noteStyle, borderLeftColor: NEG, color: NEG }}>Could not read: {err}</div> : null}
        {!err && !loading && data && !ready ? (
          <div style={noteStyle}>
            {dates.length === 0
              ? `No recorded sessions for ${symbol} on this basis. The bases start at their own migration dates — OI + Volume has the full history.`
              : "Only one session on file. A strike × days view needs at least two."}
          </div>
        ) : null}
        {loading && !ready ? <div style={{ ...noteStyle, color: DIM }}>Reading {symbol}…</div> : null}

        {ready ? (
          <>
            <Heatmap dates={dates} strikes={strikes} grid={grid} spots={spots} max={max} mode={mode} />
            <div style={{ fontSize: 12, color: DIM, textAlign: "center", marginTop: 12 }}>
              {mode === "abs"
                ? "Unsigned — walls and acceleration zones look the same; read it next to the signed net view"
                : "Signed — green is long gamma, red is short. Zero is the background, not a colour."}
            </div>
          </>
        ) : null}
      </Card>

      {ready ? (
        <Card variant="classic" padding={0} style={{ background: T.bg, marginTop: 16 }}>
          <WallMigration dates={dates} strikes={strikes} grid={grid} spots={spots} />
        </Card>
      ) : null}
    </PageShell>
  );
}

/* ── chrome ──────────────────────────────────────────────────────────────── */

const noteStyle: CSSProperties = {
  borderLeft: `2px solid ${T.cyan}`, background: "rgba(33,158,188,0.06)",
  padding: "11px 14px", borderRadius: "0 8px 8px 0", fontSize: 12.5,
  color: T.text, margin: "14px 0 0", lineHeight: 1.55,
};

function ModeTab({ on, accent, onClick, children }: {
  on: boolean; accent: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      style={{
        background: on ? `${accent}24` : "transparent",
        border: `1px solid ${on ? accent : T.border}`,
        color: on ? accent : T.text,
        borderRadius: 8, padding: "6px 13px", fontFamily: MONO, fontSize: 11,
        cursor: "pointer", letterSpacing: ".03em", whiteSpace: "nowrap",
        opacity: on ? 1 : 0.72,
      }}
    >{children}</button>
  );
}

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
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", margin: "16px 0 6px" }}>
      <div style={{ width: 128 }}>
        <ThemedSelect
          value={SYMBOLS.includes(symbol) ? symbol : ""}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
          onChange={setSymbol} ariaLabel="Symbol" placeholder={symbol || "symbol"}
        />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const v = typed.trim().toUpperCase(); if (v) setSymbol(v); }}>
        <input
          value={typed} onChange={(e) => setTyped(e.target.value)}
          aria-label="Any symbol" placeholder="any ticker"
          style={{
            width: 104, background: T.panelInset, color: T.text, fontFamily: MONO, fontSize: 12,
            border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 10px", textTransform: "uppercase",
          }}
        />
      </form>
      <div style={{ width: 156 }}><ThemedSelect value={basis} options={BASES} onChange={setBasis} ariaLabel="Basis" /></div>
      <div style={{ width: 138 }}><ThemedSelect value={days} options={WINDOWS} onChange={setDays} ariaLabel="Lookback" /></div>
      <div style={{ width: 144 }}><ThemedSelect value={sidePct} options={WIDTHS} onChange={setSidePct} ariaLabel="Strike range" /></div>
      <button type="button" onClick={onReload} disabled={loading}
        style={{ ...homeButtonStyle, padding: "7px 14px", fontSize: 12, opacity: loading ? 0.5 : 1 }}>
        {loading ? "…" : "↻"}
      </button>
    </div>
  );
}

/* ── panel 1 · strike × days ─────────────────────────────────────────────── */

function Heatmap({ dates, strikes, grid, spots, max, mode }: {
  dates: string[]; strikes: number[]; grid: (number | null)[][];
  spots: (number | null)[]; max: number; mode: Mode;
}) {
  const W = 1180, L = 70, RPAD = 185, TP = 30, BM = 38, H = 514;
  const PLOT_W = W - L - RPAD;
  const rows = strikes.length;
  const ch = (H - TP - BM) / rows;
  const cw = PLOT_W / dates.length;
  const x = (d: number) => L + d * cw;
  // Strikes ascend in the payload; the chart reads high-at-top, so the row index
  // is inverted here rather than the array reversed — the column order has to
  // stay aligned with `strikes` for hit-testing and tooltips.
  const y = (i: number) => TP + (rows - 1 - i) * ch;

  const lo = strikes[0], hi = strikes[rows - 1];
  const yTop = TP + ch / 2, yBot = TP + (rows - 1) * ch + ch / 2;
  const yPrice = (p: number) => (hi === lo ? yTop
    : Math.min(yBot, Math.max(yTop, TP + (hi - p) * ((rows - 1) * ch) / (hi - lo) + ch / 2)));
  const offFrame = spots.filter((p) => p != null && (p < lo || p > hi)).length;

  const step = tickStep(hi - lo);
  const ticks = useMemo(
    () => strikes.map((s, i) => ({ s, i })).filter(({ s }) => Math.abs(s / step - Math.round(s / step)) < 1e-9),
    [strikes, step],
  );
  const dateStep = Math.max(1, Math.ceil(dates.length / 16));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ d: number; i: number } | null>(null);
  const locate = (e: ReactMouseEvent) => {
    const el = svgRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    if (px < L || px > L + PLOT_W || py < TP || py > TP + rows * ch) return null;
    return {
      d: Math.min(dates.length - 1, Math.max(0, Math.floor((px - L) / cw))),
      i: Math.min(rows - 1, Math.max(0, rows - 1 - Math.floor((py - TP) / ch))),
    };
  };
  const spotPts = spots
    .map((p, d) => (p == null ? null : `${(x(d) + cw / 2).toFixed(1)},${yPrice(p).toFixed(1)}`))
    .filter(Boolean).join(" ");
  const hv = hover ? grid[hover.d]?.[hover.i] : null;

  return (
    <div style={{ position: "relative", marginTop: 14 }}>
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", fontFamily: MONO, cursor: "crosshair" }}
        onMouseMove={(e) => setHover(locate(e))}
        onMouseLeave={() => setHover(null)}
      >
        <rect x={L} y={TP} width={PLOT_W} height={rows * ch} fill={`rgb(${FLOOR.join(",")})`} />
        {grid.map((row, d) => row.map((v, i) => (
          <rect key={`${d}-${i}`} x={x(d)} y={y(i)} width={cw + 0.5} height={ch + 0.6}
            fill={cellColor(v, max, mode)} shapeRendering="crispEdges" />
        )))}

        {/* Faint rules so a strike can be carried across the width without
            losing the row. Over the cells, under the price line. */}
        {ticks.map(({ i }) => (
          <line key={`h${i}`} x1={L} y1={y(i)} x2={L + PLOT_W} y2={y(i)} stroke={FAINT} strokeWidth={1} />
        ))}
        {dates.map((_, d) => (
          <line key={`v${d}`} x1={x(d)} y1={TP} x2={x(d)} y2={TP + rows * ch} stroke={FAINT} strokeWidth={1} />
        ))}

        {/* PRICE. Without it you cannot tell a wall being BUILT from a wall that
            is merely following price, and that is the whole question. */}
        <polyline points={spotPts} fill="none" stroke="#04060A" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={spotPts} fill="none" stroke="#D6E7F0" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />
        {spots.map((p, d) => (p == null ? null : (
          <circle key={d} cx={(x(d) + cw / 2).toFixed(1)} cy={yPrice(p).toFixed(1)} r={3}
            fill="#D6E7F0" stroke="#04060A" strokeWidth={1.3} />
        )))}

        <text x={L - 10} y={TP - 11} fill={DIM} fontSize={10.5} textAnchor="end">Strike</text>
        {ticks.map(({ s, i }) => (
          <text key={s} x={L - 10} y={y(i) + ch / 2 + 3.6} fill={DIM} fontSize={10.5} textAnchor="end">{s}</text>
        ))}
        {dates.map((d, i) => (
          i % dateStep === 0
            ? <text key={d} x={(x(i) + cw / 2).toFixed(1)} y={H - 14} fill={DIM} fontSize={10.5} textAnchor="middle">
              {dayLabel(d, i === 0)}
            </text>
            : null
        ))}
        <ColorBar x={L + PLOT_W + 52} y={TP + 22} h={rows * ch - 44} max={max} mode={mode} />
      </svg>

      {hover ? (
        <div style={{
          position: "absolute", right: 8, top: 8, pointerEvents: "none",
          background: "#04060A", border: `1px solid ${T.borderStrong}`, borderRadius: 7,
          padding: "6px 10px", fontFamily: MONO, fontSize: 10.5, color: T.text, lineHeight: 1.5,
        }}>
          <div style={{ color: T.cyan }}>{strikes[hover.i]} · {dates[hover.d]}</div>
          <div style={{ color: DIM }}>
            {mode === "abs" ? `|GEX| ${fmtB(hv == null ? null : Math.abs(hv))}` : `net ${fmtB(hv)}`}
            {hv == null ? " · not recorded this session" : ""}
          </div>
          <div style={{ color: DIM }}>spot {spots[hover.d]?.toFixed(2) ?? "—"}</div>
        </div>
      ) : null}

      {offFrame > 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 9.5, color: T.gold, marginTop: 4 }}>
          {offFrame} session{offFrame === 1 ? "" : "s"} closed outside the drawn strike range — the price line is
          pinned to the edge there. Widen the strike range.
        </div>
      ) : null}
    </div>
  );
}

function ColorBar({ x, y, h, max, mode }: { x: number; y: number; h: number; max: number; mode: Mode }) {
  const N = 44, seg = h / N;
  const top = mode === "abs" ? "high |GEX|" : "+ GEX wall";
  const bot = mode === "abs" ? "low |GEX|" : "− GEX accel";
  return (
    <g>
      <text x={x - 4} y={y - 12} fill={DIM} fontSize={10.5}>{mode === "abs" ? "|GEX| pressure" : "net GEX"}</text>
      {Array.from({ length: N }, (_, k) => {
        // Top of the bar is the high end in both modes: the signed ramp runs
        // +max → −max through the floor, the magnitude ramp max → 0.
        const t = 1 - k / (N - 1);
        const v = mode === "abs" ? t * max : (t * 2 - 1) * max;
        return <rect key={k} x={x} y={y + k * seg} width={17} height={seg + 0.6} fill={cellColor(v, max, mode)} />;
      })}
      <rect x={x} y={y} width={17} height={h} fill="none" stroke="rgba(255,255,255,0.12)" />
      <text x={x + 24} y={y + 11} fill={DIM} fontSize={10.5}>{top}</text>
      {mode === "net" ? <text x={x + 24} y={y + h / 2 + 4} fill={DIM} fontSize={10.5}>0</text> : null}
      <text x={x + 24} y={y + h - 1} fill={DIM} fontSize={10.5}>{bot}</text>
    </g>
  );
}

/* ── panel 2 · wall migration ────────────────────────────────────────────── */

function WallMigration({ dates, strikes, grid, spots }: {
  dates: string[]; strikes: number[]; grid: (number | null)[][]; spots: (number | null)[];
}) {
  /**
   * Kept as the set of what is OFF, so a series that only appears later (a
   * longer window landing, the basis switching) arrives visible.
   */
  const [off, setOff] = useState<Set<MigKey>>(() => new Set());
  const toggle = (k: MigKey) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const live = (k: MigKey) => !off.has(k);

  /**
   * The two roles. CORE is the heaviest |GEX| node — which IS one of the walls —
   * and OTHER is the lighter one, carrying the side it currently is so it can be
   * drawn in that wall's colour. See the header for why this beats masking the
   * matching wall out per session.
   */
  const M = useMemo(() => {
    const core: number[] = [], other: number[] = [], side: ("call" | "put")[] = [];
    const cw: number[] = [], pw: number[] = [];
    dates.forEach((_, d) => {
      const row = grid[d] || [];
      let bi = -1, wi = -1;
      row.forEach((v, i) => {
        if (v == null) return;
        if (bi < 0 || v > (row[bi] as number)) bi = i;
        if (wi < 0 || v < (row[wi] as number)) wi = i;
      });
      if (bi < 0 || wi < 0) { core.push(NaN); other.push(NaN); side.push("call"); cw.push(NaN); pw.push(NaN); return; }
      const callK = strikes[bi], putK = strikes[wi];
      cw.push(callK); pw.push(putK);
      const coreIsCall = Math.abs(row[bi] as number) >= Math.abs(row[wi] as number);
      core.push(coreIsCall ? callK : putK);
      other.push(coreIsCall ? putK : callK);
      side.push(coreIsCall ? "put" : "call");
    });
    return { core, other, side, cw, pw };
  }, [dates, grid, strikes]);

  const ND = dates.length;
  const ok = M.core.every((v) => Number.isFinite(v));
  const W = 1000, H = 250, PAD = 8;

  let vals: number[] = [];
  if (live("core")) vals = vals.concat(M.core);
  if (live("other")) vals = vals.concat(M.other);
  if (live("spot")) vals = vals.concat(spots.filter((v): v is number => v != null));
  vals = vals.filter((v) => Number.isFinite(v));
  if (!vals.length) vals = [strikes[0], strikes[strikes.length - 1]];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padY = (hi - lo) * 0.14 || 10; lo -= padY; hi += padY;

  const x = (d: number) => (ND > 1 ? (d * W) / (ND - 1) : W / 2);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
  const edges = (d: number): [number, number] => [
    d === 0 ? 0 : (x(d - 1) + x(d)) / 2,
    d === ND - 1 ? W : (x(d) + x(d + 1)) / 2,
  ];
  /** A level HOLDS its strike until the book rolls it, so it is a step. */
  const stepPath = (arr: number[]) => {
    let p = "";
    for (let d = 0; d < ND; d++) {
      const [xa, xb] = edges(d);
      p += `${d === 0 ? "M" : "L"}${xa.toFixed(1)} ${y(arr[d]).toFixed(1)} L${xb.toFixed(1)} ${y(arr[d]).toFixed(1)} `;
    }
    return p;
  };
  const corridor = () => {
    const up: string[] = [], dn: string[] = [];
    for (let d = 0; d < ND; d++) {
      const a = Math.max(M.core[d], M.other[d]), b = Math.min(M.core[d], M.other[d]);
      const [xa, xb] = edges(d);
      up.push(`${xa.toFixed(1)} ${y(a).toFixed(1)}`, `${xb.toFixed(1)} ${y(a).toFixed(1)}`);
      dn.push(`${xa.toFixed(1)} ${y(b).toFixed(1)}`, `${xb.toFixed(1)} ${y(b).toFixed(1)}`);
    }
    return `M${up.join(" L")} L${dn.reverse().join(" L")} Z`;
  };
  /** OTHER in contiguous same-side runs, so neither colour blinks mid-run. */
  const otherRuns = () => {
    const out: { d: string; c: string }[] = [];
    let start = 0;
    for (let d = 1; d <= ND; d++) {
      if (d === ND || M.side[d] !== M.side[start]) {
        let p = "";
        for (let k = start; k < d; k++) {
          const [xa, xb] = edges(k);
          p += `${k === start ? "M" : "L"}${xa.toFixed(1)} ${y(M.other[k]).toFixed(1)} L${xb.toFixed(1)} ${y(M.other[k]).toFixed(1)} `;
        }
        out.push({ d: p, c: M.side[start] === "call" ? CALL_GREEN : PUT_RED });
        start = d;
      }
    }
    return out;
  };

  const lastSide = M.side[ND - 1];
  const chips: { k: MigKey; c: string; label: string; val: string }[] = [
    { k: "core", c: CORE_GOLD, label: "CORE", val: ok ? String(M.core[ND - 1]) : "—" },
    { k: "other", c: lastSide === "call" ? CALL_GREEN : PUT_RED, label: lastSide === "call" ? "Call Wall" : "Put Wall", val: ok ? String(M.other[ND - 1]) : "—" },
    { k: "spot", c: SPOT_INK, label: "spot", val: spots[ND - 1] != null ? (spots[ND - 1] as number).toFixed(2) : "—" },
  ];
  const rolls = M.core.reduce((n, v, d) => n + (d && v !== M.core[d - 1] ? 1 : 0), 0);
  const dateStep = Math.max(1, Math.ceil(ND / 12));

  if (!ok) {
    return <div style={{ padding: "15px 20px", fontSize: 12.5, color: DIM }}>
      Not enough recorded strikes to resolve walls on every session in this window.
    </div>;
  }

  return (
    <div style={{ padding: "15px 20px 14px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.text }}>
          Wall migration
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>
          {ND} sessions · recorded levels · {dates[0]} → {dates[ND - 1]}
        </span>
      </div>

      {/* Swatch chips, under the head and above the plot — each one the series'
          switch. Off reads as off: the swatch hollows and the chip dims. */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {chips.map((c) => {
          const on = live(c.k);
          return (
            <button
              key={c.k} type="button" onClick={() => toggle(c.k)} aria-pressed={on}
              title={on ? `Hide ${c.label}` : `Show ${c.label}`}
              style={{
                display: "inline-block", boxSizing: "border-box", whiteSpace: "nowrap",
                height: 16, lineHeight: "16px", padding: 0, borderRadius: 6,
                border: "1px solid transparent", background: "transparent",
                fontFamily: "inherit", fontSize: 11, cursor: "pointer",
                color: DIM, opacity: on ? 1 : 0.4,
              }}
            >
              <span aria-hidden style={{
                display: "inline-block", verticalAlign: "middle", marginRight: 6,
                width: 9, height: 9, borderRadius: 2,
                background: on ? c.c : "transparent", border: `1px solid ${c.c}`,
              }} />
              <span style={{ verticalAlign: "middle", marginRight: 6 }}>{c.label}</span>
              <span style={{ verticalAlign: "middle", fontFamily: MONO, color: on ? T.text : DIM }}>{c.val}</span>
            </button>
          );
        })}
      </div>

      {/* preserveAspectRatio="none" — x is sessions, y is price, and the two have
          no business sharing a scale. So NO <text> and NO <circle> inside: the
          squash would stretch them. Both axes are DOM, outside the box. */}
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <div style={{ position: "relative", width: 46, height: H, flex: "none" }}>
          {Array.from({ length: 6 }, (_, k) => {
            const v = lo + ((hi - lo) * k) / 5;
            return (
              <div key={k} style={{
                position: "absolute", right: 0, top: PAD + (1 - k / 5) * (H - PAD * 2),
                transform: "translateY(-50%)", fontFamily: MONO, fontSize: 10.5, color: DIM, whiteSpace: "nowrap",
              }}>{Math.round(v)}</div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
            {live("core") && live("other")
              ? <path d={corridor()} fill="rgba(255,255,255,0.035)" />
              : null}
            {live("spot") ? (
              <polyline
                points={spots.map((p, d) => (p == null ? null : `${x(d).toFixed(1)},${y(p).toFixed(1)}`)).filter(Boolean).join(" ")}
                fill="none" stroke={SPOT_INK} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
              />
            ) : null}
            {live("other") ? otherRuns().map((r, k) => (
              <path key={k} d={r.d} fill="none" stroke={r.c} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            )) : null}
            {live("core") ? (
              <path d={stepPath(M.core)} fill="none" stroke={CORE_GOLD} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            ) : null}
          </svg>
          <div style={{ position: "relative", height: 18, marginTop: 5 }}>
            {dates.map((d, i) => (
              i % dateStep === 0 || i === ND - 1 ? (
                <div key={d} style={{
                  position: "absolute", left: `${(ND > 1 ? (i / (ND - 1)) * 100 : 50).toFixed(3)}%`,
                  transform: "translateX(-50%)", fontFamily: MONO, fontSize: 10.5, color: DIM, whiteSpace: "nowrap",
                }}>{dayLabel(d, i === 0)}</div>
              ) : null
            ))}
          </div>
        </div>
        <div style={{ width: 96, flex: "none" }} />
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: DIM, flexWrap: "wrap" }}>
        <span title="Sessions on which the heaviest |GEX| node moved to a different strike.">CORE rolled {rolls}×</span>
        <span>corridor {Math.min(...M.pw)} – {Math.max(...M.cw)}</span>
        <span>now {M.pw[ND - 1]} / {M.cw[ND - 1]}</span>
      </div>
    </div>
  );
}
