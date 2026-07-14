/**
 * scripts/build-bar-stats.mjs
 *
 * Precompute the bar-level stat book from a raw 1-minute CSV, once, offline.
 * Emits public/data/bars-<SYM>.json — a few hundred KB of pure aggregates that
 * the Stat Prompter reads directly. Same pattern as ib-<SYM>.json: the browser
 * never sees the 100 MB source file.
 *
 *   node scripts/build-bar-stats.mjs --sym ES --in "C:\path\to\ES_1min.csv"
 *   node scripts/build-bar-stats.mjs --sym NQ --in "C:\path\to\NQ_1min.csv" --all-hours
 *
 * INPUT FORMAT (same as lib/ibStats.ts parseCsv — whatever you feed
 * ib-backtest-esu6.html will work):
 *     YYYYMMDD HHMMSS,open,high,low,close,volume
 *
 * FLAGS
 *   --sym ES|NQ        symbol label (default ES)
 *   --in <path>        the CSV (required)
 *   --all-hours        keep the full 24h session (default: RTH 09:30–16:00 only)
 *   --out <path>       override the output file
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * METHODOLOGY — read this before you trust any number downstream.
 *
 * • Returns are LOG returns in basis points, computed close-to-close and NEVER
 *   across a session boundary. The overnight gap is not a 1-minute return and
 *   including it would poison every ACF and time-of-day mean.
 * • Every time-of-day cell is the mean over ~N sessions of that clock minute.
 *   Minute-level means on 1m data are TINY (fractions of a bp) and dominated by
 *   noise — the hour table is the one to read. The minute table is kept for
 *   shape, not for signal.
 * • ACF at 1m on futures is dominated by microstructure (bid-ask bounce), which
 *   shows up as a negative lag-1. That is a property of the quote, not an edge.
 *   The 5m/15m ACFs are the tradeable ones, and they are usually near zero.
 * • Variance ratio: VR(q) = Var(q-bar return) / (q × Var(1-bar return)).
 *   VR > 1 = trending, VR < 1 = mean-reverting, VR = 1 = random walk.
 * • Streak continuation is computed on CLOSED bars only and the "next" bar must
 *   be in the same session. No lookahead anywhere in this file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const SYM = (arg("sym", "ES") || "ES").toUpperCase();
const IN = arg("in");
const ALL_HOURS = argv.includes("--all-hours");
const OUT = arg("out", path.join(process.cwd(), "public", "data", `bars-${SYM}.json`));

if (!IN) {
  console.error("usage: node scripts/build-bar-stats.mjs --sym ES --in <path-to-1min.csv>");
  process.exit(1);
}
if (!fs.existsSync(IN)) {
  console.error(`no such file: ${IN}`);
  process.exit(1);
}

/* ── parse ────────────────────────────────────────────────────────────────── */

const RTH_OPEN = 570;   // 09:30 ET
const RTH_CLOSE = 960;  // 16:00 ET

/**
 * Timestamp parsing — deliberately permissive, because every vendor exports a
 * different shape and a silent 0-bar parse is the worst possible failure. Handles:
 *   20240102 093000          (Sierra / Kinetick / the ib-backtest-esu6 format)
 *   2024-01-02 09:30:00      (TradingView, IQFeed, most Python dumps)
 *   2024-01-02T09:30:00-05:00 (ISO with offset — the LOCAL clock is used as-is)
 *   01/02/2024 09:30         (US m/d/y)
 *   1704205800 / ...000      (unix seconds or ms → converted in America/New_York)
 *
 * NOTE ON TIMEZONE: for the text formats the wall clock in the file IS the clock
 * used. These exports are already exchange-time, so no conversion is applied —
 * converting a timestamp that's already ET would shift the whole session and
 * silently move the open. Only the unix-epoch path converts, because an epoch
 * carries no timezone at all.
 */
const NY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function parseStamp(s) {
  const t = s.trim().replace(/^["']|["']$/g, "");

  // 20240102 093000  |  20240102T0930
  let m = t.match(/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):?(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5] };

  // 2024-01-02 09:30[:00]  |  2024-01-02T09:30:00[-05:00]
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5] };

  // 01/02/2024 09:30  (US month/day/year)
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T,](\d{1,2}):(\d{2})/);
  if (m) {
    const mo = m[1].padStart(2, "0"), d = m[2].padStart(2, "0");
    return { date: `${m[3]}-${mo}-${d}`, min: +m[4] * 60 + +m[5] };
  }

  // unix epoch (s or ms) — the only case where we must convert to ET
  if (/^\d{9,13}$/.test(t)) {
    const ms = t.length >= 12 ? +t : +t * 1000;
    const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    if (p.year) return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  }
  return null;
}

