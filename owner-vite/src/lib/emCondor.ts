/**
 * emCondor.ts — Estimated-Move engine + iron-condor strike builder.
 *
 * The EM half is a trimmed port of the engine inside src/pages/EstimatedMove.tsx.
 * It is deliberately a COPY, not a refactor: EstimatedMove.tsx is the published
 * weekly source of truth and is left completely untouched by this test page.
 * Two differences from the original:
 *   1. No futures (ESM / NQM) — the IC roster is equities, ETFs and cash
 *      indices only, so the FUTURE_PROXY / basis branches are gone.
 *   2. estimateMoveIC() additionally returns the sorted list of LISTED strikes
 *      for the expiration, which the condor builder snaps its legs onto.
 */

// ── Roster ──────────────────────────────────────────────────────────────────
// The Estimated Moves main roster minus the two futures rows (ESU / NQU).
export const IC_SYMBOLS = [
  "SPY", "QQQ", "SPX", "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT",
  "NVDA", "TSLA", "COIN", "HOOD", "IWM", "NDX", "NFLX", "SMH", "PLTR",
];

const API_SYMBOL: Record<string, string> = { SPX: "$SPX", NDX: "$NDX" };
const CHAIN_SYMBOL: Record<string, string> = { SPX: "$SPX", NDX: "$NDX" };

const QUOTE_SYMBOLS = Array.from(new Set([...IC_SYMBOLS, ...Object.values(API_SYMBOL)]));

const API = {
  quotesBatch: () => `/api/quotes-batch`,
  expirations: (ticker: string) => `/api/expirations?ticker=${encodeURIComponent(ticker)}`,
  chain: (sym: string, exp: string, extra = "") =>
    `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}${extra}`,
  optionMarks: (symbols: string) =>
    `/api/em/option-marks?symbols=${encodeURIComponent(symbols)}`,
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface OptionData {
  symbol: string;
  expiration: string;
  strike: number;
  type: "CALL" | "PUT";
  bid: number;
  ask: number;
  last: number;
  mark: number;
  iv: number;
  dte: number;
}

export interface EMQuote {
  ticker: string;
  close: number;
  em: number;
  up: number;
  down: number;
  expiration: string;
  strike: number;
  /** Every listed strike at `expiration`, ascending. Legs snap onto these. */
  strikes: number[];
}

export interface CondorRow {
  ticker: string;
  error?: string;
  close?: number;
  em?: number;
  emPct?: number;
  expiration?: string;
  dte?: number;
  longPut?: number;
  shortPut?: number;
  shortCall?: number;
  longCall?: number;
  putWidth?: number;
  callWidth?: number;
  step?: number;
  putOtmPct?: number;
  callOtmPct?: number;
  /** Untruncated targets before snapping to listed strikes. */
  rawDown?: number;
  rawUp?: number;
}

export interface EMEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quoteCache: Record<string, any>;
  quoteCacheTime: number;
  directChainCache: Record<string, OptionData[]>;
}

export function makeEngine(): EMEngine {
  return { quoteCache: {}, quoteCacheTime: 0, directChainCache: {} };
}

// ── Small helpers ───────────────────────────────────────────────────────────

