var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/journal/csv.ts
var csv_exports = {};
__export(csv_exports, {
  FUTURES_MULT: () => FUTURES_MULT,
  classify: () => classify,
  deriveAccountStats: () => deriveAccountStats,
  deriveDays: () => deriveDays,
  detectBroker: () => detectBroker,
  importCsv: () => importCsv,
  matchRoundTrips: () => matchRoundTrips,
  money: () => money,
  parseCsv: () => parseCsv,
  parseSide: () => parseSide,
  parseTs: () => parseTs,
  resolveColumns: () => resolveColumns,
  sessionDate: () => sessionDate,
  toFills: () => toFills
});
module.exports = __toCommonJS(csv_exports);
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
var norm = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
var SIGNATURES = [
  // tastytrade "Transaction history" export.
  { id: "tastytrade", need: ["date", "type", "action", "symbol", "quantity", "averageprice"] },
  // IBKR Activity Statement / Flex "Trades" section.
  { id: "ibkr", need: ["symbol", "tradedate", "quantity", "tradeprice"] },
  { id: "ibkr", need: ["symbol", "datetime", "quantity", "tprice"] },
  // Tradovate "Performance → Orders/Fills" export.
  { id: "tradovate", need: ["timestamp", "contract", "bs", "filledqty", "avgfillprice"] },
  { id: "tradovate", need: ["fillid", "contract", "bs", "qty", "price"] },
  // Rithmic (R|Trader Pro) order/fill export.
  { id: "rithmic", need: ["symbol", "buysell", "qty", "avgfillprice"] },
  { id: "rithmic", need: ["instrument", "buysell", "quantity", "price"] },
  // MotiveWave trade log.
  { id: "motivewave", need: ["instrument", "side", "quantity", "entryprice", "exitprice"] },
  // TPT "completed trades" export — already ROUND TRIPS (one row = one closed
  // trade), not raw executions. tradeAccount/position/entryDate/exitDate/
  // pnlDollars is the unique fingerprint; nothing else exports this shape.
  { id: "tpt", need: ["tradeid", "tradeaccount", "symbol", "position", "entrydate", "exitdate", "pnldollars"] },
  // Thinkorswim / Schwab "Account Statement" → Account Trade History.
  { id: "tos", need: ["execttime", "symbol", "side", "qty", "price"] },
  { id: "tos", need: ["exectime", "symbol", "side", "qty", "price"] }
];
function detectBroker(header) {
  const cols = new Set(header.map(norm));
  for (const sig of SIGNATURES) {
    if (sig.need.every((n) => cols.has(n))) return sig.id;
  }
  return "generic";
}
var ALIASES = {
  ts: ["execttime", "exectime", "datetime", "timestamp", "date", "tradedate", "filltime", "time", "closetime", "exittime"],
  symbol: ["symbol", "contract", "instrument", "underlyingsymbol", "description"],
  side: ["side", "action", "bs", "buysell", "buyorsell", "direction", "type"],
  qty: ["qty", "quantity", "filledqty", "size", "amount", "contracts"],
  price: ["price", "avgfillprice", "averageprice", "tradeprice", "tprice", "fillprice", "entryprice", "avgprice"],
  // MotiveWave only — its rows carry entry AND exit on one line.
  exit: ["exitprice", "closeprice"],
  fees: ["commission", "commissions", "fees", "commfee", "ibcommission", "totalfees", "commissionsandfees"],
  // Optional — used only as a cross-check, never as the source of truth.
  pnl: ["pnl", "realizedpnl", "netpnl", "profit", "grosspl", "realizedp", "value"],
  // Optional — most brokers omit this on a single-account export. When present
  // it lets the journal split stats "by account" (e.g. a prop account vs a
  // personal account traded the same week).
  account: ["account", "accountnumber", "accountid", "acctnum", "acct", "accountnickname"]
};
function resolveColumns(header) {
  const cols = header.map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const i = cols.indexOf(a);
      if (i >= 0) {
        map[field] = i;
        break;
      }
    }
  }
  return map;
}
var FUTURES_MULT = {
  ES: 50,
  MES: 5,
  NQ: 20,
  MNQ: 2,
  RTY: 50,
  M2K: 5,
  YM: 5,
  MYM: 0.5,
  CL: 1e3,
  MCL: 100,
  GC: 100,
  MGC: 10,
  SI: 5e3,
  NG: 1e4,
  ZB: 1e3,
  ZN: 1e3,
  ZF: 1e3,
  ZT: 2e3,
  "6E": 125e3,
  "6J": 125e5
};
var FUT_RE = /^\/?([A-Z0-9]{1,3})[\s-]?([FGHJKMNQUVXZ])[\s-]?(\d{1,2})$/;
var OCC_RE = /^\.?([A-Z]{1,6})W?\s*(\d{6})\s*([CP])\s*(\d+(?:\.\d+)?)$/;
var HUMAN_OPT_RE = /^([A-Z]{1,6})\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+[\d.]+\s+[CP]/i;
function classify(rawSymbol) {
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
  if (FUTURES_MULT[compact]) {
    return { underlying: compact, asset_type: "future", multiplier: FUTURES_MULT[compact] };
  }
  return { underlying: s.split(/\s+/)[0], asset_type: "equity", multiplier: 1 };
}
var NY_TZ = "America/New_York";
function sessionDate(ts) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
  return parts;
}
function money(v) {
  if (!v) return 0;
  const s = v.trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[()$,\s]/g, "").replace(/^-/, ""));
  return Number.isFinite(n) ? neg ? -n : n : 0;
}
function parseTs(v) {
  if (!v) return null;
  const s = v.trim().replace(/\bET\b|\bEST\b|\bEDT\b/gi, "").trim();
  if (!s) return null;
  const ib = s.match(/^(\d{4}-\d{2}-\d{2})[,\s]+(\d{2}:\d{2}:\d{2})$/);
  if (ib) return Date.parse(`${ib[1]}T${ib[2]}`);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    const yr = us[3].length === 2 ? 2e3 + Number(us[3]) : Number(us[3]);
    return new Date(
      yr,
      Number(us[1]) - 1,
      Number(us[2]),
      Number(us[4] ?? 0),
      Number(us[5] ?? 0),
      Number(us[6] ?? 0)
    ).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function parseSide(v) {
  const s = (v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^B$|BUY|BOT|BTO|BTC|LONG/.test(s)) return "BUY";
  if (/^S$|SELL|SLD|STO|STC|SHORT/.test(s)) return "SELL";
  return null;
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
function toFills(rows, broker, map) {
  const header = rows[0] ?? [];
  const b = broker ?? detectBroker(header);
  const m = map ?? resolveColumns(header);
  const fills = [];
  const unknown = /* @__PURE__ */ new Set();
  let skipped = 0;
  const at = (r, i) => i == null ? void 0 : r[i];
  if (b === "tpt") {
    const cols = header.map(norm);
    const idx = (...names) => {
      for (const n of names) {
        const i = cols.indexOf(n);
        if (i >= 0) return i;
      }
      return void 0;
    };
    const c = {
      id: idx("tradeid"),
      account: idx("tradeaccount"),
      symbol: idx("symbol"),
      position: idx("position"),
      entryDate: idx("entrydate"),
      exitDate: idx("exitdate"),
      qty: idx("maxquantity"),
      pnl: idx("pnldollars"),
      fees: idx("commission"),
      entryPx: idx("entryprice"),
      exitPx: idx("exitprice")
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
        skipped++;
        continue;
      }
      const cls = classify(rawSym);
      if (cls.asset_type === "future" && cls.multiplier === 1) unknown.add(cls.underlying);
      const long = (at(r, c.position) ?? "").trim().toUpperCase() !== "S";
      const fees = Math.abs(money(at(r, c.fees)));
      const account = (at(r, c.account) ?? "").trim();
      const tradeId = (at(r, c.id) ?? "").trim() || String(ri);
      const base = {
        symbol: rawSym.toUpperCase(),
        underlying: cls.underlying,
        asset_type: cls.asset_type,
        multiplier: cls.multiplier,
        source: b,
        account,
        qty
      };
      fills.push({
        ...base,
        ts: openTs,
        date: sessionDate(openTs),
        price: entryPx,
        fees: fees / 2,
        side: long ? "BUY" : "SELL",
        ext_id: hash(`tpt|${tradeId}|o`)
      });
      fills.push({
        ...base,
        ts: closeTs,
        date: sessionDate(closeTs),
        price: exitPx,
        fees: fees / 2,
        side: long ? "SELL" : "BUY",
        ext_id: hash(`tpt|${tradeId}|c`)
      });
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
    if (!rawSym || ts == null || !qty || !Number.isFinite(price)) {
      skipped++;
      continue;
    }
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
      account: (at(r, m.account) ?? "").trim()
    };
    const exitPx = m.exit != null ? money(at(r, m.exit)) : 0;
    if (b === "motivewave" && m.exit != null && exitPx) {
      const long = parseSide(at(r, m.side)) !== "SELL";
      fills.push({
        ...base,
        ts,
        qty,
        price,
        fees: fees / 2,
        side: long ? "BUY" : "SELL",
        ext_id: hash(`${b}|${ri}|o|${r.join("|")}`)
      });
      fills.push({
        ...base,
        ts: ts + 1,
        qty,
        price: exitPx,
        fees: fees / 2,
        side: long ? "SELL" : "BUY",
        ext_id: hash(`${b}|${ri}|c|${r.join("|")}`)
      });
      continue;
    }
    const side = parseSide(at(r, m.side));
    if (!side) {
      skipped++;
      continue;
    }
    fills.push({ ...base, ts, qty, price, fees, side, ext_id: hash(`${b}|${r.join("|")}`) });
  }
  fills.sort((a, z) => a.ts - z.ts);
  return { broker: b, fills, skipped, unknownRoots: [...unknown] };
}
function matchRoundTrips(fills) {
  const open = /* @__PURE__ */ new Map();
  const trades = [];
  const key = (f) => `${f.account}|${f.symbol}`;
  for (const f of fills) {
    const k = key(f);
    const lots = open.get(k) ?? [];
    if (!lots.length || lots[0].side === f.side) {
      lots.push({ ts: f.ts, qty: f.qty, price: f.price, fees: f.fees, side: f.side, ext_id: f.ext_id });
      open.set(k, lots);
      continue;
    }
    let remaining = f.qty;
    let closeFees = f.fees;
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const q = Math.min(remaining, lot.qty);
      const long = lot.side === "BUY";
      const gross = (long ? f.price - lot.price : lot.price - f.price) * q * f.multiplier;
      const feeShare = lot.fees * (q / lot.qty) + closeFees * (q / f.qty);
      trades.push({
        symbol: f.symbol,
        underlying: f.underlying,
        asset_type: f.asset_type,
        direction: long ? "long" : "short",
        open_ts: lot.ts,
        close_ts: f.ts,
        date: sessionDate(f.ts),
        // P&L books on the close
        qty: q,
        entry: lot.price,
        exit: f.price,
        fees: feeShare,
        pnl: gross - feeShare,
        account: f.account,
        open_ext_id: lot.ext_id,
        close_ext_id: f.ext_id
      });
      lot.fees -= lot.fees * (q / lot.qty);
      lot.qty -= q;
      remaining -= q;
      if (lot.qty <= 1e-9) lots.shift();
    }
    if (remaining > 0) {
      lots.push({ ts: f.ts, qty: remaining, price: f.price, fees: 0, side: f.side, ext_id: f.ext_id });
    }
    open.set(k, lots);
  }
  return trades.sort((a, b) => a.close_ts - b.close_ts);
}
function deriveDays(trades) {
  const byDate = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const arr = byDate.get(t.date) ?? [];
    arr.push(t);
    byDate.set(t.date, arr);
  }
  const days = [];
  for (const [date, ts] of [...byDate.entries()].sort()) {
    const wins = ts.filter((t) => t.pnl > 0);
    const losses = ts.filter((t) => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const fees = ts.reduce((s, t) => s + t.fees, 0);
    const decided = wins.length + losses.length;
    days.push({
      date,
      net_pnl: round2(ts.reduce((s, t) => s + t.pnl, 0)),
      trades: ts.length,
      win_rate: decided ? round2(wins.length / decided * 100) : 0,
      avg_win: wins.length ? round2(grossWin / wins.length) : 0,
      avg_loss: losses.length ? round2(-grossLoss / losses.length) : 0,
      // Profit factor is undefined with no losses; 0 losses + wins → report 0 and
      // let the UI show "—" rather than fake an Infinity.
      profit_factor: grossLoss > 0 ? round2(grossWin / grossLoss) : 0,
      commissions: round2(-fees),
      notes: null,
      kind: "verified"
    });
  }
  return days;
}
var round2 = (n) => Math.round(n * 100) / 100;
function deriveAccountStats(trades) {
  const byAcct = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const arr = byAcct.get(t.account) ?? [];
    arr.push(t);
    byAcct.set(t.account, arr);
  }
  const out = [];
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
      win_rate: decided ? round2(wins / decided * 100) : 0,
      avg_tit_ms: ts.length ? Math.round(ts.reduce((s, t) => s + (t.close_ts - t.open_ts), 0) / ts.length) : 0
    });
  }
  return out.sort((a, b) => b.last_date.localeCompare(a.last_date));
}
function importCsv(text, broker, map) {
  const rows = parseCsv(text);
  if (!rows.length) return { broker: "generic", header: [], fills: [], trades: [], days: [], skipped: 0, unknownRoots: [] };
  const { broker: b, fills, skipped, unknownRoots } = toFills(rows, broker, map);
  const trades = matchRoundTrips(fills);
  const days = deriveDays(trades);
  return { broker: b, header: rows[0], fills, trades, days, skipped, unknownRoots };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FUTURES_MULT,
  classify,
  deriveAccountStats,
  deriveDays,
  detectBroker,
  importCsv,
  matchRoundTrips,
  money,
  parseCsv,
  parseSide,
  parseTs,
  resolveColumns,
  sessionDate,
  toFills
});
