#!/usr/bin/env node
/**
 * Import daily MVC xlsx files (server-v2/MVC/*.xlsx) into the mvc_snapshots table.
 *
 * Usage:
 *   node scripts/import-mvc.js                 # dry run — reports only, no writes
 *   node scripts/import-mvc.js --commit        # actually inserts
 *   node scripts/import-mvc.js --dir <path>    # override xlsx folder
 *   node scripts/import-mvc.js --file <one.xlsx>  # import a single file
 *
 * - Headers map 1:1 to mvc_snapshots columns (the `id` column is ignored).
 * - Unknown columns are reported and skipped; missing columns insert as null.
 * - Re-run safe: skips rows whose (date,timestamp) already exist.
 *
 * Requires DATABASE_URL in the environment (.env is auto-loaded).
 */

const fs = require("fs");
const path = require("path");
// Load .env.local first (single source of truth, matches server-v2), then .env.
const ROOT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env.local"), override: true });
require("dotenv").config({ path: path.join(ROOT, ".env") });
const XLSX = require("xlsx");
const { Pool } = require("pg");

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const dirIdx = args.indexOf("--dir");
const fileIdx = args.indexOf("--file");
const MVC_DIR = dirIdx !== -1 ? args[dirIdx + 1] : path.join(__dirname, "..", "server-v2", "MVC");
const SINGLE_FILE = fileIdx !== -1 ? args[fileIdx + 1] : null;

// Map of xlsx human-readable header → mvc_snapshots column.
// Covers the standard daily layout; extra new-file columns map when present.
const HEADER_MAP = {
  "Day": "day",
  "Date": "date",
  "Time": "time",
  "Strike OI+Vol": "strikeOIVol",
  "MVC Value OI+Vol ($B)": "mvcValueOIVol",
  "% Net GEX OI+Vol": "pctOI_Vol",
  "Volume OI+Vol": "volumeOIVol",
  "Strike Vol Only": "strikeVolOnly",
  "MVC Value Vol Only ($B)": "mvcValueVolOnly",
  "% Net GEX Vol Only": "pctVol_Only",
  "Volume Vol Only": "volumeVolOnly",
  "SPX Price": "spxPrice",
  "ES Price": "esPrice",
  "Net DEX Strike": "netDEXStrike",
  "Total Net DEX ($B)": "totalNetDEX_OI",
  "Total Net GEX ($B)": "totalNetGEX_OI",
  "Total Abs Net GEX ($B)": "totalAbsNetGEX",
  "GEX Flip": "gexFlip",
  "Gex Flip": "gexFlip",
  "Trigger": "triggerType",
  "Expiration": "expiration",
  // Newer-file extras (single-strike detail) — kept if present, else ignored.
  "Strike": "_strike",
  "Net GEX": "_netGex",
  "Net DEX": "_netDex",
};

const TEXT_DB_COLS = new Set(["date", "day", "time", "triggerType", "expiration"]);
const REQUIRED_NUM = new Set([
  "mvcValueOIVol", "volumeOIVol", "totalNetGEX_OI", "mvcValueVolOnly",
  "volumeVolOnly", "totalNetGEX_Vol", "spxPrice", "esPrice", "totalAbsNetGEX",
]);

