import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "../components/PageCard";

/* ────────────────────────────────────────────────────────────────────────────
 * Options Probe — type a contract in shorthand ("TSLA 420c 7/17") plus your fill
 * price; it records the entry and tracks the result as it prints. Thin client over
 * the deployed /api/watch pipeline: resolves the contract via /proxy/probe-rest
 * (Theta greeks + TT quote), persists to Postgres, and a server-side recorder
 * keeps filling history during RTH even when this page is closed — the same proxy
 * pipeline the GEX tabs use. Full greeks + price charts live on /owner/watch.
 * ════════════════════════════════════════════════════════════════════════════ */

interface ProbeSnapshot { ts: number | string | null; mark: number | null; last: number | null; bid: number | null; ask: number | null }
interface ProbeRow {
  id: number; ticker: string; expiration: string; strike: number;
  side: string; note: string | null; added_price: number | null; snapshot: ProbeSnapshot | null;
}
interface ParsedContract { ticker: string; strike: number; side: "C" | "P"; expiry: string; atPrice: number | null }

// Parse "TSLA 420c 7/17", "SPX 6000p 12/19/26", "AAPL 250 C 2026-01-16 @ 3.10".
// Returns null until ticker + strike + side + a valid expiry are all present.
function parseContract(raw: string): ParsedContract | null {
  const s = raw.trim();
  if (!s) return null;
  const tickerM = s.match(/^([A-Za-z.]{1,6})/);
  if (!tickerM) return null;
  const ticker = tickerM[1].toUpperCase();

  let strike: number | null = null;
  let side: "C" | "P" | null = null;
  const cs = s.match(/(\d+(?:\.\d+)?)\s*([cCpP])(?![A-Za-z])/); // "420c" / "250 C"
  if (cs) {
    strike = parseFloat(cs[1]);
    side = cs[2].toUpperCase() as "C" | "P";
  } else {
    const rest = s.slice(ticker.length);
    const sideM = rest.match(/\b(call|put|c|p)\b/i);
    const strikeM = rest.match(/(\d+(?:\.\d+)?)/);
    if (sideM) side = /^(c|call)$/i.test(sideM[1]) ? "C" : "P";
    if (strikeM) strike = parseFloat(strikeM[1]);
  }

  let expiry: string | null = null;
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const md = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (iso) {
    expiry = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  } else if (md) {
    const mo = parseInt(md[1], 10), da = parseInt(md[2], 10);
    let yr = md[3] ? parseInt(md[3], 10) : NaN;
    if (md[3] && md[3].length === 2) yr = 2000 + parseInt(md[3], 10);
    if (!Number.isFinite(yr)) {
      const now = new Date();
      yr = now.getFullYear();
      // If the M/D already passed this year, roll it to next year.
      if (new Date(yr, mo - 1, da) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) yr += 1;
    }
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      expiry = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }

  let atPrice: number | null = null;
  const at = s.match(/@\s*(\d+(?:\.\d+)?)/);
  if (at) atPrice = parseFloat(at[1]);

  if (strike == null || !Number.isFinite(strike) || !side || !expiry) return null;
  return { ticker, strike, side, expiry, atPrice };
}

