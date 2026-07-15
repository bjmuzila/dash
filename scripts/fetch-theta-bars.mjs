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
 *   node scripts/fetch-theta-bars.mjs --sym NVDA --start 20200101 --end 20260710 --rth
 *
 * FLAGS
 *   --sym <SYM>        stock symbol (required)
 *   --start/--end      YYYYMMDD (default: last ~2y → last settled weekday)
 *   --ivl <dur>        DURATION STRING: 1m (default), 3m, 5m, 1h. NOT milliseconds.
 *                      Pull 1m and resample downstream — one fetch, any TF.
 *   --ivlparam <name>  default `interval`. Only change if Theta's API moves.
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
import { detectSplits, applySplits, reportSplits } from "./lib/splits.mjs";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const has = (k) => argv.includes(`--${k}`);

const SYM = (arg("sym") || "").toUpperCase();
// SOLVED 2026-07-15 by probe: v3 wants a DURATION STRING on `interval`, not ms.
//   interval=1m   → 391 rows ✓        ivl=<anything>        → 410 Gone
//   interval=60   → 500 Server Error  interval_size/_ms/... → silently IGNORED
// Keep as a string — `+arg()` would coerce "1m" to NaN.
const IVL = arg("ivl", "1m");
const RTH = has("rth");
const PROBE = has("probe");
const DAILY = has("daily");
const RESAMPLE_1S = has("resample1s");
const NO_ADJUST = has("no-adjust");
const BASE = (process.env.THETA_BASE_URL || "http://127.0.0.1:25503").replace(/\/+$/, "");

if (!SYM) {
  console.error("usage: node scripts/fetch-theta-bars.mjs --sym NVDA [--probe]");
  process.exit(1);
}

const today = new Date();
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

