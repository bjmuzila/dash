/**
 * CSV → normalized fills, for the /trading journal importer.
 *
 * The pipeline is deliberately in three separable stages so each is testable and
 * a broken broker mapping can't corrupt the math:
 *
 *   parseCsv()        raw text  → string[][]        (RFC4180-ish, quote aware)
 *   detectBroker()    header row → BrokerId         (or "generic" → user maps cols)
 *   toFills()         rows      → Fill[]            (one row per execution)
 *   matchRoundTrips() Fill[]    → Trade[]           (FIFO, long + short)
 *   deriveDays()      Trade[]   → DayStats[]        (what a journal row stores)
 *
 * NOTHING here derives a day stat from a number the broker printed in a summary
 * row — every stat is recomputed from the executions. Broker P&L columns differ
 * on fees/commissions/assignment handling; recomputing from fills is the only
 * way the numbers are consistent across the six formats.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type BrokerId =
  | "tastytrade" | "tos" | "ibkr" | "rithmic" | "motivewave" | "tradovate" | "tpt" | "generic";

export interface Fill {
  ts: number;             // epoch ms (execution time)
  date: string;           // YYYY-MM-DD, ET session date (see sessionDate)
  symbol: string;         // raw broker symbol (option OCC / futures root+month)
  underlying: string;     // SPX, ES, TSLA…
  asset_type: "option" | "future" | "equity";
  side: "BUY" | "SELL";
  qty: number;            // always positive; direction lives in `side`
  price: number;          // per-unit (per share / per contract point)
  fees: number;           // commissions + exchange fees, positive = cost
  multiplier: number;     // 100 for options, per-contract $ for futures, 1 equity
  source: BrokerId;
  ext_id: string;         // stable hash of the raw row → dedupes re-imports
  account: string;        // broker account number/label, "" if the file has none
}

export interface Trade {
  symbol: string;
  underlying: string;
  asset_type: Fill["asset_type"];
  direction: "long" | "short";
  open_ts: number;        // "time in"
  close_ts: number;       // "time out"
  date: string;           // session date of the CLOSE (when P&L is realized)
  qty: number;
  entry: number;          // "price in"
  exit: number;           // "price out"
  fees: number;
  pnl: number;            // net of fees
  account: string;
  // Stable identity — the ext_id of the two fills this round trip matched.
  // Not a database id (trades are never stored, only fills are); this is
  // what /api/journal/trades keys an edit/delete override to.
  open_ext_id: string;
  close_ext_id: string;
}

/** What a journal day stores. Day-level only — no per-trade excursion stats. */
export interface DayStats {
  date: string;
  net_pnl: number;
  trades: number;
  win_rate: number;       // 0-100
  avg_win: number;
  avg_loss: number;       // negative
  profit_factor: number;
  commissions: number;    // negative (a cost)
  notes: string | null;
  kind: "verified";
}

// ── Stage 1: CSV text → rows ─────────────────────────────────────────────────

/** Quote-aware CSV split. Handles "" escapes, embedded commas/newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");           // strip BOM (Excel exports)

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }  // "" → literal quote
        else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));   // drop blank lines
}

// ── Stage 2: broker detection ────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Signature headers per broker. A file matches if EVERY signature column is
 * present. Ordered most-specific first — TOS and IBKR both have "Symbol", so a
 * unique column decides it.
 */
