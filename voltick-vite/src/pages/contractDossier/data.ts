/**
 * Contract Dossier · data layer.
 *
 * Every number on the page comes from a route the CB Edge backend already
 * serves. Nothing here adds a route, a table or a vendor call of its own:
 *
 *   /api/watch                 the owner's probe watchlist (same list as
 *                              owner.cbedge.net/owner/probe). GET lists rows with
 *                              their latest snapshot; ?history=<id>&range=1m
 *                              returns the snapshot series recorded since the
 *                              contract was added. POST add / remove / refresh.
 *                              OWNER ONLY: anyone else gets a 401/403 and the page
 *                              falls back to look-up mode.
 *   /proxy/option-history      dxLink candles for ONE contract over any window.
 *                              This is the history from BEFORE the contract was
 *                              added. Interval scales with the span on the server
 *                              (5m to 3d, 15m to 10d, 1h to 30d, 4h beyond).
 *   /proxy/probe-rest          the live quote + greeks for one contract (TT).
 *   /api/walls-range           call wall, put wall and CB per session for the
 *                              scanner universe (change-only log, carried forward
 *                              here to the latest value).
 *
 * Open interest and IV only exist from the day a contract was added: dxLink
 * candles carry price and volume, not OI or IV, and CB Edge keeps no
 * per-contract OI series a browser can read. The page says so instead of
 * drawing a line it does not have.
 */

export type Side = "C" | "P";

export interface Contract {
  ticker: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  side: Side;
}

export interface WatchSnapshot {
  ts: number;
  spot: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  last: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  open_interest: number | null;
  volume: number | null;
  net_gex: number | null;
  prev_close: number | null;
}

export interface WatchRow extends Contract {
  id: number;
  note: string | null;
  added_price: number | null;
  created_at: number | null; // epoch ms
  snapshot: WatchSnapshot | null;
}

export interface Bar {
  t: number; // epoch ms, bucket start
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Live {
  mark: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  iv: number | null; // decimal, 0.62 = 62%
  delta: number | null;
  theta: number | null;
  gamma: number | null;
  oi: number | null;
  volume: number | null;
  spot: number | null;
  prevClose: number | null;
}

export interface Levels {
  callWall: number | null;
  putWall: number | null;
  cb: number | null;
  date: string | null;
}

/* ── small helpers ────────────────────────────────────────────────────────── */

export const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const toMs = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
};

export const sameContract = (a: Contract, b: Contract) =>
  a.ticker === b.ticker && a.expiry === b.expiry && a.side === b.side && Math.abs(a.strike - b.strike) < 1e-6;