// Theta writes intraday history at EOD, so TODAY returns 472 "No data found"
// even when everything is configured correctly — an infuriating false negative
// when you're trying to establish whether the endpoint works at all. Default the
// end date to the last weekday that is at least 1 day old.
function lastSettled(from) {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}
const DEFAULT_END = ymd(lastSettled(today));
const twoYrAgo = new Date(today); twoYrAgo.setFullYear(today.getFullYear() - 2);
const START = arg("start", ymd(twoYrAgo));
const END = arg("end", DEFAULT_END);
const OUT = arg("out", path.join(process.cwd(), "public", "data", `${SYM}_${DAILY ? "daily" : "1min"}.csv`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let everConnected = false;

async function get(q, attempt = 0) {
  const url = `${BASE}${q}${q.includes("?") ? "&" : "?"}format=json`;
  let res, text;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
    everConnected = true;
    // MUST stay inside the try. fetch() resolves as soon as HEADERS arrive; the
    // body streams afterwards, and that's the phase an SSH tunnel actually dies
    // in on a long pull. undici throws a bare "terminated" from res.text() — when
    // this line sat outside the catch it bypassed the retry below entirely and
    // killed an 11-year NVDA pull at 2019 with no retry attempted.
    text = await res.text();
  } catch (e) {
    // fetch() throws a bare "fetch failed" on connection errors — the real cause
    // is nested in e.cause and node hides it by default.
    const cause = e?.cause?.code || e?.cause?.message || e.message;

    // A long pull over an SSH tunnel WILL drop sockets. That's transient, not
    // misconfiguration — retry it. Only claim "tunnel is down" if we never
    // connected at all; otherwise the advice is actively misleading (you'd go
    // check a tunnel that's working fine).
    // "terminated" = undici's body-stream abort (see res.text() above). It is the
    // single most common failure on a multi-year tunnelled pull, and it was NOT
    // in this list — so it fell straight through to the fatal throw.
    const transient = /UND_ERR_SOCKET|ECONNRESET|EPIPE|ETIMEDOUT|other side closed|terminated/i.test(String(cause));
    if (transient && attempt < 5) {
      const wait = 1000 * 2 ** attempt;
      process.stderr.write(`\n    ${cause} — retry ${attempt + 1}/5 in ${wait / 1000}s `);
      await sleep(wait);
      return get(q, attempt + 1);
    }

    throw new Error(
      everConnected
        ? `THETA CONNECTION DROPPED after ${attempt} retries  (${cause})\n\n` +
          `  Earlier requests SUCCEEDED, so the tunnel/config is fine — the socket\n` +
          `  died mid-pull. Restart the tunnel and re-run; --start from where it\n` +
          `  stopped. If it dies repeatedly at the same year, that year is the problem.\n`
        : `CANNOT REACH THETA at ${BASE}  (${cause})\n\n` +
          `  The Terminal runs on the VPS, published to ITS loopback only.\n` +
          `  Open the tunnel in a separate window and leave it running:\n\n` +
          `    ssh -i C:\\Users\\Brandon\\.ssh\\cbedge -N -L 25503:127.0.0.1:25503 root@178.156.137.36\n\n` +
          `  Verify it's up:  curl http://127.0.0.1:25503/v3/system/mdds/status\n` +
          `  Or point at another host:  $env:THETA_BASE_URL="http://..."\n`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${res.status} ${res.statusText}\n  ${url}\n  ${text.slice(0, 400)}\n\n` +
      (res.status === 472
        ? "  472 = NOT_FOUND. The route EXISTS (Theta answered) — so this is almost\n" +
          "  always the DATE, not the path. Intraday history is written at EOD, so\n" +
          "  today/weekends/holidays return 472. Try an older session: --end 20260710\n"
        : "") +
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

// The interval param name is EMPIRICAL, not documented-and-trusted: v3 silently
// IGNORES an unknown interval param and returns 1-second bars instead of
// erroring. `interval_size` produced 23,401 rows for one session (= 23,400
// seconds of RTH) — a plausible-looking response that is completely wrong. Never
// assume a param took effect; verify by row count.
const IVL_PARAM = arg("ivlparam", "interval");
const PATH_ = (s, e, ivlParam = IVL_PARAM, ivl = IVL) =>
  DAILY
    // /v3/stock/history/eod is the one stock-history route already proven in
    // this repo (proxy-thetadata.js:588). No interval param, no ambiguity.
    ? `/v3/stock/history/eod?symbol=${encodeURIComponent(SYM)}&start_date=${s}&end_date=${e}`
    : `/v3/stock/history/ohlc?symbol=${encodeURIComponent(SYM)}&start_date=${s}&end_date=${e}` +
      (ivlParam ? `&${ivlParam}=${ivl}` : "");

if (PROBE && DAILY) {
  console.log(`probing DAILY ${BASE}${PATH_("20260101", END)}\n`);
  const r = rows(await get(PATH_("20260101", END)));
  console.log(`parsed ${r.length} rows (expect ~130 for Jan→Jul). first 3 RAW:\n`);
  console.log(JSON.stringify(r.slice(0, 3), null, 2));
  console.log(`\nkeys: ${r[0] ? Object.keys(r[0]).join(", ") : "(none)"}`);
  process.exit(0);
}

if (PROBE) {
  console.log(`probing ${BASE} for ${SYM} on ${END}\n`);

  // Baseline: no interval param at all. Whatever this returns is the default,
  // and any candidate that MATCHES it was ignored.
  const base = rows(await get(PATH_(END, END, null)));
  console.log(`  (no interval param)      ${String(base.length).padStart(6)} rows  ← default`);

  const want = 390; // RTH minutes
  let winner = null;

  // An UNKNOWN param is silently ignored (row count == default). A param that
  // ERRORS is RECOGNISED — the name is right and the VALUE is wrong. So the
  // error text is the most informative thing here, and swallowing it with a
  // bare catch{} (as this did) throws away the answer. Print it.
  const names = ["ivl", "interval", "interval_size", "interval_ms", "ivl_ms"];
  const values = [60000, 60, "1m", "1min", "60s"];

  for (const p of names) {
    for (const v of values) {
      let n = null, err = null;
      try { n = rows(await get(PATH_(END, END, p, v))).length; }
      catch (e) { err = String(e.message).split("\n").find((l) => /\w/.test(l.replace(/^\s*\d+\s*$/, ""))) || e.message; }

      if (err) {
        // Theta's error body usually NAMES the acceptable values. That's the payload.
        const body = err.replace(/\s+/g, " ").slice(0, 150);
        console.log(`  ${(p + "=" + v).padEnd(24)} ${"ERR".padStart(6)}  ${body}`);
        continue;
      }
      const ignored = n === base.length;
      const ok = Math.abs(n - want) <= 30;
      if (ok && !winner) winner = { p, v };
      console.log(
        `  ${(p + "=" + v).padEnd(24)} ${String(n).padStart(6)} rows` +
        (ok ? `  ✓ THIS ONE (≈390 = RTH minutes)` : ignored ? "  ✗ ignored (unknown param)" : "  ? unexpected count")
      );
      if (ok) break; // found it for this name, stop hammering the terminal
    }
  }
  console.log(`\nfirst 3 RAW (default granularity):\n`);
  console.log(JSON.stringify(base.slice(0, 3), null, 2));
  console.log(`\nkeys: ${base[0] ? Object.keys(base[0]).join(", ") : "(none)"}`);
  console.log(
    winner
      ? `\n→ use: --ivlparam ${winner.p} --ivl ${winner.v}`
      : `\n→ No combination produced ~390 rows.\n` +
        `  Read the ERR bodies above — a recognised-but-invalid param usually names\n` +
        `  its legal values. If nothing works, --resample1s pulls the 1-second default\n` +
        `  and folds it to 1m locally (~23k rows/session, so years will be slow).`
  );
  process.exit(0);
}

/* ── pull, chunked by month (a multi-year 1m pull in one request will time out) ── */
function* months(start, end) {
  // Daily bars are ~250 rows/yr — chunk by YEAR. Intraday 1m is ~8k rows/month,
  // so chunk by month or the request times out.
  if (DAILY) {
    let y = +start.slice(0, 4);
    const ey = +end.slice(0, 4);
    for (; y <= ey; y++) {
      const s = `${y}0101`, e = `${y}1231`;
      yield [s < start ? start : s, e > end ? end : e];
    }
    return;
  }
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
let bad = 0, padded = 0;
const volByDate = new Map(); // date → total volume, for the holiday filter

/**
 * Theta PADS non-trading days: it returns a full 391-bar RTH session for every
 * CALENDAR day, weekends and holidays included (31 × 391 = 12,121 rows for a
 * 31-day month, vs the ~8,200 a real month has). The padded bars are not
 * malformed — they carry a plausible price — so no field-level validation
 * catches them. In a streak study they'd show up as ties or fake flat bars that
 * break genuine runs.
 *
 * Weekends are structural: kill by day-of-week. Use Date.UTC to derive it —
 * new Date("2015-01-03") parses as UTC midnight but .getDay() reads it in LOCAL
 * time, which shifts the day backwards for anyone west of Greenwich and would
 * silently delete Fridays.
 */
function isWeekend(ymd) {
  const dow = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
  return dow === 0 || dow === 6;
}
for (const [s, e] of months(START, END)) {
  process.stderr.write(`  ${s}..${e} `);
  let r;
  try { r = rows(await get(PATH_(s, e))); }
  catch (err) {
    // Don't throw away the chunks that already worked. Write what we have and
    // report the resume point — re-pulling 10 good years because year 11 blipped
    // is how you end up not running the study at all.
    console.error(`\n${err.message}`);
    if (out.length) {
      const partial = OUT.replace(/\.csv$/, ".partial.csv");
      fs.mkdirSync(path.dirname(partial), { recursive: true });
      fs.writeFileSync(partial, out.join("\n") + "\n");
      console.error(`  Kept ${out.length.toLocaleString()} rows → ${partial}`);
      console.error(`  Resume with:  --start ${s}\n`);
    }
    process.exit(1);
  }

  for (const x of r) {
    // v3 returns `timestamp` as a NAIVE ISO string already in ET wall-clock
    // ("2026-07-10T09:30:00.000" = the open). Do NOT feed that to Date() — node
    // would read it as local time and shift every bar by your UTC offset, which
    // silently rotates the whole session and wrecks any time-of-day analysis.
    // String-slice it instead. (ms_of_day/date branch kept for other endpoints.)
    let date, hh, mm;
    const ts = String(x.timestamp ?? "");
    const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (DAILY) {
      // The /eod route carries NO `date` and NO `timestamp` — the session date
      // lives inside `created` / `last_trade` ISO strings. Same fallback chain
      // proxy-thetadata.js:561 already uses. Take only the DATE portion: those
      // stamps read ~17:15 (consolidated-tape finalisation, after the 16:00
      // close), so the clock time is meaningless and Date() would shift it.
      const iso = String(x.date ?? x.created ?? x.last_trade ?? "");
      const dm = iso.length === 8 ? iso : (iso.match(/^(\d{4})-(\d{2})-(\d{2})/) || []).slice(1, 4).join("");
      if (dm.length !== 8) { bad++; continue; }
      // One bar per session. Stamp 16:00 so it survives any RTH filter downstream.
      date = dm; hh = "16"; mm = "00";
    } else if (m) {
      date = m[1] + m[2] + m[3]; hh = m[4]; mm = m[5];
    } else if (String(x.date ?? "").length === 8 && Number.isFinite(Number(x.ms_of_day))) {
      date = String(x.date);
      const mins = Math.floor(Number(x.ms_of_day) / 60000);
      hh = String(Math.floor(mins / 60)).padStart(2, "0");
      mm = String(mins % 60).padStart(2, "0");
    } else { bad++; continue; }

    if (!DAILY && isWeekend(date)) { padded++; continue; } // Theta pads Sat/Sun

    const o = Number(x.open), h = Number(x.high), l = Number(x.low), c = Number(x.close);
    const v = Number(x.volume ?? 0);
    if (!(c > 0) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l)) { bad++; continue; }
    const mins = +hh * 60 + +mm;
    if (RTH && (mins < 570 || mins >= 960)) continue;
    volByDate.set(date, (volByDate.get(date) || 0) + v);
    out.push(`${date} ${hh}${mm}00,${o},${h},${l},${c},${v}`);
  }
  process.stderr.write(`${r.length}\n`);
}

if (!out.length) {
  console.error(`\nZERO rows. Run --probe and paste the output — the field names are wrong.`);
  process.exit(1);
}

/* ── local 1s → 1m fold ───────────────────────────────────────────────────── */
// Last resort if Theta won't bucket server-side. Correct, just wasteful: we pay
// to move 23,400 rows/session over the wire to keep 390 of them.
if (RESAMPLE_1S) {
  const byKey = new Map(); // "YYYYMMDD HHMM" → rows
  for (const line of out) {
    const [stamp, o, h, l, c, v] = line.split(",");
    const key = stamp.slice(0, 13); // "YYYYMMDD HHMM"
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ o: +o, h: +h, l: +l, c: +c, v: +v });
  }
  const folded = [];
  for (const key of [...byKey.keys()].sort()) {
    const g = byKey.get(key);
    folded.push(
      `${key}00,${g[0].o},${Math.max(...g.map((x) => x.h))},${Math.min(...g.map((x) => x.l))},` +
      `${g[g.length - 1].c},${g.reduce((s, x) => s + x.v, 0)}`
    );
  }
  console.error(`  folded ${out.length.toLocaleString()} 1s bars → ${folded.length.toLocaleString()} 1m bars`);
  out.length = 0; out.push(...folded);
}

/* ── HOLIDAY FILTER ───────────────────────────────────────────────────────── */
// Weekends are killed structurally by day-of-week, but market holidays fall on
// weekdays and Theta pads those identically. There's no calendar to check
// against and hardcoding US holidays rots (see memory: mvc-rth-holiday-gate).
// Volume is the honest tell: a padded session trades ZERO shares. A real NVDA
// RTH session trades tens of millions, so the threshold isn't close.
if (!DAILY) {
  const dead = new Set([...volByDate].filter(([, v]) => v <= 0).map(([d]) => d));
  if (dead.size) {
    const before = out.length;
    const kept = out.filter((line) => !dead.has(line.slice(0, 8)));
    console.error(`  holidays: dropped ${dead.size} zero-volume sessions (${(before - kept.length).toLocaleString()} padded bars)`);
    out.length = 0; out.push(...kept);
  }
  // Half-days (July 3, day after Thanksgiving, Christmas Eve) are REAL sessions
  // that legitimately end at 13:00 — ~211 bars, not 391. They must survive. Flag
  // anything else short, since a truncated normal session means missing data.
  const cnt = new Map();
  for (const line of out) cnt.set(line.slice(0, 8), (cnt.get(line.slice(0, 8)) || 0) + 1);
  const odd = [...cnt].filter(([, n]) => n < 380 && n > 250);
  if (odd.length) console.error(`  ⚠ ${odd.length} session(s) with 250-380 bars — partial data, not half-days. e.g. ${odd.slice(0, 3).map(([d, n]) => d + ":" + n).join(", ")}`);
}

/* ── SPLIT ADJUSTMENT ─────────────────────────────────────────────────────── */
// CONFIRMED: Theta returns RAW prices. NVDA daily came back with 2015 at $20.13
// (vs ~$0.50 adjusted) and fake -75% / -89.9% bars on the 4:1 and 10:1 split
// dates. Detect and back-adjust by default — an unadjusted series is simply
// wrong for anything measuring returns, and warning-and-continuing just means
// the warning gets scrolled past (it did).
if (!NO_ADJUST) {
  // Splits are corporate actions on the DAY, so detect on daily closes. On an
  // intraday file, testing bar-to-bar would fire on every overnight gap and miss
  // the split entirely — collapse to one close per session first.
  const perDay = new Map();
  for (const l of out) { const p = l.split(","); perDay.set(p[0].slice(0, 8), +p[4]); }
  const dayBars = [...perDay].sort().map(([date, c]) => ({ date, c }));

  const splits = detectSplits(dayBars);
  if (splits.length) { console.error(`\nSPLITS`); reportSplits(splits); }

  if (splits.some((s) => s.ratio)) {
    const parsed = out.map((l) => {
      const p = l.split(",");
      return { stamp: p[0], date: p[0].slice(0, 8), o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 };
    });
    const n = applySplits(parsed, splits);
    const dp = (x) => (Math.abs(x) < 1 ? x.toFixed(6) : x.toFixed(4));
    out.length = 0;
    out.push(...parsed.map((b) => `${b.stamp},${dp(b.o)},${dp(b.h)},${dp(b.l)},${dp(b.c)},${Math.round(b.v)}`));
    console.error(`  ${n.toLocaleString()} bars back-adjusted  (--no-adjust to keep raw)`);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join("\n") + "\n");
const days = new Set(out.map((l) => l.slice(0, 8)));
console.log(`\nwrote ${OUT}`);
console.log(`  ${out.length.toLocaleString()} bars over ${days.size} sessions  (${bad} unparseable, ${padded.toLocaleString()} weekend-padded dropped)`);
console.log(`  ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
// ~252 sessions/yr is the sanity anchor. Materially more means padding survived;
// materially fewer means chunks are missing.
if (!DAILY) {
  const yrs = (new Date(`${END.slice(0, 4)}-${END.slice(4, 6)}-${END.slice(6, 8)}`) -
               new Date(`${START.slice(0, 4)}-${START.slice(4, 6)}-${START.slice(6, 8)}`)) / 3.156e10;
  const perYr = days.size / Math.max(yrs, 0.1);
  console.log(`  ${perYr.toFixed(0)} sessions/yr  ${perYr > 265 ? "← ⚠ TOO MANY: padding survived the filter" : perYr < 240 ? "← ⚠ TOO FEW: missing data" : "✓"}`);
}