export function daysTo(exp: string): number {
  return Math.ceil((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86400000);
}

export function labelForDate(exp: string | undefined): string {
  if (!exp) return "--";
  return new Date(exp + "T12:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

export function fmtNum(n: number | undefined, dp = 2): string {
  if (n === undefined || !Number.isFinite(n)) return "--";
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function mid(o: OptionData): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
}

// ── Chain normalization (verbatim port) ─────────────────────────────────────

export function normalizeOptions(chain: unknown): OptionData[] {
  const flat: OptionData[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = Array.isArray((chain as any)?.options) ? (chain as any).options : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  direct.forEach((o: any) => {
    flat.push({
      symbol: o.symbol || o.optionSymbol || "",
      expiration: o.expiration || o.expirationDate,
      strike: Number(o.strike || o.strikePrice),
      type: String(o.optionType || o.type || "").toUpperCase() as "CALL" | "PUT",
      bid: Number(o.bid || o.bidPrice || o["bid-price"] || 0),
      ask: Number(o.ask || o.askPrice || o["ask-price"] || 0),
      last: Number(o.last || o["last-price"] || o.lastPrice || 0),
      mark: Number(o.mark || o["mark-price"] || o["mid-price"] || o.midPrice || 0),
      iv: Number(o.iv || o.impliedVolatility || o["implied-volatility"] || o.volatility || 0),
      dte: Number(o.dte || o.daysToExpiration || 0),
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nestedItems = Array.isArray((chain as any)?.data?.items) ? (chain as any).data.items : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nestedItems.forEach((expGroup: any) => {
    const expiration = expGroup?.["expiration-date"] || expGroup?.expirationDate || expGroup?.expiration;
    const strikes = Array.isArray(expGroup?.strikes) ? expGroup.strikes : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strikes.forEach((strikeRow: any) => {
      const strike = Number(strikeRow?.["strike-price"] || strikeRow?.strikePrice || strikeRow?.strike);
      (["call", "put"] as const).forEach((side) => {
        const leg = strikeRow?.[side];
        if (!leg) return;
        flat.push({
          symbol: leg.symbol || "",
          expiration,
          strike,
          type: side.toUpperCase() as "CALL" | "PUT",
          bid: Number(leg.bid || leg.bidPrice || leg["bid-price"] || 0),
          ask: Number(leg.ask || leg.askPrice || leg["ask-price"] || 0),
          last: Number(leg.last || leg["last-price"] || leg.lastPrice || 0),
          mark: Number(leg.mark || leg["mark-price"] || leg["mid-price"] || leg.midPrice || 0),
          iv: Number(leg.iv || leg["implied-volatility"] || leg.impliedVolatility || leg.volatility || 0),
          dte: Number(leg.dte || leg.daysToExpiration || daysTo(expiration)),
        });
      });
    });
  });

  return flat.filter((o) => o.expiration && Number.isFinite(o.strike));
}

/** Broker's underlying spot from the chain payload — strikes are in THIS scale. */
export function chainUnderlyingPrice(chain: unknown): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = chain as any;
  const v = Number(
    c?.data?.underlyingPrice ?? c?.underlyingPrice ??
    c?.data?.underlying_price ?? c?.underlying_price ?? 0
  );
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ── Quotes ──────────────────────────────────────────────────────────────────

async function fetchAllQuotes(engine: EMEngine) {
  if (Date.now() - engine.quoteCacheTime < 5000) return engine.quoteCache;
  const r = await fetch(`${API.quotesBatch()}?symbols=${encodeURIComponent(QUOTE_SYMBOLS.join(","))}`);
  if (!r.ok) throw new Error("quotes-batch failed");
  const json = await r.json();
  const items: unknown[] = json?.data?.items || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items.forEach((q: any) => { map[q.symbol] = q; });
  const aliases: Record<string, string[]> = { SPX: ["$SPX"], NDX: ["$NDX"] };
  Object.entries(aliases).forEach(([key, list]) => {
    for (const alias of list) {
      if (map[alias]) { map[key] = map[alias]; break; }
    }
  });
  engine.quoteCache = map;
  engine.quoteCacheTime = Date.now();
  return map;
}

async function fetchQuoteDetail(ticker: string, engine: EMEngine) {
  const dxSym = API_SYMBOL[ticker] || ticker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quotes: Record<string, any> = await fetchAllQuotes(engine);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priced = (x: any) =>
    x && Number.isFinite(Number(x.last ?? x.mark ?? x["prev-close"] ?? x.prevClose ?? x["day-close"]))
      && Number(x.last ?? x.mark ?? x["prev-close"] ?? x.prevClose ?? x["day-close"]) > 0;
  const candidates = [
    quotes[dxSym], quotes[ticker],
    quotes[String(dxSym).replace(/^\//, "")],
    quotes[String(ticker).replace(/^\//, "")],
    quotes[String(dxSym).replace(/^\$/, "")],
  ];
  const q = candidates.find(priced) || candidates.find(Boolean);
  if (!q) throw new Error(`${ticker} not in quotes-batch`);
  const prevClose = Number(q["prev-close"] || q.prevClose || 0);
  const isIndex = ticker === "SPX" || ticker === "NDX";
  const close = isIndex && prevClose > 0
    ? prevClose
    : Number(q.last || q.mark || ((q.bid + q.ask) / 2));
  if (!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { close, prevClose };
}

async function fetchOptionMarks(symbols: string[]) {
  const cleaned = symbols.map((s) => String(s || "").trim()).filter(Boolean);
  if (!cleaned.length) return {};
  const r = await fetch(API.optionMarks(cleaned.join(",")));
  if (!r.ok) return {};
  const json = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (json?.data?.items || []).forEach((item: any) => { if (item?.symbol) map[item.symbol] = item; });
  return map;
}

async function fetchChainDirect(chainSym: string, targetExp: string, engine: EMEngine): Promise<OptionData[] | null> {
  const key = `${chainSym}:${targetExp}`;
  if (engine.directChainCache[key]) return engine.directChainCache[key];
  const urls = [
    API.chain(chainSym, targetExp, "&noSubscribe=1"),
    `/api/chains?ticker=${encodeURIComponent(chainSym)}&expiration=${encodeURIComponent(targetExp)}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const opts = normalizeOptions(await r.json()).filter((o) => o.expiration === targetExp);
      if (opts.length) {
        engine.directChainCache[key] = opts;
        return opts;
      }
    } catch { /* try the next shape */ }
  }
  return null;
}

// ── Expirations ─────────────────────────────────────────────────────────────

export function getTargetExpiration(knownExpirations: string[], expOverride: string): string {
  if (expOverride) return expOverride;
  if (knownExpirations.length) {
    const inRange = knownExpirations.filter((exp) => {
      const d = daysTo(exp);
      return d >= 1 && d <= 10;
    });
    const friday = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 5);
    if (friday) return friday;
    const thursday = inRange.find((exp) => new Date(exp + "T12:00:00").getDay() === 4);
    if (thursday) return thursday;
    if (inRange[0]) return inRange[0];
    return knownExpirations[0];
  }
  return "";
}

/** SPX weekly expirations, newest-first-filtered, for the toolbar picker. */
export async function loadExpirations(): Promise<{ all: string[]; weeklies: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseExps = (json: any): string[] => {
    let raw: unknown[] = json?.expirations || json?.data?.expirations || json?.data?.items || json?.items || [];
    if (raw.length && typeof raw[0] === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      raw = (raw as any[]).map((e) => e["expiration-date"] || e.expirationDate || e.expiration || e.date || e);
    }
    const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    return (raw as string[])
      .filter((e) => typeof e === "string")
      .filter((e) => e.slice(0, 10) >= todayET)
      .sort();
  };

  let exps: string[] = [];
  const r = await fetch(API.expirations("SPX"));
  if (r.ok) exps = parseExps(await r.json());

  if (!exps.length) {
    const cr = await fetch(`/api/chains?ticker=SPX&daysToExpiration=90`);
    if (cr.ok) {
      const opts = normalizeOptions(await cr.json());
      exps = [...new Set(opts.map((o) => o.expiration))]
        .filter((e) => typeof e === "string" && !!e)
        .filter((e) => new Date(e + "T16:00:00") >= new Date())
        .sort();
    }
  }

  const weeklies = exps.filter((e) => {
    const day = new Date(e + "T12:00:00").getDay();
    return day === 5 || day === 4;
  });
  return { all: exps, weeklies: weeklies.length ? weeklies : exps };
}

// ── EM per ticker ───────────────────────────────────────────────────────────

export async function estimateMoveIC(ticker: string, targetExp: string, engine: EMEngine): Promise<EMQuote> {
  const isIndex = ticker === "SPX" || ticker === "NDX";
  let close = 0;
  try {
    close = (await fetchQuoteDetail(ticker, engine)).close;
  } catch (e) {
    // Index quotes come back null intermittently; the chain's underlyingPrice
    // recovers the level below. Equities still need a real quote.
    if (!isIndex) throw e;
  }
  if (!targetExp) throw new Error("No expiration selected");

  const chainSym = (CHAIN_SYMBOL[ticker] || ticker).replace(/^\$/, "");

  // No forceSub: on server-v2 the forceSub path returns an all-zero chain for
  // index weeklies; the plain pinned fetch returns full bid/ask/mark/iv.
  const chain = await Promise.race([
    fetch(API.chain(chainSym, targetExp, "&noSubscribe=1"))
      .then((r) => (r.ok ? r.json() : { options: [] }))
      .catch(() => ({ options: [] })),
    new Promise<{ options: [] }>((res) => setTimeout(() => res({ options: [] }), 10000)),
  ]);

  let options = normalizeOptions(chain);
  let chainSpot = chainUnderlyingPrice(chain);

  const isPriced = (o: OptionData) =>
    (o.bid > 0 && o.ask > 0) || o.mark > 0 || Number(o.iv || 0) > 0;

  let effectiveExp = targetExp;
  let expOptions = options.filter((o) => o.expiration === effectiveExp);
  if (!expOptions.length || !expOptions.some(isPriced)) {
    const unpinned = await fetch(`/api/chains?ticker=${encodeURIComponent(chainSym)}`)
      .then((r) => (r.ok ? r.json() : { options: [] }))
      .catch(() => ({ options: [] }));
    const merged = normalizeOptions(unpinned);
    if (merged.length) options = merged;
    const unpinnedSpot = chainUnderlyingPrice(unpinned);
    if (unpinnedSpot > 0) chainSpot = unpinnedSpot;
    const pricedExps = [...new Set(options.filter(isPriced).map((o) => o.expiration))].filter(Boolean).sort();
    const allExps = [...new Set(options.map((o) => o.expiration))].filter(Boolean).sort();
    const pool = pricedExps.length ? pricedExps : allExps;
    const snapped = pool.find((e) => e >= targetExp) || pool[pool.length - 1];
    if (snapped) {
      effectiveExp = snapped;
      expOptions = options.filter((o) => o.expiration === effectiveExp);
    }
  }
  if (!expOptions.length) throw new Error("No options for expiration");

  if (expOptions.every((o) => Number(o.iv || 0) === 0)) {
    const direct = await fetchChainDirect(chainSym, effectiveExp, engine);
    if (direct) expOptions = direct;
  }

  const indexClose = chainSpot > 0 ? chainSpot : close;
  if (isIndex && (!Number.isFinite(close) || close <= 0) && chainSpot > 0) close = chainSpot;
  if (!Number.isFinite(indexClose) || indexClose <= 0) throw new Error("No usable underlying price");

  // Every listed strike at this expiration — the condor legs snap onto these.
  const allStrikes = [...new Set(expOptions.map((o) => o.strike))]
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);

  // ATM-first walk, bounded: after hours most strikes carry no IV and no
  // bid/ask, and an unbounded walk fires option-marks for the whole chain.
  const MAX_STRIKE_TRIES = 8;
  const strikes = [...allStrikes]
    .sort((a, b) => Math.abs(a - indexClose) - Math.abs(b - indexClose))
    .slice(0, MAX_STRIKE_TRIES);
  if (!strikes.length) throw new Error("No strikes found");

  let strike: number | null = null;
  let em = 0;

  for (const candidateStrike of strikes) {
    let c = expOptions.find((o) => o.strike === candidateStrike && o.type === "CALL");
    let p = expOptions.find((o) => o.strike === candidateStrike && o.type === "PUT");
    if (!c || !p) continue;

    const candidateDte = c.dte || p.dte || daysTo(effectiveExp);
    let avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;
    let candidateEm = 0;

    if (avgIV > 0 && candidateDte > 0) {
      candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    } else {
      // Only refetch when the row carries NO usable price at all — /api/chains
      // already ships a REST mark, and refetching per strike is the log storm.
      const haveUsable = (o: OptionData) => (o.bid > 0 && o.ask > 0) || o.mark > 0 || o.last > 0;
      if ((!haveUsable(c) || !haveUsable(p)) && (c.symbol || p.symbol)) {
        const marks = await fetchOptionMarks([c.symbol, p.symbol].filter(Boolean));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (marks[c.symbol]) c = Object.assign({}, c, marks[c.symbol] as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (marks[p.symbol]) p = Object.assign({}, p, marks[p.symbol] as any);
        avgIV = (Number(c?.iv || 0) + Number(p?.iv || 0)) / 2;
      }
      const cMid = c ? mid(c) : 0;
      const pMid = p ? mid(p) : 0;
      if (cMid > 0 && pMid > 0) candidateEm = (cMid + pMid) * 0.85;
      else if (avgIV > 0 && candidateDte > 0) candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
    }

    if (Number.isFinite(candidateEm) && candidateEm > 0) {
      const emPct = candidateEm / indexClose;
      if (emPct < 0.002 || emPct > 0.25) continue;
      strike = candidateStrike;
      em = candidateEm;
      break;
    }
  }

  if (!strike) throw new Error("No usable strike (IV=0 and no straddle bid/ask)");
  if (!Number.isFinite(em) || em <= 0) throw new Error("EM calculation returned zero");

  const displayClose = chainSpot > 0 ? chainSpot : close;
  return {
    ticker,
    close: displayClose,
    em,
    up: indexClose + em,
    down: indexClose - em,
    expiration: effectiveExp,
    strike,
    strikes: allStrikes,
  };
}

// ── Condor builder ──────────────────────────────────────────────────────────

/** Modal gap between adjacent listed strikes near spot — the chain's increment. */
export function strikeStep(strikes: number[], spot: number): number {
  if (strikes.length < 2) return 0;
  const near = [...strikes]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, 21)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < near.length; i += 1) {
    const g = Number((near[i] - near[i - 1]).toFixed(4));
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 0;
  const counts = new Map<number, number>();
  gaps.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  let best = gaps[0];
  let bestCount = 0;
  counts.forEach((count, g) => {
    // Ties break toward the SMALLER gap — the tighter increment is the real one.
    if (count > bestCount || (count === bestCount && g < best)) { best = g; bestCount = count; }
  });
  return best;
}

/**
 * Snap a target price onto the listed strike ladder and hang wings off it.
 *
 * - shortPut  = the highest listed strike AT OR BELOW spot − mult·EM
 * - shortCall = the lowest  listed strike AT OR ABOVE spot + mult·EM
 * - longs     = `wingSteps` listed strikes further out (index offsets, so the
 *   wing lands on a real strike even where the ladder's increment changes)
 *
 * Returns null when the ladder can't support the structure (too few strikes,
 * or the EM target sits outside the listed range).
 */
export function buildCondor(
  spot: number,
  em: number,
  strikes: number[],
  emMult: number,
  wingSteps: number,
): Pick<CondorRow,
  "longPut" | "shortPut" | "shortCall" | "longCall" |
  "putWidth" | "callWidth" | "step" | "putOtmPct" | "callOtmPct" | "rawDown" | "rawUp"
> | null {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(em) || em <= 0) return null;
  const ladder = [...new Set(strikes)].filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  if (ladder.length < 3) return null;

  const rawDown = spot - emMult * em;
  const rawUp = spot + emMult * em;

  // Highest strike ≤ rawDown, lowest strike ≥ rawUp.
  let putIdx = -1;
  for (let i = ladder.length - 1; i >= 0; i -= 1) {
    if (ladder[i] <= rawDown) { putIdx = i; break; }
  }
  let callIdx = -1;
  for (let i = 0; i < ladder.length; i += 1) {
    if (ladder[i] >= rawUp) { callIdx = i; break; }
  }
  if (putIdx < 0 || callIdx < 0 || callIdx <= putIdx) return null;

  const longPutIdx = Math.max(0, putIdx - wingSteps);
  const longCallIdx = Math.min(ladder.length - 1, callIdx + wingSteps);

  const shortPut = ladder[putIdx];
  const shortCall = ladder[callIdx];
  const longPut = ladder[longPutIdx];
  const longCall = ladder[longCallIdx];

  // A wing that couldn't move (short sits at the edge of the ladder) is not a
  // spread — flag it by returning a zero width rather than a bogus strike.
  return {
    longPut,
    shortPut,
    shortCall,
    longCall,
    putWidth: shortPut - longPut,
    callWidth: longCall - shortCall,
    step: strikeStep(ladder, spot),
    putOtmPct: ((spot - shortPut) / spot) * 100,
    callOtmPct: ((shortCall - spot) / spot) * 100,
    rawDown,
    rawUp,
  };
}