const OP_CSS = `
  .op-wrap { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; padding-bottom: 44px; }
  .op-card { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
  .op-card-h { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text1); padding: 13px 16px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .op-card-h .sub { font-size: 12px; font-weight: 600; letter-spacing: 0.01em; text-transform: none; color: var(--sm-muted); }
  .op-card-b { padding: 16px; }
  .op-entry { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
  .op-entry .contract { flex: 2; min-width: 220px; }
  .op-entry .price { flex: 1; min-width: 120px; }
  .op-input { width: 100%; box-sizing: border-box; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 6px; padding: 11px 12px; font-family: var(--sm-mono); font-size: 14px; }
  .op-input:focus { outline: none; border-color: var(--cyan); }
  .op-input::placeholder { color: var(--sm-muted); opacity: 0.55; }
  .op-go { font-family: var(--sm-mono); font-size: 12px; font-weight: 800; letter-spacing: 0.04em; cursor: pointer; padding: 0 18px; border-radius: 6px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; white-space: nowrap; }
  .op-go:disabled { opacity: 0.45; cursor: default; }
  .op-note-row { margin-top: 10px; }
  .op-preview { margin-top: 11px; font-family: var(--sm-mono); font-size: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .op-chip { padding: 4px 9px; border-radius: 6px; border: 1px solid rgba(33,158,188,0.4); color: var(--cyan); background: rgba(33,158,188,0.08); }
  .op-chip.side-p { border-color: rgba(251,133,1,0.5); color: var(--amber); background: rgba(251,133,1,0.08); }
  .op-hint { color: var(--sm-muted); }
  .op-err { margin-top: 12px; font-size: 12px; color: var(--sm-red); border-left: 2px solid var(--sm-red); padding: 6px 10px; background: rgba(239,68,68,0.06); border-radius: 0 6px 6px 0; }
  .op-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); }
  .op-btn:hover { border-color: var(--cyan); }
  .op-btn:disabled { opacity: 0.5; cursor: default; }
  .op-link { font-family: var(--sm-mono); font-size: 12px; color: var(--cyan); text-decoration: none; }
  .op-link:hover { text-decoration: underline; }
  .op-row { display: grid; grid-template-columns: 1.3fr 1.25fr 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--sm-border); }
  .op-row:last-child { border-bottom: none; }
  .op-tick { font-size: 17px; font-weight: 800; color: var(--text1); }
  .op-badge { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  .op-badge.c { color: var(--sm-green); background: rgba(142,202,230,0.12); border: 1px solid rgba(142,202,230,0.4); }
  .op-badge.p { color: var(--amber); background: rgba(251,133,1,0.12); border: 1px solid rgba(251,133,1,0.4); }
  .op-badge.exp { color: var(--sm-red); background: rgba(239,71,111,0.12); border: 1px solid rgba(239,71,111,0.4); text-transform: uppercase; letter-spacing: 0.06em; }
  .op-tcard.expired { opacity: 0.62; }
  .op-rowsub { font-size: 12px; color: var(--sm-muted); margin-top: 3px; font-family: var(--sm-mono); }
  .op-px { font-family: var(--sm-mono); font-size: 14px; color: var(--text1); }
  .op-px .arrow { color: var(--sm-muted); margin: 0 6px; }
  .op-px .lbl { color: var(--sm-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; }
  .op-pnl { font-family: var(--sm-mono); font-size: 14px; font-weight: 800; text-align: right; }
  .op-pnl .d { font-size: 12px; font-weight: 600; display: block; margin-top: 2px; }
  .op-x { background: none; border: none; color: var(--sm-muted); cursor: pointer; font-size: 17px; line-height: 1; padding: 0 2px; justify-self: end; }
  .op-x:hover { color: var(--sm-red); }
  .op-empty { padding: 26px; text-align: center; color: var(--sm-muted); font-size: 14px; }
  .op-note { font-size: 12px; color: var(--sm-muted); line-height: 1.55; margin-top: 12px; }
  .op-shorthand { display: flex; gap: 10px; margin-bottom: 12px; }
  .op-shorthand .op-input { flex: 1; }
  .op-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .op-f { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 92px; }
  .op-flab { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sm-muted); font-family: var(--sm-mono); }
  .op-flab i { text-transform: none; letter-spacing: 0; opacity: 0.7; font-style: normal; }
  .op-side { display: flex; gap: 6px; }
  .op-sidebtn { flex: 1; font-family: var(--sm-mono); font-size: 12px; font-weight: 700; cursor: pointer; padding: 10px 8px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg0); color: var(--sm-muted); }
  .op-sidebtn.on.c { border-color: rgba(142,202,230,0.6); color: var(--sm-green); background: rgba(142,202,230,0.10); }
  .op-sidebtn.on.p { border-color: rgba(251,133,1,0.6); color: var(--amber); background: rgba(251,133,1,0.10); }
  .op-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .op-tcard { background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px; }
  .op-tcard-h { display: flex; align-items: center; justify-content: space-between; }
  .op-bigrow { margin: 10px 0 8px; }
  .op-big { font-family: var(--sm-mono); font-size: 24px; font-weight: 800; line-height: 1; }
  .op-bigsub { font-family: var(--sm-mono); font-size: 14px; color: var(--text1); margin-top: 6px; }
  .op-bigsub .lbl { color: var(--sm-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 3px; }
  .op-bigsub .arrow { color: var(--sm-muted); margin: 0 6px; }
  .op-dollars { font-weight: 700; }
  .op-legend { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); }
  .op-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .op-legend .dot.in { background: transparent; border: 1.5px solid var(--text1); }
  .op-legend .dot.now { background: var(--cyan); }
  .op-legend-ago { margin-left: auto; }
  .op-sparkempty { font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); padding: 16px 0; text-align: center; }
  .op-tcard { cursor: pointer; transition: border-color 0.12s; }
  .op-tcard:hover { border-color: rgba(33,158,188,0.4); }
  .op-tcard.open { border-color: rgba(33,158,188,0.5); }
  .op-chev { color: var(--sm-muted); font-size: 12px; margin-left: 6px; }
  .op-chartwrap { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--sm-border); cursor: default; }
  .op-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .op-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
  .op-tgl { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; cursor: pointer; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--sm-border); background: transparent; color: var(--sm-muted); }
  .op-tgl:hover { color: var(--text1); }
  .op-tgl.on { color: var(--text1); background: rgba(255,255,255,0.08); }
  .op-tgl.on.cyan { color: #219EBC; background: rgba(33,158,188,0.12); border-color: rgba(33,158,188,0.4); }
  .op-chartempty { padding: 40px 0; text-align: center; color: var(--sm-muted); font-size: 12px; font-family: var(--sm-mono); }
  .op-charthint { margin-top: 8px; font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); letter-spacing: 0.04em; }

  :root {
    --bg0: #05060a;
    --bg1: #0d1119;
    --bg2: #161b22;
    --bg3: #21262d;
    --text1: #ffffff;
    --cyan: #219ebc;
    --amber: #fb8501;
    --sm-red: #ef4444;
    --sm-green: #8ecae6;
    --sm-muted: #ffffff;
    --sm-border: rgba(255,255,255,0.1);
    --sm-mono: "Courier New", monospace;
  }
`;

