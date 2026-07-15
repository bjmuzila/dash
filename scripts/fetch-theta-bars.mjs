/**
 * scripts/fetch-theta-bars.mjs
 *
 * Pull INTRADAY stock bars from ThetaData and write a CSV in the exact format
 * lib/ibStats.ts + server-v2/strategy-engine.js already parse:
 *     YYYYMMDD HHMMSS,open,high,low,close,volume
 *
 *   # 1. probe first — dumps the raw JSON so we can see the real field names
 *   node scripts/fetch-theta-bars.mjs --sym NVDA --probe
 *
 *   # 2. then pull for real
 *   node scripts/fetch-theta-bars.mjs --sym NVDA --start 20200101 --end 20260710 --ivl 60000
 *
 * FLAGS
 *   --sym <SYM>        stock symbol (required)
 *   --start/--end      YYYYMMDD (default: last ~2y → today)
 *   --ivl <ms>         interval size in MS. 60000 = 1min (default), 180000 = 3min.
 *                      Pull 1min and resample downstream — one fetch, any TF.
 *   --out <path>       default public/data/<SYM>_1min.csv
 *   --rth              RTH only (09:30–16:00 ET). Default: keep everything.
 *   --probe            fetch ONE day, print raw JSON, write nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PROBE MODE: this repo only ever called /v3/stock/history/eod. The
 * intraday path and its entitlement are UNVERIFIED here. Rather than guess the
 * field names and silently write a garbage CSV, --probe shows you the actual
 * response. A backtest fed by a misparsed CSV is worse than no backtest — it
 * looks like a result.
 *
 * NOTE ON SPLITS: Theta stock history is split-adjusted at query time, so a
 * pull today is consistent end-to-end. NVDA did 4:1 (2021) and 10:1 (2024)
 * inside any multi-year window — if bars were NOT adjusted you'd see fake -75%
 * and -90% "down bars" on the split dates, which would wreck a streak study.
 * The script checks for this and yells. Do not skip that warning.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const has = (k) => argv.includes(`--${k}`);

const SYM = (arg("sym") || "").toUpperCase();
const IVL = +arg("ivl", 60000);
const RTH = has("rth");
const PROBE = has("probe");
const BASE = (process.env.THETA_BASE_URL || "http://127.0.0.1:25503").replace(/\/+$/, "");

if (!SYM) {
  console.error("usage: node scripts/fetch-theta-bars.mjs --sym NVDA [--probe]");
  process.exit(1);
}

const today = new Date();
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const twoYrAgo = new Date(today); twoYrAgo.setFullYear(today.getFullYear() - 2);
const START = arg("start", ymd(twoYrAgo));
const END = arg("end", ymd(today));
const OUT = arg("out", path.join(process.cwd(), "public", "data", `${SYM}_1min.csv`));

async function get(q) {
  const url = `${BASE}${q}${q.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${res.status} ${res.statusText}\n  ${url}\n  ${text.slice(0, 400)}\n\n` +
      (res.status === 472 ? "  472 = NOT_FOUND: wrong path, or no data for that range.\n" : "") +
      (res.status === 474 || res.status === 403 ? "  Looks like a TIER GATE — your Theta plan may not include intraday stock history.\n" : "") +
      (/ECONNREFUSED/.test(text) ? "" : "  Terminal reachable? Locally you need the SSH tunnel (see memory: local-dev-setup).\n")
    );
  }
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON response:\n${text.slice(0, 400)}`); }
}

/** Theta v3 returns either [{...}] objects or {header:{format:[...]},response:[[...]]}. */
function rows(json) {
  if (Array.isArray(json)) return json;
  const r = json?.response;
  if (!Array.isArray(r)) return [];
  if (r.length && Array.isArray(r[0])) {
    const fmt = json?.header?.format;
    if (!Array.isArray(fmt)) return [];
    return r.map((arr) => Object.fromEntries(fmt.map((k, i) => [k, arr[i]])));
  }
  return r;
}

const PATH_ = (s, e) =>
  `/v3/stock/history/ohlc?symbol=${encodeURIComponent(SYM)}&start_date=${s}&end_date=${e}&interval_size=${IVL}`;

if (PROBE) {
  console.log(`probing ${BASE}${PATH_(END, END)}\n`);
  const json = await get(PATH_(END, END));
  const r = rows(json);
  console.log(`parsed ${r.length} rows. first 3 RAW:\n`);
  console.log(JSON.stringify(r.slice(0, 3), null, 2));
  console.log(`\nkeys: ${r[0] ? Object.keys(r[0]).join(", ") : "(none — paste the above to Claude)"}`);
  process.exit(0);
}

/* ── pull, chunked by month (a multi-year 1m pull in one request will time out) ── */
function* months(start, end) {
  let y = +start.slice(0, 4), m = +start.slice(4, 6);
  const ey = +end.slice(0, 4), em = +end.slice(4, 6);
  while (y < ey || (y === ey && m <= em)) {
    const s = `${y}${String(m).padStart(2, "0")}01`;
    const last = new Date(y, m, 0).getDate();
    const e = `${y}${String(m).padStart(2, "0")}${last}`;
    yield [s < start ? start : s, e > end ? end : e];
    m++; if (m > 12) { m = 1; y++; }
  }
}

const out = [];
let bad = 0;
for (const [s, e] of months(START, END)) {
  process.stderr.write(`  ${s}..${e} `);
  let r;
  try { r = rows(await get(PATH_(s, e))); }
  catch (err) { console.error(`\n${err.message}`); process.exit(1); }

  for (const x of r) {
    const date = String(x.date ?? "");
    const ms = Number(x.ms_of_day);
    const o = Number(x.open), h = Number(x.high), l = Number(x.low), c = Number(x.close);
    const v = Number(x.volume ?? 0);
    if (date.length !== 8 || !Number.isFinite(ms) || !(c > 0)) { bad++; continue; }
    const mins = Math.floor(ms / 60000);
    if (RTH && (mins < 570 || mins >= 960)) continue;
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    out.push(`${date} ${hh}${mm}00,${o},${h},${l},${c},${v}`);
  }
  process.stderr.write(`${r.length}\n`);
}

if (!out.length) {
  console.error(`\nZERO rows. Run --probe and paste the output — the field names are wrong.`);
  process.exit(1);
}

/* ── SPLIT CHECK ──────────────────────────────────────────────────────────── */
// A raw (unadjusted) series prints a fake -75%/-90% bar on the split date and a
// streak study would happily count it. Cheap to detect, fatal to miss.
const closes = out.map((l) => +l.split(",")[4]);
const jumps = [];
for (let i = 1; i < closes.length; i++) {
  const ch = closes[i] / closes[i - 1] - 1;
  if (Math.abs(ch) > 0.35) jumps.push({ line: out[i], ch });
}
if (jumps.length) {
  console.error(`\n⚠ ${jumps.length} bar(s) moved >35% — almost certainly UNADJUSTED SPLITS:`);
  for (const j of jumps.slice(0, 6)) console.error(`    ${j.line.split(",")[0]}  ${(j.ch * 100).toFixed(1)}%`);
  console.error(`  NVDA split 4:1 on 2021-07-20 and 10:1 on 2024-06-10.`);
  console.error(`  DO NOT run a streak study on this — those are fake down bars. Tell Claude.`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join("\n") + "\n");
const days = new Set(out.map((l) => l.slice(0, 8)));
console.log(`\nwrote ${OUT}`);
console.log(`  ${out.length.toLocaleString()} bars over ${days.size} sessions  (${bad} unparseable)`);
console.log(`  ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