const SIGNATURES: { id: Exclude<BrokerId, "generic">; need: string[] }[] = [
  // tastytrade "Transaction history" export.
  { id: "tastytrade", need: ["date", "type", "action", "symbol", "quantity", "averageprice"] },
  // IBKR Activity Statement / Flex "Trades" section.
  { id: "ibkr",       need: ["symbol", "tradedate", "quantity", "tradeprice"] },
  { id: "ibkr",       need: ["symbol", "datetime", "quantity", "tprice"] },
  // Tradovate "Performance → Orders/Fills" export.
  { id: "tradovate",  need: ["timestamp", "contract", "bs", "filledqty", "avgfillprice"] },
  { id: "tradovate",  need: ["fillid", "contract", "bs", "qty", "price"] },
  // Rithmic (R|Trader Pro) order/fill export.
  { id: "rithmic",    need: ["symbol", "buysell", "qty", "avgfillprice"] },
  { id: "rithmic",    need: ["instrument", "buysell", "quantity", "price"] },
  // MotiveWave trade log.
  { id: "motivewave", need: ["instrument", "side", "quantity", "entryprice", "exitprice"] },
  // TPT "completed trades" export — already ROUND TRIPS (one row = one closed
  // trade), not raw executions. tradeAccount/position/entryDate/exitDate/
  // pnlDollars is the unique fingerprint; nothing else exports this shape.
  { id: "tpt",         need: ["tradeid", "tradeaccount", "symbol", "position", "entrydate", "exitdate", "pnldollars"] },
  // Thinkorswim / Schwab "Account Statement" → Account Trade History.
  { id: "tos",        need: ["execttime", "symbol", "side", "qty", "price"] },
  { id: "tos",        need: ["exectime", "symbol", "side", "qty", "price"] },
];

export function detectBroker(header: string[]): BrokerId {
  const cols = new Set(header.map(norm));
  for (const sig of SIGNATURES) {
    if (sig.need.every((n) => cols.has(n))) return sig.id;
  }
  return "generic";
}

// ── Column resolution ────────────────────────────────────────────────────────

/**
 * Field → accepted header aliases, unioned across all six brokers. Detection
 * picks the broker; this picks the columns. Keeping one alias table (instead of
 * six maps) means a new broker usually needs zero code — just new aliases.
 */
const ALIASES: Record<string, string[]> = {
  ts:     ["execttime", "exectime", "datetime", "timestamp", "date", "tradedate", "filltime", "time", "closetime", "exittime"],
  symbol: ["symbol", "contract", "instrument", "underlyingsymbol", "description"],
  side:   ["side", "action", "bs", "buysell", "buyorsell", "direction", "type"],
  qty:    ["qty", "quantity", "filledqty", "size", "amount", "contracts"],
  price:  ["price", "avgfillprice", "averageprice", "tradeprice", "tprice", "fillprice", "entryprice", "avgprice"],
  // MotiveWave only — its rows carry entry AND exit on one line.
  exit:   ["exitprice", "closeprice"],
  fees:   ["commission", "commissions", "fees", "commfee", "ibcommission", "totalfees", "commissionsandfees"],
  // Optional — used only as a cross-check, never as the source of truth.
  pnl:    ["pnl", "realizedpnl", "netpnl", "profit", "grosspl", "realizedp", "value"],
  // Optional — most brokers omit this on a single-account export. When present
  // it lets the journal split stats "by account" (e.g. a prop account vs a
  // personal account traded the same week).
  account: ["account", "accountnumber", "accountid", "acctnum", "acct", "accountnickname"],
};

export type ColumnMap = Partial<Record<keyof typeof ALIASES, number>>;

/** Resolve each field to a column index by alias. Generic imports override this. */
export function resolveColumns(header: string[]): ColumnMap {
  const cols = header.map(norm);
  const map: ColumnMap = {};
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    for (const a of aliases) {
      const i = cols.indexOf(a);
      if (i >= 0) { map[field] = i; break; }
    }
  }
  return map;
}

// ── Symbol / contract knowledge ──────────────────────────────────────────────

/**
 * Futures point value per contract. Wrong multiplier = wrong P&L by a constant
 * factor, so this is the highest-blast-radius table in the file. Add a root here
 * before importing it; unknown roots fall back to 1 and are flagged in the
 * import preview rather than silently mis-priced.
 */
export const FUTURES_MULT: Record<string, number> = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, RTY: 50, M2K: 5, YM: 5, MYM: 0.5,
  CL: 1000, MCL: 100, GC: 100, MGC: 10, SI: 5000, NG: 10000,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, "6E": 125000, "6J": 12500000,
};