type ProbeMetricKey = "mark" | "net_gex" | "delta" | "theta" | "vega" | "iv";
interface ProbeHistSnap { ts: number; mark: number | null; net_gex: number | null; delta: number | null; theta: number | null; vega: number | null; iv: number | null }
const PROBE_METRICS: { key: ProbeMetricKey; label: string; d: number }[] = [
  { key: "mark", label: "Price", d: 2 },
  { key: "net_gex", label: "Net GEX", d: 0 },
  { key: "delta", label: "Δ", d: 3 },
  { key: "theta", label: "Θ", d: 3 },
  { key: "vega", label: "V", d: 3 },
  { key: "iv", label: "IV", d: 4 },
];
const PROBE_RANGES: { key: string; label: string }[] = [
  { key: "1d", label: "1D" }, { key: "3d", label: "3D" }, { key: "1w", label: "1W" }, { key: "1m", label: "1M" },
];

function opFmtGEX(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v >= 0 ? "+" : "−";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${(a / 1e3).toFixed(2)}K`;
}
function opIsRth(ts: number | string | null | undefined): boolean {
  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(t));
  const get = (k: string) => p.find((x) => x.type === k)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function ProbeChart({ history, metric }: { history: ProbeHistSnap[]; metric: ProbeMetricKey }) {
  const W = 960, H = 340, PADL = 56, PADR = 16, PADT = 16, PADB = 28;
  const pts = history
    .map((s) => ({ ts: s.ts, v: s[metric] as number | null }))
    .filter((p) => p.v != null && Number.isFinite(p.v as number)) as { ts: number; v: number }[];
  if (pts.length < 2) {
    return <div className="op-chartempty">Not enough history yet — snapshots accrue every refresh (and through RTH server-side).</div>;
  }
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.08; minY -= gpad; maxY += gpad;
  const n = pts.length;
  const sx = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(n - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const dec = PROBE_METRICS.find((m) => m.key === metric)!.d;
  const fmtY = (v: number) => (metric === "net_gex" ? opFmtGEX(v) : v.toFixed(dec));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const multiDay = maxX - minX > 20 * 3600_000;
  const fmtT = (ts: number) => multiDay
    ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="opwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(33,158,188,0.28)" />
          <stop offset="100%" stopColor="rgba(33,158,188,0)" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtY(v)}</text>
        </g>
      ))}
      <text x={PADL} y={H - 6} textAnchor="start" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtT(maxX)}</text>
      <path d={area} fill="url(#opwg)" />
      <path d={path} fill="none" stroke="#219EBC" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(n - 1)} cy={sy(pts[pts.length - 1].v)} r={3} fill="#219EBC" />
    </svg>
  );
}

function ProbeSpark({ points, entry }: { points: { ts: number; mark: number }[]; entry: number | null }) {
  const W = 300, H = 60, PAD = 7;
  if (points.length < 1) {
    return <div className="op-sparkempty">building history — snapshots accrue every refresh</div>;
  }
  const ys = points.map((p) => p.mark);
  const dom = entry != null && Number.isFinite(entry) ? [...ys, entry] : ys;
  let minY = Math.min(...dom), maxY = Math.max(...dom);
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  const padY = (maxY - minY) * 0.14; minY -= padY; maxY += padY;
  const n = points.length;
  const sx = (i: number) => PAD + (n <= 1 ? 0 : i / (n - 1)) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - ((v - minY) / (maxY - minY || 1)) * (H - PAD * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.mark).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = `${line} L${sx(n - 1).toFixed(1)},${(H - PAD).toFixed(1)} L${sx(0).toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  const up = entry != null ? last.mark - entry : 0;
  const nowColor = entry == null ? "#219EBC" : up > 0 ? "#8ECAE6" : up < 0 ? "#EF4444" : "#9aa4b2";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {entry != null && Number.isFinite(entry) && (
        <line x1={PAD} y1={sy(entry)} x2={W - PAD} y2={sy(entry)} stroke="#9aa4b2" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
      )}
      <path d={area} fill="rgba(33,158,188,0.10)" />
      <path d={line} fill="none" stroke="#219EBC" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {entry != null && Number.isFinite(entry) && (
        <circle cx={sx(0)} cy={sy(entry)} r={3.5} fill="#0d1119" stroke="#ffffff" strokeWidth={1.5} />
      )}
      <circle cx={sx(n - 1)} cy={sy(last.mark)} r={4} fill={nowColor} stroke="#05060a" strokeWidth={1} />
    </svg>
  );
}

