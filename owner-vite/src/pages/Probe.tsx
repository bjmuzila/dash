import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
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
  .op-shot { color: var(--text1); border-color: rgba(142,202,230,0.35); background: rgba(142,202,230,0.08); }
  .op-shot:hover { border-color: #8ECAE6; background: rgba(142,202,230,0.16); }
  .op-shot.ok { border-color: rgba(48,209,88,0.6); background: rgba(48,209,88,0.14); color: #30d158; }
  .op-shot.bad { border-color: rgba(255,91,91,0.6); background: rgba(255,91,91,0.12); color: #ff5b5b; }
  .op-sell { display: flex; align-items: center; gap: 6px; font-family: var(--sm-mono); font-size: 12px; }
  .op-sell label { color: var(--text1); letter-spacing: 0.08em; text-transform: uppercase; font-size: 10px; }
  .op-sell input { width: 74px; box-sizing: border-box; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 6px; padding: 4px 8px; font-family: var(--sm-mono); font-size: 12px; }
  .op-sell input:focus { outline: none; border-color: #30d158; }
  .op-sell input.set { border-color: rgba(48,209,88,0.55); background: rgba(48,209,88,0.08); }
  .op-sell .clr { background: none; border: none; color: var(--text1); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
  .op-sell .clr:hover { color: #ff5b5b; }
  .op-badge.sold { color: #30d158; background: rgba(48,209,88,0.12); border: 1px solid rgba(48,209,88,0.45); text-transform: uppercase; letter-spacing: 0.06em; }
  .op-badge.sold.loss { color: #ff5b5b; background: rgba(255,91,91,0.12); border-color: rgba(255,91,91,0.45); }
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

// Snapshots still carry greeks; the card charts price only, so the metric
// toggles (Net GEX / Δ / Θ / V / IV) were removed along with their state.
interface ProbeHistSnap { ts: number; mark: number | null; net_gex: number | null; delta: number | null; theta: number | null; vega: number | null; iv: number | null }
const PROBE_SELL_KEY = "probe-sell-v1";
const PROBE_RANGES: { key: string; label: string }[] = [
  { key: "1d", label: "1D" }, { key: "3d", label: "3D" }, { key: "1w", label: "1W" }, { key: "1m", label: "1M" },
];

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

/**
 * Snapshot numbers are NULLABLE — the probe writes null for any field TT's quote
 * row didn't carry on that poll. `Number(null)` is 0, so mapping a snapshot
 * straight through Number() planted a 0 in the series and the chart drew a wick
 * to the floor. Every read of a snapshot field goes through this.
 */
function opNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Same, but for prices — a mark of 0 or less is a missing quote, not a price. */
function opPx(v: unknown): number | null {
  const n = opNum(v);
  return n != null && n > 0 ? n : null;
}

/**
 * Drop single-sample outliers ("wicks"). Snapshots land ~every 60s and a real
 * move in a contract persists across at least two polls, so a point that jumps
 * far off the line and lands right back where it came from is a bad print — a
 * one-sided book, a stale TT row, a mid computed off half a quote — not price
 * action. Only isolated round-trips are dropped: a spike the next sample
 * confirms (drift between the neighbours) is kept, so real gaps survive.
 */
function opDewick<T>(pts: T[], get: (p: T) => number): T[] {
  if (pts.length < 3) return pts;
  const out: T[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = get(pts[i - 1]), b = get(pts[i]), c = get(pts[i + 1]);
    const base = (a + c) / 2;
    const scale = Math.abs(base);
    if (!(scale > 0)) { out.push(pts[i]); continue; }
    const spike = Math.abs(b - base) / scale;   // how far this sample stands off
    const drift = Math.abs(c - a) / scale;      // how far the line actually moved
    if (spike > 0.45 && drift < 0.15) continue; // stands off, neighbours agree → bad print
    out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * ProbeChart — the option-contract price line. Price only: the metric toggles
 * (Net GEX / Δ / Θ / V / IV) were removed, so this reads `mark` and nothing else.
 *
 * Treatment: ice-blue line over a fading wash, dashed break-even line at the
 * entry fill, the session high marked green and the low red, a right-hand price
 * rail with the live mark in a pill tinted by P/L, and a hover crosshair whose
 * readout carries time, price and $ P/L per contract. Colors are hardcoded here
 * (not CSS vars) on purpose — `captureProbeCard` serializes this SVG standalone
 * for the screenshot, and a var() reference would resolve to nothing off-DOM.
 */
function ProbeChart({ history, entry, sell, chartId }: { history: ProbeHistSnap[]; entry: number | null; sell: number | null; chartId: string }) {
  const W = 960, H = 340, PADL = 12, PADR = 78, PADT = 26, PADB = 30;
  const ICE = "#8ECAE6", GRN = "#30d158", RED = "#ff5b5b";
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const clean = history
    .map((s) => ({ ts: s.ts, v: opPx(s.mark) }))
    .filter((p) => p.v != null) as { ts: number; v: number }[];
  const pts = opDewick(clean, (p) => p.v);
  if (pts.length < 2) {
    return <div className="op-chartempty">Not enough history yet — snapshots accrue every refresh (and through RTH server-side).</div>;
  }

  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const hi = Math.max(...ys), lo = Math.min(...ys);
  const hiI = ys.indexOf(hi), loI = ys.indexOf(lo);
  // Entry (and the exit, once one is typed) have to stay on-canvas or the two
  // lines the P/L is measured between read as off-screen.
  const dom = [...ys];
  if (entry != null && Number.isFinite(entry)) dom.push(entry);
  if (sell != null && Number.isFinite(sell)) dom.push(sell);
  let minY = Math.min(...dom), maxY = Math.max(...dom);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.1; minY -= gpad; maxY += gpad;

  const n = pts.length;
  const sx = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(n - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;

  // Closed position: the pill and the readouts price off the fill you sold at,
  // not the live mark — the contract is no longer yours to mark.
  const last = sell != null && Number.isFinite(sell) ? sell : pts[n - 1].v;
  const lastUp = entry == null ? null : last - entry;
  const pillFill = lastUp == null ? ICE : lastUp >= 0 ? GRN : RED;
  const multiDay = maxX - minX > 20 * 3600_000;
  const fmtT = (ts: number) => multiDay
    ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const MONO = '"Courier New", monospace';

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;          // client px → viewBox units
    const i = Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1));
    setHover(i < 0 ? 0 : i > n - 1 ? n - 1 : i);
  };

  const hp = hover == null ? null : pts[hover];
  const hpl = hp == null || entry == null ? null : (hp.v - entry) * 100;
  // Flip the readout to the left of the crosshair near the right rail.
  const hx = hp == null ? 0 : sx(hover as number);
  const tipW = 168, tipFlip = hx + 12 + tipW > W - PADR;

  return (
    <svg
      ref={svgRef}
      id={chartId}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={`${chartId}-wash`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ICE} stopOpacity={0.22} />
          <stop offset="100%" stopColor={ICE} stopOpacity={0} />
        </linearGradient>
      </defs>

      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
          <text x={W - PADR + 10} y={sy(v) + 4} fontSize={12} fill="#ffffff" fontFamily={MONO}>{v.toFixed(2)}</text>
        </g>
      ))}

      <path d={area} fill={`url(#${chartId}-wash)`} />

      {entry != null && Number.isFinite(entry) && (
        <>
          <line x1={PADL} y1={sy(entry)} x2={W - PADR} y2={sy(entry)} stroke="rgba(255,255,255,0.40)" strokeWidth={1} strokeDasharray="3 5" />
          <text x={PADL + 4} y={sy(entry) - 7} fontSize={11} fill="#ffffff" fontFamily={MONO} letterSpacing="1">ENTRY {entry.toFixed(2)}</text>
        </>
      )}

      <path d={path} fill="none" stroke={ICE} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />

      {sell != null && Number.isFinite(sell) && (
        <>
          <line x1={PADL} y1={sy(sell)} x2={W - PADR} y2={sy(sell)} strokeWidth={1.4}
                stroke={entry != null && sell < entry ? RED : GRN} strokeDasharray="6 4" />
          <text x={PADL + 4} y={sy(sell) - 7} fontSize={11} fontFamily={MONO} letterSpacing="1"
                fill={entry != null && sell < entry ? RED : GRN}>EXIT {sell.toFixed(2)}</text>
        </>
      )}

      <circle cx={sx(hiI)} cy={sy(hi)} r={3.4} fill="none" stroke={GRN} strokeWidth={1.6} />
      <text x={sx(hiI)} y={sy(hi) - 11} fontSize={12} fill={GRN} fontFamily={MONO} textAnchor="middle">H {hi.toFixed(2)}</text>
      <circle cx={sx(loI)} cy={sy(lo)} r={3.4} fill="none" stroke={RED} strokeWidth={1.6} />
      <text x={sx(loI)} y={sy(lo) + 18} fontSize={12} fill={RED} fontFamily={MONO} textAnchor="middle">L {lo.toFixed(2)}</text>

      <text x={PADL} y={H - 8} fontSize={12} fill="#ffffff" fontFamily={MONO}>{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 8} fontSize={12} fill="#ffffff" fontFamily={MONO} textAnchor="end">{fmtT(maxX)}</text>

      <circle cx={sx(n - 1)} cy={sy(last)} r={3.6} fill={pillFill} />
      <rect x={W - PADR + 4} y={sy(last) - 11} width={62} height={22} rx={5} fill={pillFill} />
      <text x={W - PADR + 35} y={sy(last) + 4} fontSize={13} fontWeight={700} fill="#06090d" fontFamily={MONO} textAnchor="middle">{last.toFixed(2)}</text>

      {hp != null && (
        <g>
          <line x1={hx} y1={PADT} x2={hx} y2={H - PADB} stroke="rgba(255,255,255,0.32)" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={hx} cy={sy(hp.v)} r={4} fill="#05060a" stroke={ICE} strokeWidth={2} />
          <g transform={`translate(${tipFlip ? hx - 12 - tipW : hx + 12},${Math.max(PADT, sy(hp.v) - 46)})`}>
            <rect width={tipW} height={44} rx={7} fill="rgba(10,13,20,0.96)" stroke="rgba(48,209,88,0.45)" strokeWidth={1} />
            <text x={12} y={18} fontSize={11} fill="#ffffff" fontFamily={MONO} letterSpacing="1">{fmtT(hp.ts)}</text>
            <text x={12} y={35} fontSize={15} fontWeight={700} fill="#ffffff" fontFamily={MONO}>${hp.v.toFixed(2)}</text>
            {hpl != null && (
              <text x={92} y={35} fontSize={13} fontWeight={700} fill={hpl >= 0 ? GRN : RED} fontFamily={MONO}>
                {hpl >= 0 ? "+" : "−"}${Math.abs(hpl).toFixed(0)}
              </text>
            )}
          </g>
        </g>
      )}
    </svg>
  );
}

/**
 * captureProbeCard — PNG of one probe card, no dependency on html2canvas.
 *
 * The chart is already an SVG with hardcoded colors, so it rasterizes cleanly
 * through an <img> + canvas. The header (ticker, %, entry→now, P/L) is painted
 * on with fillText rather than cloned from the DOM, which keeps the export
 * identical across browsers instead of inheriting whatever the page computed.
 * Downloads the file and, where the browser allows it, also puts the PNG on the
 * clipboard so it can be pasted straight into Discord.
 */
async function captureProbeCard(chartId: string, meta: {
  ticker: string; badge: string; exp: string; pct: number | null;
  entry: number | null; mark: number | null; dollars: number | null;
  closed: boolean; hint: string;
}): Promise<boolean> {
  const svg = document.getElementById(chartId) as SVGSVGElement | null;
  if (!svg) return false;
  const SCALE = 2, CW = 1000, HEAD = 132, CH = HEAD + 360;
  const MONO = '"Courier New", monospace';
  const GRN = "#30d158", RED = "#ff5b5b";
  const tone = (v: number | null | undefined) => (v == null ? "#ffffff" : v > 0 ? GRN : v < 0 ? RED : "#ffffff");
  const px = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "960");
  clone.setAttribute("height", "340");
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("svg rasterize failed"));
      img.src = url;
    });

    const cv = document.createElement("canvas");
    cv.width = CW * SCALE; cv.height = CH * SCALE;
    const ctx = cv.getContext("2d");
    if (!ctx) return false;
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "#0d1119";
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(0.5, 0.5, CW - 1, CH - 1);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 26px ${MONO}`;
    ctx.fillText(meta.ticker, 26, 44);
    const tw = ctx.measureText(meta.ticker).width;
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = "#8ECAE6";
    ctx.fillText(meta.badge, 26 + tw + 12, 43);

    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(meta.exp, 26, 68);

    ctx.font = `800 34px ${MONO}`;
    ctx.fillStyle = tone(meta.pct);
    ctx.fillText(meta.pct == null ? "—" : `${meta.pct >= 0 ? "▲" : "▼"} ${Math.abs(meta.pct).toFixed(1)}%`, 26, 110);

    ctx.font = `15px ${MONO}`;
    ctx.fillStyle = "#ffffff";
    const line = `IN ${px(meta.entry)} → ${meta.closed ? "SOLD" : "NOW"} ${px(meta.mark)}`;
    ctx.fillText(line, 210, 108);
    if (meta.dollars != null) {
      ctx.fillStyle = tone(meta.dollars);
      ctx.font = `700 15px ${MONO}`;
      ctx.fillText(` ${meta.dollars >= 0 ? "+" : "−"}$${Math.abs(meta.dollars).toFixed(0)}/ct`, 210 + ctx.measureText(line).width + 14, 108);
    }

    ctx.drawImage(img, 20, HEAD - 8, 960, 340);

    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(meta.hint, 26, CH - 14);

    const png: Blob | null = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!png) return false;

    // Clipboard only — nothing is written to disk. Firefox ships no
    // ClipboardItem, so the button reports a miss rather than silently no-oping.
    const C = (window as unknown as { ClipboardItem?: new (i: Record<string, Blob>) => unknown }).ClipboardItem;
    if (!C || !navigator.clipboard || !("write" in navigator.clipboard)) return false;
    await (navigator.clipboard as unknown as { write: (d: unknown[]) => Promise<void> })
      .write([new C({ "image/png": png })]);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
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
  const [shotId, setShotId] = useState<number | null>(null);
  const [shotOk, setShotOk] = useState(true);
  /**
   * Sell price per contract — the fill you closed at. Kept in localStorage, not
   * on the watch row: /api/watch only speaks add / refresh / remove, so posting
   * an exit would mean a new server action and a column migration. Once a sell
   * is set the card stops marking to the live quote and reports the realized
   * number instead.
   */
  const [sellById, setSellById] = useState<Record<number, number>>(() => {
    try {
      const raw = localStorage.getItem(PROBE_SELL_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? (o as Record<number, number>) : {};
    } catch { return {}; }
  });
  const [sellDraft, setSellDraft] = useState<Record<number, string>>({});
  const commitSell = useCallback((id: number, raw: string) => {
    const v = parseFloat(raw);
    setSellById((prev) => {
      const next = { ...prev };
      if (raw.trim() === "" || !Number.isFinite(v) || v <= 0) delete next[id];
      else next[id] = v;
      try { localStorage.setItem(PROBE_SELL_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
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

  /**
   * Prefill from the query string.
   *
   * The Quick Probe card in the customer app's Notes drawer
   * (components/shared/QuickProbe.tsx) hands a contract off to this page as
   * `?ticker=SPX&exp=2026-08-21&strike=6400&side=C` (`fill` and `note` are
   * accepted too, for anything else that wants to link here). We fill the
   * structured inputs AND the shorthand box — the shorthand box is what the
   * eye lands on, and leaving it blank while the fields below are populated
   * reads like the handoff half-failed.
   *
   * Runs once on mount and then strips the query with replaceState, so a
   * refresh doesn't silently re-arm a contract the owner already dealt with.
   * Nothing is submitted — the fields are staged and Add is still a click.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const sym = (q.get("ticker") || "").trim().toUpperCase();
    const exp = (q.get("exp") || q.get("expiration") || "").trim().slice(0, 10);
    const k = parseFloat(q.get("strike") || "");
    const rawSide = (q.get("side") || "").trim().toUpperCase();
    const sd: "C" | "P" | null = rawSide.startsWith("C") ? "C" : rawSide.startsWith("P") ? "P" : null;
    if (!sym && !exp && !Number.isFinite(k)) return;

    if (sym) setTicker(sym);
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) setExpiry(exp);
    if (Number.isFinite(k) && k > 0) setStrike(String(k));
    if (sd) setSide(sd);

    const f = parseFloat(q.get("fill") || "");
    if (Number.isFinite(f) && f > 0) setFill(String(f));
    const n = (q.get("note") || "").trim();
    if (n) setNote(n);

    if (sym && /^\d{4}-\d{2}-\d{2}$/.test(exp) && Number.isFinite(k) && k > 0 && sd) {
      const [, mo, da] = exp.split("-");
      setShorthand(`${sym} ${k}${sd.toLowerCase()} ${parseInt(mo, 10)}/${parseInt(da, 10)}/${exp.slice(2, 4)}`);
    }

    try {
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    } catch { /* non-browser / blocked history */ }
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
        // mark is null on any poll TT didn't quote — keep those out entirely
        // rather than letting Number(null)===0 draw a wick to the floor.
        const raw = (Array.isArray(j.history) ? j.history : [])
          .map((s: { ts: number | string; mark: number | null; last?: number | null }) =>
            ({ ts: opNum(s.ts), mark: opPx(s.mark) ?? opPx(s.last) }))
          .filter((p: { ts: number | null; mark: number | null }) => p.ts != null && p.mark != null)
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts) as { ts: number; mark: number }[];
        const pts = opDewick(raw, (p) => p.mark);
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
          mark: opPx(s.mark) ?? opPx(s.last),
          net_gex: opNum(s.net_gex),
          delta: opNum(s.delta),
          theta: opNum(s.theta),
          vega: opNum(s.vega),
          iv: opPx(s.iv),
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
                const entry = opPx(r.added_price);
                const hist = (historyById[r.id] ?? []).filter((h) => opIsRth(h.ts));
                // The newest snapshot can carry a null mark (TT didn't quote that
                // poll). Fall back to last, then to the last good recorded print,
                // so the card holds the price instead of blanking to "—".
                const liveMark = opPx(r.snapshot?.mark) ?? opPx(r.snapshot?.last);
                const mark = liveMark ?? (hist.length ? hist[hist.length - 1].mark : null);
                // A closed position prices off the sell fill, not the live mark.
                const sell = sellById[r.id] ?? null;
                const effMark = sell ?? mark;
                const pct = entry != null && effMark != null && entry !== 0 ? ((effMark - entry) / entry) * 100 : null;
                const dollars = entry != null && effMark != null ? (effMark - entry) * 100 : null;
                const liveTs = Number(r.snapshot?.ts);
                const pts = liveMark != null && Number.isFinite(liveTs) && opIsRth(liveTs) && (!hist.length || liveTs > hist[hist.length - 1].ts)
                  ? [...hist, { ts: liveTs, mark: liveMark }]
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
                        {sell != null && <span className={`op-badge sold${dollars != null && dollars < 0 ? " loss" : ""}`}>Sold {sell.toFixed(2)}</span>}
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
                        <span className="lbl">in</span>{px(entry)}<span className="arrow">→</span><span className="lbl">{sell != null ? "sold" : "now"}</span>{px(effMark)}
                        <span className="op-dollars" style={{ color: upDown(dollars) }}>
                          {dollars == null ? "" : ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct`}
                        </span>
                      </div>
                    </div>
                    {!isOpen && <ProbeSpark points={pts} entry={entry} />}
                    {!isOpen && (
                      <div className="op-legend">
                        <span><i className="dot in" /> in {px(entry)}</span>
                        <span><i className="dot now" style={{ background: upDown(pct) }} /> {sell != null ? "sold" : "now"} {px(effMark)}</span>
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
                          <div className="op-sell">
                            <label htmlFor={`op-sell-${r.id}`}>Sell</label>
                            <input
                              id={`op-sell-${r.id}`}
                              className={sell != null ? "set" : ""}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="—"
                              value={sellDraft[r.id] ?? (sell != null ? String(sell) : "")}
                              onChange={(e) => setSellDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                              onBlur={(e) => commitSell(r.id, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                            {sell != null && (
                              <button
                                type="button"
                                className="clr"
                                title="Clear the sell price and go back to marking live"
                                onClick={() => { setSellDraft((d) => ({ ...d, [r.id]: "" })); commitSell(r.id, ""); }}
                              >×</button>
                            )}
                            <button
                              type="button"
                              className={`op-tgl op-shot${shotId === r.id ? (shotOk ? " ok" : " bad") : ""}`}
                              title="Copy this card to the clipboard as a PNG"
                              onClick={() => {
                                void captureProbeCard(`probe-chart-${r.id}`, {
                                  ticker: r.ticker,
                                  badge: `${r.strike % 1 ? r.strike : Math.round(r.strike)}${r.side}`,
                                  exp: fmtExp(r.expiration),
                                  pct, entry, mark: effMark, dollars,
                                  closed: sell != null,
                                  hint: `Option price (mark) · RTH only · entry @ ${px(entry)}${sell != null ? ` · sold @ ${px(sell)}` : ""}`,
                                }).then((ok) => {
                                  setShotOk(ok); setShotId(r.id);
                                  setTimeout(() => setShotId(null), 1600);
                                });
                              }}
                            >
                              {shotId === r.id ? (shotOk ? "✓ Copied" : "✗ Copy failed") : "⧉ Copy image"}
                            </button>
                          </div>
                        </div>
                        {histLoading && !(histFull[r.id]?.length)
                          ? <div className="op-chartempty">Loading history…</div>
                          : <ProbeChart history={histFull[r.id] ?? []} entry={entry} sell={sell} chartId={`probe-chart-${r.id}`} />}
                        <div className="op-charthint">
                          Option price (mark) · RTH only · entry @ {px(entry)}{sell != null ? ` · sold @ ${px(sell)}` : ""} · {ago(r.snapshot?.ts)}
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