function toNum(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").replace(/\$/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Build an ET-based epoch ms from "YYYY-MM-DD" + "HH:MM:SS" (no TZ shift). */
function synthTimestamp(date, time) {
  if (!date) return null;
  const t = (time && /^\d{1,2}:\d{2}/.test(time)) ? time : "00:00:00";
  const ms = Date.parse(`${date}T${t}`);
  return Number.isFinite(ms) ? ms : Date.parse(`${date}T00:00:00`) || null;
}

function coerceRow(raw) {
  const m = {}; // db column → value
  for (const [header, dbCol] of Object.entries(HEADER_MAP)) {
    if (!(header in raw)) continue;
    const v = raw[header];
    if (TEXT_DB_COLS.has(dbCol)) {
      m[dbCol] = v == null ? null : String(v).trim() || null;
    } else {
      m[dbCol] = toNum(v); // numeric + the _strike/_netGex/_netDex extras
    }
  }

  // Synthesize / fall back to satisfy schema + scoring needs.
  m.timestamp = synthTimestamp(m.date, m.time);
  if (m.esPrice == null) m.esPrice = m.spxPrice;                 // no ES col → use SPX
  if (m.totalNetGEX_Vol == null) m.totalNetGEX_Vol = m.totalNetGEX_OI; // single GEX total
  if (m.totalNetDEX_Vol == null) m.totalNetDEX_Vol = m.totalNetDEX_OI; // single DEX total
  if (m.totalAbsNetGEX == null && m.totalNetGEX_OI != null) m.totalAbsNetGEX = Math.abs(m.totalNetGEX_OI);
  if (!m.triggerType) m.triggerType = "manual";
  if (m.expiration == null) m.expiration = "";

  // NOT-NULL numeric guards.
  for (const c of REQUIRED_NUM) if (m[c] == null) m[c] = 0;

  return m;
}

function listFiles() {
  if (SINGLE_FILE) return [path.resolve(SINGLE_FILE)];
  if (!fs.existsSync(MVC_DIR)) {
    console.error(`MVC dir not found: ${MVC_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(MVC_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .sort()
    .map((f) => path.join(MVC_DIR, f));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to .env or the environment.");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  });

  const files = listFiles();
  console.log(`Mode: ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}`);
  console.log(`Found ${files.length} xlsx file(s) in ${SINGLE_FILE ? "single-file mode" : MVC_DIR}\n`);

  let grandTotal = 0, grandInserted = 0, grandSkipped = 0;
  const unknownCols = new Set();

  for (const file of files) {
    const wb = XLSX.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (!rows.length) {
      console.log(`  ${path.basename(file)}: empty, skipped`);
      continue;
    }

    // Report unknown headers once.
    for (const k of Object.keys(rows[0])) {
      if (k !== "id" && !(k in HEADER_MAP)) unknownCols.add(k);
    }

    let inserted = 0, skipped = 0;
    for (const raw of rows) {
      const r = coerceRow(raw);
      if (!r.date || !r.timestamp) { skipped++; continue; }
      grandTotal++;

      if (!COMMIT) { inserted++; continue; }

      // Dedupe on (date, timestamp).
      const exists = await pool.query(
        `SELECT 1 FROM mvc_snapshots WHERE date = $1 AND timestamp = $2 LIMIT 1`,
        [r.date, r.timestamp]
      );
      if (exists.rowCount) { skipped++; continue; }

      await pool.query(
        `INSERT INTO mvc_snapshots (timestamp,date,day,time,"strikeOIVol","mvcValueOIVol","pctOI_Vol","volumeOIVol",
          "totalNetGEX_OI","strikeVolOnly","mvcValueVolOnly","pctVol_Only","volumeVolOnly","totalNetGEX_Vol",
          "spxPrice","esPrice","netDEXStrike","totalNetDEX_OI","totalNetDEX_Vol","totalAbsNetGEX","gexFlip","triggerType",expiration)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [r.timestamp, r.date, r.day, r.time, r.strikeOIVol, r.mvcValueOIVol, r.pctOI_Vol,
         r.volumeOIVol, r.totalNetGEX_OI, r.strikeVolOnly, r.mvcValueVolOnly, r.pctVol_Only,
         r.volumeVolOnly, r.totalNetGEX_Vol, r.spxPrice, r.esPrice, r.netDEXStrike,
         r.totalNetDEX_OI, r.totalNetDEX_Vol, r.totalAbsNetGEX, r.gexFlip,
         r.triggerType || "manual", r.expiration || ""]
      );
      inserted++;
    }

    grandInserted += COMMIT ? inserted : 0;
    grandSkipped += skipped;
    console.log(`  ${path.basename(file)}: ${rows.length} rows → ${COMMIT ? `${inserted} inserted, ${skipped} skipped` : `${inserted} would insert`}`);
  }

  if (unknownCols.size) {
    console.log(`\n⚠ Unmapped columns (ignored): ${[...unknownCols].join(", ")}`);
  }
  console.log(`\nTotal rows scanned: ${grandTotal}`);
  if (COMMIT) console.log(`Inserted: ${grandInserted} · Skipped (dupes/blank): ${grandSkipped}`);
  else console.log(`Dry run — pass --commit to write. (re-run safe; dupes skipped on commit)`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