export default function Probe() {
  const [shorthand, setShorthand] = useState("");
  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState<"C" | "P">("C");
  const [fill, setFill] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [historyById, setHistoryById] = useState<Record<number, { ts: number; mark: number }[]>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [histFull, setHistFull] = useState<Record<number, ProbeHistSnap[]>>({});
  const [histLoading, setHistLoading] = useState(false);
  const [metric, setMetric] = useState<ProbeMetricKey>("mark");
  const [range, setRange] = useState<string>("1d");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const entryVal = useMemo(() => {
    const n = parseFloat(fill.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [fill]);
  // Ready to add once ticker + a valid ISO expiry + a positive strike are present.
  const canAdd = ticker.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && parseFloat(strike) > 0;

  // Shorthand → fields: "TSLA 420c 7/17" fills the structured inputs below.
  const applyShorthand = useCallback((str: string) => {
    const p = parseContract(str);
    if (!p) { setErr("Couldn't parse — try: TSLA 420c 7/17"); return; }
    setErr(null);
    setTicker(p.ticker);
    setStrike(String(p.strike));
    setSide(p.side);
    setExpiry(p.expiry);
    if (p.atPrice != null) setFill(String(p.atPrice));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watch", { cache: "no-store" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setErr(null);
      setLastLoad(Date.now());
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 20_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const loadHistories = useCallback(async (ids: number[]) => {
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/watch?history=${id}`, { cache: "no-store" });
        const j = await res.json();
        const pts = (Array.isArray(j.history) ? j.history : [])
          .map((s: { ts: number | string; mark: number | null }) => ({ ts: Number(s.ts), mark: Number(s.mark) }))
          .filter((p: { ts: number; mark: number }) => Number.isFinite(p.ts) && Number.isFinite(p.mark))
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);
        return [id, pts] as const;
      } catch {
        return [id, [] as { ts: number; mark: number }[]] as const;
      }
    }));
    setHistoryById((prev) => {
      const next = { ...prev };
      for (const [id, pts] of entries) next[id] = pts;
      return next;
    });
  }, []);

  const idKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = idKey ? idKey.split(",").map(Number) : [];
    if (ids.length) loadHistories(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const loadFullHistory = useCallback(async (id: number, r: string) => {
    setHistLoading(true);
    try {
      const res = await fetch(`/api/watch?history=${id}&range=${r}`, { cache: "no-store" });
      const j = await res.json();
      const snaps: ProbeHistSnap[] = (Array.isArray(j.history) ? j.history : [])
        .map((s: Record<string, unknown>) => ({
          ts: Number(s.ts),
          mark: s.mark == null ? null : Number(s.mark),
          net_gex: s.net_gex == null ? null : Number(s.net_gex),
          delta: s.delta == null ? null : Number(s.delta),
          theta: s.theta == null ? null : Number(s.theta),
          vega: s.vega == null ? null : Number(s.vega),
          iv: s.iv == null ? null : Number(s.iv),
        }))
        .filter((s: ProbeHistSnap) => Number.isFinite(s.ts) && opIsRth(s.ts))
        .sort((a: ProbeHistSnap, b: ProbeHistSnap) => a.ts - b.ts);
      setHistFull((m) => ({ ...m, [id]: snaps }));
    } catch {
      /* keep prior */
    } finally {
      setHistLoading(false);
    }
  }, []);

  const toggleCard = useCallback((id: number) => {
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next != null) loadFullHistory(next, range);
      return next;
    });
  }, [loadFullHistory, range]);

  const changeRange = useCallback((r: string) => {
    setRange(r);
    if (expandedId != null) loadFullHistory(expandedId, r);
  }, [expandedId, loadFullHistory]);

  useEffect(() => {
    if (expandedId == null) return;
    const t = setInterval(() => loadFullHistory(expandedId, range), 20_000);
    return () => clearInterval(t);
  }, [expandedId, range, loadFullHistory]);

  const probeAndTrack = useCallback(async () => {
    if (!canAdd) { setErr("Enter ticker, expiry and strike"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          ticker: ticker.trim().toUpperCase(),
          expiry,
          strike: Number(strike),
          side,
          note: note || null,
          addedPrice: entryVal,
        }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setShorthand(""); setTicker(""); setStrike(""); setFill(""); setNote("");
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setAdding(false);
    }
  }, [canAdd, ticker, expiry, strike, side, note, entryVal, load]);

  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      if (Array.isArray(j.rows)) {
        setRows(j.rows);
        void loadHistories((j.rows as ProbeRow[]).map((x) => x.id));
      }
      setErr(null);
      setLastLoad(Date.now());
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setRefreshing(false);
    }
  }, [loadHistories]);

  const remove = useCallback(async (id: number) => {
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", id }),
      });
    } catch { /* optimistic */ }
  }, []);

  const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(2));
  const isExpired = (iso: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(iso) &&
    iso < new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const fmtExp = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };
  const ago = (ts: number | string | null | undefined) => {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return "—";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  const upDown = (v: number | null) => (v == null ? "var(--sm-muted)" : v > 0 ? "var(--sm-green)" : v < 0 ? "var(--sm-red)" : "var(--sm-muted)");

  return (
    <PageShell>
    <div className="op-wrap">
      <style>{OP_CSS}</style>

      {/* Probe entry */}
      <div className="op-card">
        <div className="op-card-h">Probe a contract <span className="sub">records your entry, then tracks the result live</span></div>
        <div className="op-card-b">
          {/* Optional shorthand → fills the fields below */}
          <div className="op-shorthand">
            <input
              className="op-input"
              value={shorthand}
              onChange={(e) => setShorthand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyShorthand(shorthand); }}
              placeholder="shortcut: TSLA 420c 7/17  →  Enter to fill"
            />
            <button type="button" className="op-btn" onClick={() => applyShorthand(shorthand)} disabled={!shorthand.trim()}>Fill ↓</button>
          </div>

          <div className="op-form">
            <label className="op-f"><span className="op-flab">Ticker</span>
              <input className="op-input" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="TSLA" />
            </label>
            <label className="op-f"><span className="op-flab">Expiration</span>
              <input className="op-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ colorScheme: "dark" }} />
            </label>
            <label className="op-f"><span className="op-flab">Strike</span>
              <input className="op-input" type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="420" />
            </label>
            <div className="op-f"><span className="op-flab">Side</span>
              <div className="op-side">
                <button type="button" className={`op-sidebtn${side === "C" ? " on c" : ""}`} onClick={() => setSide("C")}>Call</button>
                <button type="button" className={`op-sidebtn${side === "P" ? " on p" : ""}`} onClick={() => setSide("P")}>Put</button>
              </div>
            </div>
            <label className="op-f"><span className="op-flab">Fill price <i>(opt)</i></span>
              <input className="op-input" value={fill} onChange={(e) => setFill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canAdd && !adding) probeAndTrack(); }} placeholder="live mark" inputMode="decimal" />
            </label>
            <button type="button" className="op-go" onClick={probeAndTrack} disabled={!canAdd || adding}>
              {adding ? "Probing…" : "Probe & Track"}
            </button>
          </div>

          <div className="op-note-row">
            <input className="op-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note / thesis (optional)" />
          </div>

          <div className="op-preview">
            {canAdd ? (
              <>
                <span className={`op-chip${side === "P" ? " side-p" : ""}`}>
                  {ticker} {parseFloat(strike) % 1 ? strike : Math.round(parseFloat(strike))}{side} · {fmtExp(expiry)}
                </span>
                <span className="op-hint">entry {entryVal != null ? `@ ${entryVal.toFixed(2)}` : "= live mark on add"}</span>
              </>
            ) : (
              <span className="op-hint">fill ticker, expiry &amp; strike — or paste a shortcut like <b>TSLA 420c 7/17</b> above</span>
            )}
          </div>
          {err && <div className="op-err">{err}</div>}
        </div>
      </div>

      {/* Tracked results */}
      <div className="op-card">
        <div className="op-card-h">
          Tracked <span className="sub">{rows.length} contract{rows.length === 1 ? "" : "s"}{lastLoad ? ` · updated ${ago(lastLoad)}` : ""}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
            <span style={{ fontFamily: "var(--sm-mono)", fontSize: 12, color: "var(--sm-muted)" }}>click a card for the full chart</span>
            <button type="button" className="op-btn" onClick={refreshPrices} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
          </span>
        </div>
        <div className="op-card-b">
          {loading ? (
            <div className="op-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="op-empty">No contracts yet — probe one above.</div>
          ) : (
            <div className="op-grid">
              {rows.map((r) => {
                const entry = r.added_price;
                const mark = r.snapshot?.mark ?? r.snapshot?.last ?? null;
                const pct = entry != null && mark != null && entry !== 0 ? ((mark - entry) / entry) * 100 : null;
                const dollars = entry != null && mark != null ? (mark - entry) * 100 : null;
                const hist = (historyById[r.id] ?? []).filter((h) => opIsRth(h.ts));
                const liveTs = Number(r.snapshot?.ts);
                const pts = mark != null && Number.isFinite(liveTs) && opIsRth(liveTs) && (!hist.length || liveTs > hist[hist.length - 1].ts)
                  ? [...hist, { ts: liveTs, mark }]
                  : hist;
                const isOpen = expandedId === r.id;
                const expired = isExpired(r.expiration);
                return (
                  <div
                    key={r.id}
                    className={`op-tcard${isOpen ? " open" : ""}${expired ? " expired" : ""}`}
                    onClick={() => toggleCard(r.id)}
                    style={isOpen ? { gridColumn: "1 / -1" } : undefined}
                  >
                    <div className="op-tcard-h">
                      <div>
                        <span className="op-tick">{r.ticker}</span>
                        <span className={`op-badge ${r.side === "C" ? "c" : "p"}`}>{r.strike % 1 ? r.strike : Math.round(r.strike)}{r.side}</span>
                        {expired && <span className="op-badge exp">Expired</span>}
                        <span className="op-chev">{isOpen ? "▾" : "▸"}</span>
                      </div>
                      <button type="button" className="op-x" title="Remove" onClick={(e) => { e.stopPropagation(); remove(r.id); }}>×</button>
                    </div>
                    <div className="op-rowsub">{fmtExp(r.expiration)}{r.note ? ` · ${r.note}` : ""}</div>
                    <div className="op-bigrow">
                      <div className="op-big" style={{ color: upDown(pct) }}>
                        {pct == null ? "—" : `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
                      </div>
                      <div className="op-bigsub">
                        <span className="lbl">in</span>{px(entry)}<span className="arrow">→</span><span className="lbl">now</span>{px(mark)}
                        <span className="op-dollars" style={{ color: upDown(dollars) }}>
                          {dollars == null ? "" : ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct`}
                        </span>
                      </div>
                    </div>
                    {!isOpen && <ProbeSpark points={pts} entry={entry} />}
                    {!isOpen && (
                      <div className="op-legend">
                        <span><i className="dot in" /> in {px(entry)}</span>
                        <span><i className="dot now" style={{ background: upDown(pct) }} /> now {px(mark)}</span>
                        <span className="op-legend-ago">{ago(r.snapshot?.ts)}</span>
                      </div>
                    )}
                    {isOpen && (
                      <div className="op-chartwrap" onClick={(e) => e.stopPropagation()}>
                        <div className="op-toolbar">
                          <div className="op-toggles">
                            {PROBE_RANGES.map((rg) => (
                              <button key={rg.key} type="button" className={`op-tgl${range === rg.key ? " on" : ""}`} onClick={() => changeRange(rg.key)}>{rg.label}</button>
                            ))}
                          </div>
                          <div className="op-toggles">
                            {PROBE_METRICS.map((m) => (
                              <button key={m.key} type="button" className={`op-tgl${metric === m.key ? " on cyan" : ""}`} onClick={() => setMetric(m.key)}>{m.label}</button>
                            ))}
                          </div>
                        </div>
                        {histLoading && !(histFull[r.id]?.length)
                          ? <div className="op-chartempty">Loading history…</div>
                          : <ProbeChart history={histFull[r.id] ?? []} metric={metric} />}
                        <div className="op-charthint">
                          {metric === "mark" ? "Option price (mark)" : PROBE_METRICS.find((m) => m.key === metric)?.label} · RTH only · entry @ {px(entry)} · {ago(r.snapshot?.ts)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="op-note">
            Entry is the fill price you type, or the live mark at the moment you add it if you leave it blank. Prices, greeks and OI come from Theta + Tastytrade through <b>/proxy/probe-rest</b> — the same pipeline the GEX tabs use — and a server-side recorder keeps snapshotting through the session, so the sparkline keeps filling even with this tab closed. Any ticker works. P&amp;L is per single contract (×100).
          </div>
        </div>
      </div>
    </div>
    </PageShell>
  );
}
