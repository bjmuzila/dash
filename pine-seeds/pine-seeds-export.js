#!/usr/bin/env node
/**
 * pine-seeds-export.js
 *
 * Reads ticker_levels (Postgres) and writes Pine Seeds data files so a PUBLISHED
 * TradingView indicator can pull your EM levels via request.seed() — i.e. anyone
 * who adds the indicator gets YOUR levels, because request.seed() reads YOUR repo.
 *
 * Pine Seeds stores DAILY OHLCV bars only (one value per symbol per day), so each
 * level becomes its own symbol whose O=H=L=C = the level value, volume=0.
 *
 *   data/<REPO>/<TICKER>_<LEVEL>.csv     e.g. data/seed_xxx/SPX_EM_UP.csv
 *   symbol_info/<REPO>.json              one JSON describing every symbol
 *
 * Cadence: Pine Seeds is END-OF-DAY. A row pushed today shows on charts tomorrow.
 * Fine for weekly EM (static all week). Run this once per trading day after the
 * weekly/daily levels publish, then git add/commit/push the repo.
 *
 * Usage:
 *   DATABASE_URL=... node pine-seeds-export.js \
 *       --repo seed_yourname_em \
 *       --out  /path/to/your/forked/seeds/repo \
 *       [--tickers SPX,ESU,NDX]   (default: all rows)
 *       [--date YYYYMMDD]         (default: today, US Eastern)
 *
 * Symbol naming: <TICKER>_<LEVEL>, uppercased, matches ^[A-Z0-9._]+$.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// ── Args ──────────────────────────────────────────────────────────
function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const REPO = arg("repo", "seed_em_levels");
const OUT = arg("out");
const ONLY = (arg("tickers", "") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
if (!OUT) {
  console.error("ERROR: --out <path-to-seeds-repo> is required");
  process.exit(1);
}

// Today's date in US/Eastern as YYYYMMDD (markets close on Eastern calendar).
function easternYmd() {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(new Date()).replace(/-/g, ""); // en-CA → YYYY-MM-DD
}
const DATE = arg("date", easternYmd());
const DATE_T = `${DATE}T`; // Pine Seeds wants the trailing T: 20260620T

// Map ticker_levels columns → seed level suffixes. Order = plot order in Pine.
const LEVELS = [
  ["up", "EM_UP"],
  ["down", "EM_DOWN"],
  ["close", "CLOSE"],
  ["pivot", "PIVOT"],
  ["buy_near", "BUY_NEAR"],
  ["buy_far", "BUY_FAR"],
  ["sell_near", "SELL_NEAR"],
  ["sell_far", "SELL_FAR"],
];

function num(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// Upsert one daily row into a symbol CSV: replace today's line if present, else
// append, then re-sort ascending by date and de-dup. Keeps the file valid.
function writeCsvRow(dataDir, symbol, value) {
  const file = path.join(dataDir, `${symbol}.csv`);
  const v = Number(value);
  const ohlcv = `${DATE_T},${v},${v},${v},${v},0`;
  let lines = [];
  if (fs.existsSync(file)) {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  }
  const map = new Map();
  for (const l of lines) {
    const d = l.split(",")[0];
    if (d) map.set(d, l);
  }
  map.set(DATE_T, ohlcv); // replace/insert today
  const sorted = [...map.values()].sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(file, sorted.join("\n") + "\n");
}

async function main() {
  const dataDir = path.join(OUT, "data", REPO);
  const infoDir = path.join(OUT, "symbol_info");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(infoDir, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
      ? undefined : { rejectUnauthorized: false },
  });

  const res = await pool.query("SELECT * FROM ticker_levels ORDER BY ticker ASC");
  await pool.end();

  const symbols = [];
  const descriptions = [];
  let rows = res.rows;
  if (ONLY.length) rows = rows.filter((r) => ONLY.includes(String(r.ticker).toUpperCase()));

  let wrote = 0;
  for (const row of rows) {
    const ticker = String(row.ticker || "").toUpperCase().replace(/[^A-Z0-9._]/g, "");
    if (!ticker) continue;
    const label = row.label || ticker;
    for (const [col, suffix] of LEVELS) {
      const v = num(row[col]);
      if (!Number.isFinite(v)) continue; // skip absent levels
      const symbol = `${ticker}_${suffix}`;
      writeCsvRow(dataDir, symbol, v);
      symbols.push(symbol);
      descriptions.push(`${label} ${suffix.replace(/_/g, " ")}`);
      wrote++;
    }
  }

  // symbol_info JSON — filename MUST equal repo name. pricescale 100 = 2 decimals,
  // adequate for index/equity levels. Single value applies to all symbols.
  const info = { symbol: symbols, description: descriptions, pricescale: 100 };
  fs.writeFileSync(path.join(infoDir, `${REPO}.json`), JSON.stringify(info, null, 2) + "\n");

  console.log(`Wrote ${wrote} level rows for ${rows.length} ticker(s) at ${DATE_T}`);
  console.log(`  data:        ${dataDir}`);
  console.log(`  symbol_info: ${path.join(infoDir, `${REPO}.json`)}`);
  console.log(`Next: cd ${OUT} && git add . && git commit -m "Update levels ${DATE}" && git push`);
}

main().catch((e) => { console.error(e); process.exit(1); });