export const contractKey = (c: Contract) => `${c.ticker}|${c.expiry}|${c.strike}|${c.side}`;

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
export const etDay = (ms: number) => ET_DAY.format(ms);
export const todayEt = () => etDay(Date.now());

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dte(expiry: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${todayEt()}T00:00:00Z`)) / 86_400_000);
}

/* ── shortcut parser ("TSLA 420c 7/17") · same grammar as /owner/probe ─────── */

export function parseContract(raw: string): Contract | null {
  const s = raw.trim();
  if (!s) return null;
  const tickerM = s.match(/^\/?([A-Za-z.]{1,6})/);
  if (!tickerM) return null;
  const ticker = tickerM[1].toUpperCase();
  const rest = s.slice(tickerM[0].length);

  let strike: number | null = null;
  let side: Side | null = null;
  const cs = rest.match(/(\d+(?:\.\d+)?)\s*([cCpP])(?![A-Za-z])/);
  if (cs) {
    strike = parseFloat(cs[1]);
    side = cs[2].toUpperCase() as Side;
  } else {
    const sideM = rest.match(/\b(call|put|c|p)\b/i);
    const strikeM = rest.match(/(\d+(?:\.\d+)?)(?![\d/-])/);
    if (sideM) side = /^(c|call)$/i.test(sideM[1]) ? "C" : "P";
    if (strikeM) strike = parseFloat(strikeM[1]);
  }

  let expiry: string | null = null;
  const iso = rest.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const md = rest.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (iso) {
    expiry = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  } else if (md) {
    const mo = parseInt(md[1], 10);
    const da = parseInt(md[2], 10);
    let yr = md[3] ? parseInt(md[3], 10) : NaN;
    if (md[3] && md[3].length === 2) yr = 2000 + yr;
    if (!Number.isFinite(yr)) {
      const today = todayEt();
      yr = Number(today.slice(0, 4));
      const cand = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      if (cand < today) yr += 1; // an M/D that already passed rolls to next year
    }
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      expiry = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }
  if (!strike || !side || !expiry) return null;
  return { ticker, strike, side, expiry };
}

/* ── fetch plumbing ───────────────────────────────────────────────────────── */

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    // nginx's SPA fallback answers an unproxied path with index.html
    throw new HttpError(r.status, r.ok ? "the backend answered with a page, not data" : `HTTP ${r.status}`);
  }
  const j = await r.json();
  if (!r.ok) throw new HttpError(r.status, String((j && (j.error || j.message)) || `HTTP ${r.status}`));
  return j as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status, String((j && (j.error || j.message)) || `HTTP ${r.status}`));
  return j as T;
}

/* ── /api/watch ───────────────────────────────────────────────────────────── */

function readSnap(s: Record<string, unknown> | null | undefined): WatchSnapshot | null {
  if (!s) return null;
  const ts = toMs(s.ts);
  if (ts == null) return null;
  return {
    ts,
    spot: num(s.spot),
    bid: num(s.bid),
    ask: num(s.ask),
    mark: num(s.mark),
    last: num(s.last),
    iv: num(s.iv),
    delta: num(s.delta),
    gamma: num(s.gamma),
    theta: num(s.theta),
    vega: num(s.vega),
    open_interest: num(s.open_interest),
    volume: num(s.volume),
    net_gex: num(s.net_gex),
    prev_close: num(s.prev_close),
  };
}

function readRow(r: Record<string, unknown>): WatchRow {
  return {
    id: Number(r.id),
    ticker: String(r.ticker || "").toUpperCase(),
    expiry: String(r.expiration || "").slice(0, 10),
    strike: Number(r.strike),
    side: String(r.side || "C").toUpperCase() === "P" ? "P" : "C",
    note: r.note ? String(r.note) : null,
    added_price: num(r.added_price),
    created_at: toMs(r.created_at),
    snapshot: readSnap(r.snapshot as Record<string, unknown> | null),
  };
}

export async function fetchWatchlist(signal?: AbortSignal): Promise<WatchRow[]> {
  const j = await getJson<{ rows?: Record<string, unknown>[] }>("/api/watch", signal);
  return (j.rows || []).map(readRow).filter((r) => r.ticker && r.expiry && Number.isFinite(r.strike));
}

export async function fetchWatchHistory(id: number, signal?: AbortSignal): Promise<WatchSnapshot[]> {
  const j = await getJson<{ history?: Record<string, unknown>[] }>(`/api/watch?history=${id}&range=1m`, signal);
  return (j.history || []).map(readSnap).filter((s): s is WatchSnapshot => s != null).sort((a, b) => a.ts - b.ts);
}

export async function addToWatch(c: Contract, addedPrice?: number | null): Promise<void> {
  await postJson("/api/watch", {
    action: "add",
    ticker: c.ticker,
    expiry: c.expiry,
    strike: c.strike,
    side: c.side,
    ...(addedPrice && addedPrice > 0 ? { addedPrice } : {}),
  });
}

export async function removeFromWatch(id: number): Promise<void> {
  await postJson("/api/watch", { action: "remove", id });
}

export async function refreshWatch(): Promise<WatchRow[]> {
  const j = await postJson<{ rows?: Record<string, unknown>[] }>("/api/watch", { action: "refresh" });
  return (j.rows || []).map(readRow);
}

/* ── /proxy/option-history ────────────────────────────────────────────────── */

export type RangeKey = "5d" | "1m" | "3m";
export const RANGE_DAYS: Record<RangeKey, number> = { "5d": 7, "1m": 30, "3m": 92 };

export async function fetchBars(c: Contract, range: RangeKey, signal?: AbortSignal): Promise<{ bars: Bar[]; interval: string; start: string }> {
  const end = todayEt();
  // Never ask for days after expiry, and never for a window that ends before it starts.
  const last = c.expiry < end ? c.expiry : end;
  const start = addDays(last, -RANGE_DAYS[range]);
  const q = new URLSearchParams({
    ticker: c.ticker,
    expiry: c.expiry,
    strike: String(c.strike),
    type: c.side,
    start,
    end: last,
  });
  const j = await getJson<{ bars?: Record<string, unknown>[]; interval?: string }>(`/proxy/option-history?${q}`, signal);
  const bars: Bar[] = [];
  for (const b of j.bars || []) {
    const t = toMs(b.time);
    const cl = Number(b.close);
    if (t == null || !(cl > 0)) continue;
    const o = Number(b.open) > 0 ? Number(b.open) : cl;
    const h = Math.max(Number(b.high) > 0 ? Number(b.high) : cl, o, cl);
    const l = Math.min(Number(b.low) > 0 ? Number(b.low) : cl, o, cl);
    bars.push({ t, o, h, l, c: cl, v: Number(b.volume) > 0 ? Number(b.volume) : 0 });
  }
  bars.sort((a, b) => a.t - b.t);
  return { bars, interval: String(j.interval || ""), start };
}

/**
 * Roll intraday bars into one candle per ET session. Volume per candle is the
 * SUM of the bars' volumes: candle-history keeps the max (cumulative) volume
 * WITHIN a bar, so each bar's volume is that bar's own, and a day is their sum.
 */
export function toDaily(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curDay = "";
  for (const b of bars) {
    const d = etDay(b.t);
    if (!cur || d !== curDay) {
      if (cur) out.push(cur);
      cur = { t: Date.parse(`${d}T13:30:00Z`), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curDay = d;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Roll bars into fixed buckets (an hour for the 5D view). UTC hour edges are ET hour edges. */
export function toBuckets(bars: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || k !== cur.t) {
      if (cur) out.push(cur);
      cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ── /proxy/probe-rest ────────────────────────────────────────────────────── */

export async function fetchLive(c: Contract, signal?: AbortSignal): Promise<Live | null> {
  const q = new URLSearchParams({ ticker: c.ticker, expiry: c.expiry, type: c.side, strike: String(c.strike) });
  type Probe = {
    found?: boolean;
    status?: string;
    availableExpirations?: string[];
    result?: {
      feeds?: Record<string, Record<string, unknown>>;
      exposures?: Record<string, unknown>;
    };
  };
  const j = await getJson<Probe>(`/proxy/probe-rest?${q}`, signal);
  if (!j.found || !j.result) {
    if (j.status === "no-expiry" && j.availableExpirations?.length) {
      throw new HttpError(404, `${c.ticker} lists no ${c.expiry} expiration`);
    }
    return null;
  }
  const f = j.result.feeds || {};
  const qt = f.Quote || {};
  const tr = f.Trade || {};
  const su = f.Summary || {};
  const g = f.Greeks || {};
  const ex = j.result.exposures || {};
  const bid = num(qt.bid);
  const ask = num(qt.ask);
  let mark = num(qt.mark) ?? num(qt.mid);
  // Same sanity rule /api/watch applies: a mark outside one spread of the book is a bad print.
  if (bid != null && ask != null && ask >= bid) {
    const mid = (bid + ask) / 2;
    if (mark == null || mark < bid - (ask - bid) || mark > ask + (ask - bid)) mark = mid;
  }
  return {
    mark,
    bid,
    ask,
    last: num(tr.last),
    iv: num(g.iv) ?? num(g.bsIv),
    delta: num(g.delta) ?? num(g.bsDelta),
    theta: num(g.theta) ?? num(g.bsTheta),
    gamma: num(g.gamma) ?? num(g.bsGamma),
    oi: num(su.openInterest) ?? num(ex.oi),
    volume: num(tr.volume) ?? num(ex.volume),
    spot: num(ex.spot),
    prevClose: num(su.prevClose),
  };
}

/* ── /api/walls-range ─────────────────────────────────────────────────────── */

export async function fetchLevels(ticker: string, signal?: AbortSignal): Promise<Levels | null> {
  const q = new URLSearchParams({ symbol: ticker, days: "1" });
  type Day = { date: string; log?: { level_type: string; strike: number | string; slot: number }[]; spot?: [number, number][] };
  const j = await getJson<{ ok?: boolean; days?: Day[] }>(`/api/walls-range?${q}`, signal);
  const day = (j.days || []).slice(-1)[0];
  if (!day || !day.log?.length) return null;
  // Change-only log: slot 0 pins the baseline, later slots only what moved. The
  // latest value per level is the last row for it in slot order.
  const last: Record<string, number> = {};
  for (const r of [...day.log].sort((a, b) => a.slot - b.slot)) {
    const k = Number(r.strike);
    if (Number.isFinite(k) && k > 0) last[r.level_type] = k;
  }
  return {
    callWall: last.call_wall ?? null,
    putWall: last.put_wall ?? null,
    cb: last.cb ?? null,
    date: day.date || null,
  };
}

/* ── formatting ───────────────────────────────────────────────────────────── */

export const fmtPx = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "·" : v.toFixed(d));

export function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "·";
  return `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(d)}%`;
}

export function fmtSigned(v: number | null | undefined, d = 1, unit = "%"): string {
  if (v == null || !Number.isFinite(v)) return "·";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}${unit}`;
}

export function fmtBig(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "·";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "+";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export function fmtCount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "·";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return Math.round(v).toLocaleString("en-US");
}

/** IV arrives as a decimal (TT `implied-volatility`, 0.62 = 62%). Guard a feed that sends percent. */
export const ivPct = (iv: number | null | undefined) => (iv == null ? null : iv > 5 ? iv : iv * 100);

const MD = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });
const MDT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtMD = (ms: number) => MD.format(ms);
export const fmtMDT = (ms: number) => MDT.format(ms);

export function fmtExpiry(expiry: string): string {
  const d = new Date(`${expiry}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
}

export const label = (c: Contract) => `${c.ticker} ${c.strike % 1 ? c.strike : c.strike.toFixed(0)}${c.side}`;