console.log(`reading ${IN} …`);
const text = fs.readFileSync(IN, "utf8");
const lines = text.split(/\r?\n/);
const delim = (lines.find((l) => l.trim()) || "").includes(";") ? ";" : ",";

/* Column layout: read it off the header if there is one, else assume the
 * classic positional ts,o,h,l,c,v. A header named "Volume" in column 9 is
 * exactly how you end up with garbage volume stats, so this is worth doing. */
const head = (lines.find((l) => l.trim()) || "").split(delim).map((x) => x.trim().toLowerCase().replace(/^["']|["']$/g, ""));
const hasHeader = head.some((h) => /^(open|high|low|close|time|date|datetime|timestamp)$/.test(h));
const find = (...names) => head.findIndex((h) => names.includes(h));
const IX = hasHeader
  ? {
      t: Math.max(0, find("time", "date", "datetime", "timestamp")),
      o: find("open"), h: find("high"), l: find("low"), c: find("close"),
      v: find("volume", "vol", "tickvolume", "tick volume"),
      // a date+time split across two columns (Sierra does this)
      t2: find("time") >= 0 && find("date") >= 0 ? find("time") : -1,
    }
  : { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5, t2: -1 };
const DATE_IX = hasHeader && IX.t2 >= 0 ? find("date") : IX.t;

const bars = [];
let skipped = 0;
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  const p = line.split(delim);
  if (p.length < 5) continue;

  const stamp = IX.t2 >= 0 ? `${p[DATE_IX]} ${p[IX.t2]}` : p[DATE_IX];
  const ts = parseStamp(stamp ?? "");
  if (!ts) { skipped++; continue; }                       // header row lands here too
  if (!ALL_HOURS && (ts.min < RTH_OPEN || ts.min >= RTH_CLOSE)) continue;

  const o = +p[IX.o], h = +p[IX.h], l = +p[IX.l], c = +p[IX.c];
  const v = IX.v >= 0 ? +p[IX.v] : 0;
  if (![o, h, l, c].every(Number.isFinite)) { skipped++; continue; }
  if (h < l) { skipped++; continue; }                     // corrupt bar

  bars.push({ date: ts.date, min: ts.min, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
}

if (!bars.length) {
  console.error(`\nparsed 0 bars from ${IN}`);
  console.error(`  delimiter: "${delim}"   header detected: ${hasHeader}`);
  console.error(`  first line: ${(lines.find((l) => l.trim()) || "").slice(0, 120)}`);
  console.error(`\nSupported timestamps: "20240102 093000", "2024-01-02 09:30:00", ISO, "01/02/2024 09:30", unix epoch.`);
  process.exit(1);
}
console.log(`  format: ${hasHeader ? "header row" : "positional"} · delim "${delim}" · ${skipped.toLocaleString()} lines skipped (header/bad/corrupt)`);

/* group into sessions */
const byDay = new Map();
for (const b of bars) {
  if (!byDay.has(b.date)) byDay.set(b.date, []);
  byDay.get(b.date).push(b);
}
const sessions = [...byDay.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([date, bs]) => ({ date, bars: bs.sort((a, b) => a.min - b.min) }))
  .filter((s) => s.bars.length >= 60);   // drop half-days / broken feeds

console.log(`${bars.length.toLocaleString()} bars · ${sessions.length} sessions · ${sessions[0].date} → ${sessions[sessions.length - 1].date}`);

/* ── helpers ──────────────────────────────────────────────────────────────── */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const variance = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
const pctile = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (date) => DOW[new Date(date + "T12:00:00Z").getUTCDay()];
/** log return in basis points */
const bp = (a, b) => Math.log(b / a) * 1e4;

/**
 * Resample one session's 1m bars to `tf` minutes.
 *
 * Buckets are anchored to a FIXED CLOCK GRID (09:30 in RTH, midnight in 24h) —
 * NOT to the session's first bar. This matters more than it looks: anchoring to
 * the first bar means a session that's missing its 09:30 print shifts every
 * bucket by a minute, and each shifted bucket then lands in its own brand-new
 * time-of-day cell. That's how NQ produced 108 "hourly" cells instead of 7 and
 * shredded the seasonality table into near-empty slivers.
 *
 * The bucket's `min` is the GRID minute (09:30, 09:35, …), so the same clock
 * bucket from every session aggregates together no matter how ragged the open.
 */
function resample(sbars, tf) {
  if (tf === 1) return sbars;
  const base = ALL_HOURS ? 0 : RTH_OPEN;
  const out = [];
  let cur = null;
  for (const b of sbars) {
    const k = Math.floor((b.min - base) / tf);
    const gridMin = base + k * tf;               // the bucket's canonical clock time
    if (!cur || cur.k !== k) {
      if (cur) out.push(cur);
      cur = { k, date: b.date, min: gridMin, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
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

const TFS = [1, 5, 15, 30, 60];
/** sessions resampled once, reused by every block below */
const RS = Object.fromEntries(TFS.map((tf) => [tf, sessions.map((s) => ({ date: s.date, bars: resample(s.bars, tf) }))]));

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. TIME-OF-DAY SEASONALITY
 * ═══════════════════════════════════════════════════════════════════════════ */

function todCell(rows) {
  // rows: { ret, absRet, range, up, vol, drift }
  const n = rows.length;
  if (!n) return null;
  return {
    n,
    ret: r4(mean(rows.map((r) => r.ret))),          // bp
    absRet: r4(mean(rows.map((r) => r.absRet))),    // bp
    range: r2(mean(rows.map((r) => r.range))),      // points
    up: r4(rows.filter((r) => r.up).length / n),    // probability
    vol: Math.round(mean(rows.map((r) => r.vol))),
    drift: r2(mean(rows.map((r) => r.drift))),      // points from session open
  };
}

function buildTod(tf, dowFilter = null) {
  const cells = new Map();   // minute-of-day → rows
  for (const s of RS[tf]) {
    if (dowFilter && dowOf(s.date) !== dowFilter) continue;
    const open = s.bars[0].o;
    for (let i = 0; i < s.bars.length; i++) {
      const b = s.bars[i];
      // Return is close-to-close and NEVER crosses a session boundary. The first
      // bar of the day has no prior close inside the session, so it uses its own
      // open→close instead. Skipping it (the obvious move) silently DELETES the
      // 09:30 bucket — the single most important cell in this table. Don't.
      const prev = i > 0 ? s.bars[i - 1].c : b.o;
      const ret = bp(prev, b.c);
      if (!Number.isFinite(ret)) continue;
      if (!cells.has(b.min)) cells.set(b.min, []);
      cells.get(b.min).push({
        ret,
        absRet: Math.abs(ret),
        range: b.h - b.l,
        up: b.c > b.o,
        vol: b.v,
        drift: b.c - open,
      });
    }
  }
  return [...cells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([min, rows]) => ({ min, ...todCell(rows) }));
}

const tod = {
  min1: buildTod(1),
  min5: buildTod(5),
  min30: buildTod(30),
  hour: buildTod(60),
  hourByDow: Object.fromEntries(["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => [d, buildTod(60, d)])),
  min30ByDow: Object.fromEntries(["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => [d, buildTod(30, d)])),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. RANGE / VOLATILITY STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════════ */

function rangeStats(tf) {
  const ranges = [];
  const bodies = [];
  for (const s of RS[tf]) {
    for (const b of s.bars) {
      const r = b.h - b.l;
      ranges.push(r);
      if (r > 0) bodies.push(Math.abs(b.c - b.o) / r);
    }
  }
  return {
    mean: r2(mean(ranges)),
    p50: r2(pctile(ranges, 50)),
    p75: r2(pctile(ranges, 75)),
    p90: r2(pctile(ranges, 90)),
    p95: r2(pctile(ranges, 95)),
    p99: r2(pctile(ranges, 99)),
    bodyPct: r4(mean(bodies)),   // body / range — 1 = marubozu, 0 = all wick
  };
}

/** Inside / outside bars: frequency, and what the NEXT bar does. */
function barPatterns(tf) {
  const med = pctile(RS[tf].flatMap((s) => s.bars.map((b) => b.h - b.l)), 50);
  const rec = { inside: [], outside: [], nr: [] };
  for (const s of RS[tf]) {
    const B = s.bars;
    // trailing quartile of the session's own ranges so "narrow" is relative,
    // computed from bars BEFORE i only — no lookahead.
    for (let i = 1; i < B.length - 1; i++) {
      const p = B[i - 1], b = B[i], nx = B[i + 1];
      const nxRange = nx.h - nx.l;
      const nxUp = nx.c > nx.o;
      const item = { expand: nxRange > 1.5 * med, nxRange, nxUp, up: b.c > b.o, brokeUp: nx.h > b.h, brokeDn: nx.l < b.l };
      if (b.h <= p.h && b.l >= p.l) rec.inside.push(item);
      if (b.h > p.h && b.l < p.l) rec.outside.push(item);
      const prior = B.slice(Math.max(0, i - 20), i).map((x) => x.h - x.l);
      const q1 = pctile(prior, 25);
      if (q1 != null && prior.length >= 10 && b.h - b.l <= q1) rec.nr.push(item);
    }
  }
  const total = RS[tf].reduce((s, x) => s + Math.max(0, x.bars.length - 2), 0);
  const pack = (a) => ({
    freq: r4(a.length / (total || 1)),
    n: a.length,
    expand: r4(a.filter((x) => x.expand).length / (a.length || 1)),
    nextUp: r4(a.filter((x) => x.nxUp).length / (a.length || 1)),
    brokeUp: r4(a.filter((x) => x.brokeUp).length / (a.length || 1)),
    brokeDn: r4(a.filter((x) => x.brokeDn).length / (a.length || 1)),
    bothSides: r4(a.filter((x) => x.brokeUp && x.brokeDn).length / (a.length || 1)),
  });
  return { medRange: r2(med), inside: pack(rec.inside), outside: pack(rec.outside), narrowRange: pack(rec.nr) };
}

/** True range by hour and by weekday, on 60m bars. */
function atrBy(key) {
  const cells = new Map();
  for (const s of RS[60]) {
    for (const b of s.bars) {
      const k = key === "hour" ? Math.floor(b.min / 60) : dowOf(s.date);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(b.h - b.l);
    }
  }
  return [...cells.entries()]
    .sort((a, b) => (typeof a[0] === "number" ? a[0] - b[0] : DOW.indexOf(a[0]) - DOW.indexOf(b[0])))
    .map(([k, v]) => ({ key: String(k), n: v.length, atr: r2(mean(v)), p90: r2(pctile(v, 90)) }));
}

const vol = {
  ranges: Object.fromEntries(TFS.map((tf) => [tf, rangeStats(tf)])),
  patterns: Object.fromEntries([5, 15, 30].map((tf) => [tf, barPatterns(tf)])),
  atrByHour: atrBy("hour"),
  atrByDow: atrBy("dow"),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. AUTOCORRELATION, VARIANCE RATIO, STREAKS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Within-session log returns (bp) at a timeframe — never crosses a session. */
function retsBySession(tf) {
  return RS[tf].map((s) => {
    const r = [];
    for (let i = 1; i < s.bars.length; i++) {
      const x = bp(s.bars[i - 1].c, s.bars[i].c);
      if (Number.isFinite(x)) r.push(x);
    }
    return { date: s.date, r };
  });
}

/** ACF at lag k, pooled across sessions but never pairing across a boundary. */
function acf(seqs, k) {
  const all = seqs.flatMap((s) => s.r);
  const m = mean(all);
  const v = variance(all);
  if (v == null || v === 0) return null;
  let cov = 0, n = 0;
  for (const s of seqs) {
    for (let i = 0; i + k < s.r.length; i++) {
      cov += (s.r[i] - m) * (s.r[i + k] - m);
      n++;
    }
  }
  return n ? r4(cov / n / v) : null;
}

function varianceRatio(seqs, q) {
  const one = seqs.flatMap((s) => s.r);
  const v1 = variance(one);
  if (!v1) return null;
  const agg = [];
  for (const s of seqs) {
    for (let i = 0; i + q <= s.r.length; i += q) {
      agg.push(s.r.slice(i, i + q).reduce((a, b) => a + b, 0));
    }
  }
  const vq = variance(agg);
  return vq == null ? null : r4(vq / (q * v1));
}

/** After k consecutive same-direction bars, does the next bar continue? */
function streaks(tf) {
  const out = new Map();       // k → { cont, n }
  const byHour = new Map();    // "k|hour" → { cont, n }
  for (const s of RS[tf]) {
    const B = s.bars;
    let run = 0, dir = 0;
    for (let i = 0; i < B.length - 1; i++) {
      const d = B[i].c > B[i].o ? 1 : B[i].c < B[i].o ? -1 : 0;
      if (d === 0) { run = 0; dir = 0; continue; }
      run = d === dir ? run + 1 : 1;
      dir = d;
      if (run < 1 || run > 6) continue;
      const nx = B[i + 1];
      const nd = nx.c > nx.o ? 1 : nx.c < nx.o ? -1 : 0;
      if (nd === 0) continue;
      const cont = nd === dir;
      for (const [map, key] of [[out, run], [byHour, `${run}|${Math.floor(B[i].min / 60)}`]]) {
        if (!map.has(key)) map.set(key, { cont: 0, n: 0 });
        const c = map.get(key);
        c.n++;
        if (cont) c.cont++;
      }
    }
  }
  return {
    byRun: [...out.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => ({ run: k, n: v.n, cont: r4(v.cont / v.n) })),
    byRunHour: [...byHour.entries()].map(([k, v]) => {
      const [run, hour] = k.split("|").map(Number);
      return { run, hour, n: v.n, cont: r4(v.cont / v.n) };
    }),
  };
}

const auto = {};
for (const tf of [1, 5, 15, 30]) {
  const seqs = retsBySession(tf);
  const abs = seqs.map((s) => ({ date: s.date, r: s.r.map(Math.abs) }));
  auto[tf] = {
    acf: Array.from({ length: 20 }, (_, i) => ({ lag: i + 1, v: acf(seqs, i + 1) })),
    acfAbs: Array.from({ length: 20 }, (_, i) => ({ lag: i + 1, v: acf(abs, i + 1) })),
    vr: [2, 4, 8, 16].map((q) => ({ q, v: varianceRatio(seqs, q) })),
    streaks: streaks(tf),
  };
}

/* ── write ────────────────────────────────────────────────────────────────── */

const out = {
  symbol: SYM,
  generated: new Date().toISOString(),
  source: path.basename(IN),
  hours: ALL_HOURS ? "24h" : "RTH 09:30–16:00 ET",
  sessions: sessions.length,
  bars: bars.length,
  from: sessions[0].date,
  to: sessions[sessions.length - 1].date,
  tod,
  vol,
  auto,
};

/* SANITY CHECK — the bucket grid must produce EXACTLY the number of cells the
 * session length implies. Both directions are bugs and both have already bitten:
 *   TOO MANY  → resample() is fragmenting on ragged opens (a missing 09:30 print
 *               shifts every bucket into its own new cell).
 *   TOO FEW   → a cell is being dropped, e.g. skipping the session's first bar
 *               because it has no prior close deletes the 09:30 bucket outright.
 * Either way the time-of-day table is garbage, so refuse to write it. */
const span = ALL_HOURS ? 1440 : RTH_CLOSE - RTH_OPEN;
for (const [name, tf, cells] of [["hour", 60, tod.hour], ["min30", 30, tod.min30], ["min5", 5, tod.min5], ["min1", 1, tod.min1]]) {
  const expect = Math.ceil(span / tf);
  if (cells.length !== expect) {
    console.error(
      `\nFATAL: ${name} produced ${cells.length} cells, expected ${expect}.` +
      `\n  ${cells.length > expect ? "Bucket grid is FRAGMENTING (ragged session opens)." : "Cells are being DROPPED (check the first-bar-of-session path)."}` +
      `\n  Time-of-day stats would be wrong. Refusing to write ${OUT}.`
    );
    process.exit(1);
  }
}
console.log(`  sanity: bucket grids intact (${tod.hour.length}h / ${tod.min30.length}×30m / ${tod.min5.length}×5m / ${tod.min1.length}×1m cells)`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\nwrote ${OUT}  (${kb} KB)`);
console.log(`  time-of-day: ${tod.hour.length} hourly cells, ${tod.min1.length} minute cells`);
console.log(`  vol: ranges @ ${TFS.join("/")}m, patterns @ 5/15/30m`);
console.log(`  auto: ACF 20 lags + VR + streaks @ 1/5/15/30m`);
console.log(`\nNow reload /scanner → Stat Prompter. The "Bar Stats" prompts will light up.`);