/** Futures: /ESU5, ESU25, ES 09-25, ESM4 → root ES. */
const FUT_RE = /^\/?([A-Z0-9]{1,3})[\s-]?([FGHJKMNQUVXZ])[\s-]?(\d{1,2})$/;
/** OCC-ish option: SPXW  250718C05600000, or ".SPX250718C5600", or "SPX 07/18/25 5600 C". */
const OCC_RE = /^\.?([A-Z]{1,6})W?\s*(\d{6})\s*([CP])\s*(\d+(?:\.\d+)?)$/;
const HUMAN_OPT_RE = /^([A-Z]{1,6})\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+[\d.]+\s+[CP]/i;

export function classify(rawSymbol: string): {
  underlying: string; asset_type: Fill["asset_type"]; multiplier: number;
} {
  const s = rawSymbol.trim().toUpperCase();
  const compact = s.replace(/\s+/g, "");

  if (OCC_RE.test(compact) || HUMAN_OPT_RE.test(s)) {
    const under = (compact.match(OCC_RE)?.[1] ?? s.split(/\s+/)[0]).replace(/W$/, "");
    return { underlying: under, asset_type: "option", multiplier: 100 };
  }
  const fut = compact.match(FUT_RE);
  if (fut) {
    const root = fut[1];
    return { underlying: root, asset_type: "future", multiplier: FUTURES_MULT[root] ?? 1 };
  }
  // Bare root with no month code (Rithmic sometimes exports "ES").
  if (FUTURES_MULT[compact]) {
    return { underlying: compact, asset_type: "future", multiplier: FUTURES_MULT[compact] };
  }
  return { underlying: s.split(/\s+/)[0], asset_type: "equity", multiplier: 1 };
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

const NY_TZ = "America/New_York";

/**
 * Session date in ET. A 6:30pm CT futures fill belongs to the NEXT trading day,
 * but for a journal the user thinks in calendar-ET sessions, so we bucket by the
 * ET calendar date of the execution. Overnight futures traders can revisit this.
 */
export function sessionDate(ts: number): string {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return parts; // en-CA → YYYY-MM-DD
}

/** Money/number cell → number. Strips $ , ( ) and treats (1.23) as -1.23. */
export function money(v: string | undefined): number {
  if (!v) return 0;
  const s = v.trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[()$,\s]/g, "").replace(/^-/, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

/** Broker timestamps are a zoo. Try ISO, US, and "MM/DD/YY HH:MM:SS" shapes. */
export function parseTs(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().replace(/\bET\b|\bEST\b|\bEDT\b/gi, "").trim();
  if (!s) return null;
  // IBKR: "2026-07-10, 09:31:04"
  const ib = s.match(/^(\d{4}-\d{2}-\d{2})[,\s]+(\d{2}:\d{2}:\d{2})$/);
  if (ib) return Date.parse(`${ib[1]}T${ib[2]}`);
  // TOS: "7/10/26 09:31:04" | Tradovate: "07/10/2026 09:31:04"
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    const yr = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return new Date(yr, Number(us[1]) - 1, Number(us[2]),
      Number(us[4] ?? 0), Number(us[5] ?? 0), Number(us[6] ?? 0)).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** BUY/SELL from the many things brokers put in a side column. */
export function parseSide(v: string | undefined): "BUY" | "SELL" | null {
  const s = (v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^B$|BUY|BOT|BTO|BTC|LONG/.test(s)) return "BUY";
  if (/^S$|SELL|SLD|STO|STC|SHORT/.test(s)) return "SELL";
  return null;
}

/** djb2 — stable row fingerprint so a re-imported file doesn't duplicate fills. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── Stage 3: rows → fills ────────────────────────────────────────────────────

export interface ParseResult {
  broker: BrokerId;
  fills: Fill[];
  skipped: number;             // rows that weren't executions (summaries, headers)
  unknownRoots: string[];      // futures roots with no multiplier — P&L unreliable
}

/**
 * Rows → fills. `map` overrides column resolution (the generic/manual path).
 * MotiveWave is special-cased: its rows are already round trips (entry AND exit
 * price on one line), so one row expands into two fills.
 */
export function toFills(rows: string[][], broker?: BrokerId, map?: ColumnMap): ParseResult {
  const header = rows[0] ?? [];
  const b = broker ?? detectBroker(header);
  const m = map ?? resolveColumns(header);
  const fills: Fill[] = [];
  const unknown = new Set<string>();
  let skipped = 0;

  const at = (r: string[], i?: number) => (i == null ? undefined : r[i]);

  // TPT "completed trades" — each row is a CLOSED trade, not a single
  // execution: it carries entryDate/exitDate + entryPrice/exitPrice on one
  // line, plus its own account/position/qty/pnl/commission columns. None of
  // that fits the generic one-ts/one-price ColumnMap (built for
  // one-row-per-execution files), so it gets its own pass, synthesized into
  // an open + close fill pair per row — same trick as the MotiveWave branch
  // below, just with its own column lookup instead of `m`.
  if (b === "tpt") {
    const cols = header.map(norm);
    const idx = (...names: string[]) => { for (const n of names) { const i = cols.indexOf(n); if (i >= 0) return i; } return undefined; };
    const c = {
      id: idx("tradeid"), account: idx("tradeaccount"), symbol: idx("symbol"),
      position: idx("position"), entryDate: idx("entrydate"), exitDate: idx("exitdate"),
      qty: idx("maxquantity"), pnl: idx("pnldollars"), fees: idx("commission"),
      entryPx: idx("entryprice"), exitPx: idx("exitprice"),
    };
    for (let ri = 1; ri < rows.length; ri++) {
      const r = rows[ri];
      const rawSym = (at(r, c.symbol) ?? "").trim();
      const openTs = parseTs(at(r, c.entryDate));
      const closeTs = parseTs(at(r, c.exitDate));
      const qty = Math.abs(money(at(r, c.qty)));
      const entryPx = money(at(r, c.entryPx));
      const exitPx = money(at(r, c.exitPx));
      if (!rawSym || openTs == null || closeTs == null || !qty || !Number.isFinite(entryPx) || !Number.isFinite(exitPx)) {
        skipped++; continue;
      }
      const cls = classify(rawSym);
      if (cls.asset_type === "future" && cls.multiplier === 1) unknown.add(cls.underlying);
      const long = (at(r, c.position) ?? "").trim().toUpperCase() !== "S";
      const fees = Math.abs(money(at(r, c.fees)));
      const account = (at(r, c.account) ?? "").trim();
      const tradeId = (at(r, c.id) ?? "").trim() || String(ri);
      const base = {
        symbol: rawSym.toUpperCase(), underlying: cls.underlying, asset_type: cls.asset_type,
        multiplier: cls.multiplier, source: b, account, qty,
      };
      // ext_id keys off the broker's own tradeId (stable across re-exports of
      // the same statement) rather than a full-row hash — TPT recomputes
      // derived columns (win%, expectancy…) between exports, which would
      // otherwise change the hash and duplicate the trade on re-import.
      fills.push({ ...base, ts: openTs, date: sessionDate(openTs), price: entryPx, fees: fees / 2,
        side: long ? "BUY" : "SELL", ext_id: hash(`tpt|${tradeId}|o`) });
      fills.push({ ...base, ts: closeTs, date: sessionDate(closeTs), price: exitPx, fees: fees / 2,
        side: long ? "SELL" : "BUY", ext_id: hash(`tpt|${tradeId}|c`) });
    }
    fills.sort((a, z) => a.ts - z.ts);
    return { broker: b, fills, skipped, unknownRoots: [...unknown] };
  }

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const rawSym = (at(r, m.symbol) ?? "").trim();
    const ts = parseTs(at(r, m.ts));
    const qty = Math.abs(money(at(r, m.qty)));
    const price = money(at(r, m.price));

    // Not an execution: statement subtotals, "Cash Movement"/"Money Movement"
    // rows, section separators. Skip quietly and report the count.
    if (!rawSym || ts == null || !qty || !Number.isFinite(price)) { skipped++; continue; }

    const cls = classify(rawSym);
    if (cls.asset_type === "future" && cls.multiplier === 1) unknown.add(cls.underlying);

    const fees = Math.abs(money(at(r, m.fees)));
    const base = {
      date: sessionDate(ts),
      symbol: rawSym.toUpperCase(),
      underlying: cls.underlying,
      asset_type: cls.asset_type,
      multiplier: cls.multiplier,
      source: b,
      account: (at(r, m.account) ?? "").trim(),
    };

    // MotiveWave: one row = a completed trade (entry + exit on the same line).
    const exitPx = m.exit != null ? money(at(r, m.exit)) : 0;
    if (b === "motivewave" && m.exit != null && exitPx) {
      const long = parseSide(at(r, m.side)) !== "SELL";
      fills.push({ ...base, ts, qty, price, fees: fees / 2, side: long ? "BUY" : "SELL",
        ext_id: hash(`${b}|${ri}|o|${r.join("|")}`) });
      fills.push({ ...base, ts: ts + 1, qty, price: exitPx, fees: fees / 2, side: long ? "SELL" : "BUY",
        ext_id: hash(`${b}|${ri}|c|${r.join("|")}`) });
      continue;
    }

    const side = parseSide(at(r, m.side));
    if (!side) { skipped++; continue; }
    fills.push({ ...base, ts, qty, price, fees, side, ext_id: hash(`${b}|${r.join("|")}`) });
  }

  fills.sort((a, z) => a.ts - z.ts);
  return { broker: b, fills, skipped, unknownRoots: [...unknown] };
}

// ── Stage 4: fills → round trips (FIFO) ──────────────────────────────────────

/**
 * FIFO round-trip matching per symbol, long and short. An open position at the
 * end of the file is simply not counted — it has no realized P&L yet, so it
 * can't affect a day stat. It'll close on a later import and be counted then.
 */
export function matchRoundTrips(fills: Fill[]): Trade[] {
  // Keyed by account+symbol — the same symbol held in two different accounts at
  // once (e.g. a prop account and a personal account) must not net against
  // each other.
  const open = new Map<string, { ts: number; qty: number; price: number; fees: number; side: "BUY" | "SELL"; ext_id: string }[]>();
  const trades: Trade[] = [];
  const key = (f: { account: string; symbol: string }) => `${f.account}|${f.symbol}`;

  for (const f of fills) {
    const k = key(f);
    const lots = open.get(k) ?? [];
    // Same direction as what's open (or nothing open) → this is an opening lot.
    if (!lots.length || lots[0].side === f.side) {
      lots.push({ ts: f.ts, qty: f.qty, price: f.price, fees: f.fees, side: f.side, ext_id: f.ext_id });
      open.set(k, lots);
      continue;
    }

    // Opposite direction → close against the oldest lots first.
    let remaining = f.qty;
    let closeFees = f.fees;
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const q = Math.min(remaining, lot.qty);
      const long = lot.side === "BUY";
      const gross = (long ? f.price - lot.price : lot.price - f.price) * q * f.multiplier;
      // Fees split proportionally across the matched quantity, both legs.
      const feeShare = (lot.fees * (q / lot.qty)) + (closeFees * (q / f.qty));

      trades.push({
        symbol: f.symbol,
        underlying: f.underlying,
        asset_type: f.asset_type,
        direction: long ? "long" : "short",
        open_ts: lot.ts,
        close_ts: f.ts,
        date: sessionDate(f.ts),      // P&L books on the close
        qty: q,
        entry: lot.price,
        exit: f.price,
        fees: feeShare,
        pnl: gross - feeShare,
        account: f.account,
        open_ext_id: lot.ext_id,
        close_ext_id: f.ext_id,
      });

      lot.fees -= lot.fees * (q / lot.qty);
      lot.qty -= q;
      remaining -= q;
      if (lot.qty <= 1e-9) lots.shift();
    }
    // Flipped through flat (closed more than was open) → the excess opens the
    // other way. Rare but real (a sell-to-flip order).
    if (remaining > 0) {
      lots.push({ ts: f.ts, qty: remaining, price: f.price, fees: 0, side: f.side, ext_id: f.ext_id });
    }
    open.set(k, lots);
  }

  return trades.sort((a, b) => a.close_ts - b.close_ts);
}

// ── Stage 5: trades → day rows ───────────────────────────────────────────────

export function deriveDays(trades: Trade[]): DayStats[] {
  const byDate = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = byDate.get(t.date) ?? [];
    arr.push(t);
    byDate.set(t.date, arr);
  }

  const days: DayStats[] = [];
  for (const [date, ts] of [...byDate.entries()].sort()) {
    const wins = ts.filter((t) => t.pnl > 0);
    const losses = ts.filter((t) => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const fees = ts.reduce((s, t) => s + t.fees, 0);
    const decided = wins.length + losses.length;   // scratches excluded from win %

    days.push({
      date,
      net_pnl: round2(ts.reduce((s, t) => s + t.pnl, 0)),
      trades: ts.length,
      win_rate: decided ? round2((wins.length / decided) * 100) : 0,
      avg_win: wins.length ? round2(grossWin / wins.length) : 0,
      avg_loss: losses.length ? round2(-grossLoss / losses.length) : 0,
      // Profit factor is undefined with no losses; 0 losses + wins → report 0 and
      // let the UI show "—" rather than fake an Infinity.
      profit_factor: grossLoss > 0 ? round2(grossWin / grossLoss) : 0,
      commissions: round2(-fees),
      notes: null,
      kind: "verified",
    });
  }
  return days;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Stage 6: trades → per-account rollup ────────────────────────────────────

export interface AccountStats {
  account: string;               // "" → "Unlabeled" in the UI
  sessions: number;               // distinct trading days
  first_date: string;
  last_date: string;
  trades: number;
  net_pnl: number;
  win_rate: number;
  avg_tit_ms: number;             // avg time-in-trade, all trades
}

/** Per-account rollup so the journal can answer "which account did today's
 *  trades come out of, and how has it done" — e.g. one account for the last
 *  5 sessions, a different one today. */
export function deriveAccountStats(trades: Trade[]): AccountStats[] {
  const byAcct = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = byAcct.get(t.account) ?? [];
    arr.push(t);
    byAcct.set(t.account, arr);
  }
  const out: AccountStats[] = [];
  for (const [account, ts] of byAcct) {
    const dates = ts.map((t) => t.date).sort();
    const wins = ts.filter((t) => t.pnl > 0).length;
    const losses = ts.filter((t) => t.pnl < 0).length;
    const decided = wins + losses;
    out.push({
      account,
      sessions: new Set(dates).size,
      first_date: dates[0],
      last_date: dates[dates.length - 1],
      trades: ts.length,
      net_pnl: round2(ts.reduce((s, t) => s + t.pnl, 0)),
      win_rate: decided ? round2((wins / decided) * 100) : 0,
      avg_tit_ms: ts.length ? Math.round(ts.reduce((s, t) => s + (t.close_ts - t.open_ts), 0) / ts.length) : 0,
    });
  }
  return out.sort((a, b) => b.last_date.localeCompare(a.last_date));
}

/** One-call convenience: CSV text → everything the import preview needs. */
export function importCsv(text: string, broker?: BrokerId, map?: ColumnMap) {
  const rows = parseCsv(text);
  if (!rows.length) return { broker: "generic" as BrokerId, header: [], fills: [], trades: [], days: [], skipped: 0, unknownRoots: [] };
  const { broker: b, fills, skipped, unknownRoots } = toFills(rows, broker, map);
  const trades = matchRoundTrips(fills);
  const days = deriveDays(trades);
  return { broker: b, header: rows[0], fills, trades, days, skipped, unknownRoots };
}
