#!/usr/bin/env node
/**
 * seed-reta-history.mjs — one-time backfill of the Reta tracker from a CSV.
 *
 *   node scripts/seed-reta-history.mjs reta-history.csv          # write
 *   node scripts/seed-reta-history.mjs reta-history.csv --dry    # print only
 *
 * Needs DATABASE_URL (the same one the app uses) unless --dry. Run it from
 * the repo root and it reads .env.local / .env automatically.
 *
 * CSV columns (header row required, order-independent):
 *   date, vial_mg, bac_ml, brandon_units, brandon_weight_lb,
 *   heather_units, heather_weight_lb, note
 *
 * WHY UNITS BECOME mg
 *   The tracker stores dose_mg and derives units at render from the recon in
 *   force, so a corrected mix fixes a whole week at once. A log kept in units
 *   therefore has to be converted on the way in:
 *       concentration = vial_mg / bac_ml            (mg per mL)
 *       mg            = units / 100 * concentration (U-100: 100 u = 1 mL)
 *   Blank vial_mg/bac_ml cells inherit the last row that had them, which is why
 *   you only have to record the mix on the weeks it actually changed.
 *
 * IDEMPOTENT: every write is an upsert keyed on (effective_from) or
 * (shot_date, person), so re-running after fixing a cell is safe.
 */

import { readFileSync } from "node:fs";
import { Pool } from "pg";

// Pick up DATABASE_URL from .env.local / .env the way the app does, so this can
// be run straight from the repo root with no env juggling. dotenv never
// overwrites a variable that is already exported, and its absence is not fatal.
try {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config({ path: ".env" });
} catch {
  /* dotenv not installed — fall back to the ambient environment */
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const file = args.find((a) => !a.startsWith("--")) || "reta-history.csv";

const PEOPLE = ["brandon", "heather"];
const U_PER_ML = 100; // U-100 syringe

// Minimal CSV reader: handles quoted fields (for notes with commas) and CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * BAC water written as syringe units instead of mL is the common slip (a "3 mL"
 * fill reads as 300 on the barrel). Nothing is reconstituted with >50 mL, so a
 * value that large is units — convert it and say so rather than silently
 * producing doses that are 100x wrong.
 */
const bacWarned = new Set(); // one line per distinct value, not per row
function normalizeBac(raw, dateLabel, warnings) {
  if (raw == null) return null;
  if (raw > 50) {
    const ml = raw / U_PER_ML;
    if (!bacWarned.has(raw)) {
      bacWarned.add(raw);
      warnings.push(`bac_ml ${raw} read as ${raw} syringe units = ${ml} mL (from ${dateLabel})`);
    }
    return ml;
  }
  return raw;
}

const csv = parseCsv(readFileSync(file, "utf8"));
const warnings = [];
const setups = [];   // { effective_from, vial_mg, bac_ml }
const shots = [];    // { shot_date, person, dose_mg, weight_lb, units }
const notes = [];    // { shot_date, note }

let vialMg = null, bacMl = null;
for (const r of csv) {
  const date = r.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

  const rowVial = numOrNull(r.vial_mg);
  const rowBac = normalizeBac(numOrNull(r.bac_ml), date, warnings);
  // A recon row starts a new setup only when the mix actually changed.
  if (rowVial != null && rowBac != null && (rowVial !== vialMg || rowBac !== bacMl)) {
    vialMg = rowVial;
    bacMl = rowBac;
    setups.push({ effective_from: date, vial_mg: vialMg, bac_ml: bacMl });
  }
  const conc = vialMg != null && bacMl ? vialMg / bacMl : null;

  for (const person of PEOPLE) {
    const units = numOrNull(r[`${person}_units`]);
    const weight = numOrNull(r[`${person}_weight_lb`]);
    if (units == null && weight == null) continue; // skipped week
    if (units != null && conc == null) {
      warnings.push(`${date} ${person}: ${units} units but no recon yet — skipped`);
      continue;
    }
    const doseMg = units == null ? 0 : Math.round((units / U_PER_ML) * conc * 1000) / 1000;
    shots.push({ shot_date: date, person, dose_mg: doseMg, weight_lb: weight, taken: units != null ? 1 : 0, units });
  }
  if (r.note) notes.push({ shot_date: date, note: r.note });
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${file}: ${csv.length} rows → ${setups.length} recon(s), ${shots.length} shot(s), ${notes.length} note(s)\n`);
for (const s of setups) {
  console.log(`  recon from ${s.effective_from}: ${s.vial_mg} mg / ${s.bac_ml} mL = ${(s.vial_mg / s.bac_ml).toFixed(2)} mg/mL`);
}
console.log("");
console.log("  date        person   units    mg    weight");
for (const s of shots) {
  console.log(
    `  ${s.shot_date}  ${s.person.padEnd(8)} ${String(s.units ?? "-").padStart(5)} ${s.dose_mg.toFixed(2).padStart(6)} ${
      s.weight_lb == null ? "     -" : String(s.weight_lb).padStart(6)
    }`
  );
}
if (warnings.length) {
  console.log("\n  NOTES");
  for (const w of warnings) console.log(`   • ${w}`);
}

if (DRY) {
  console.log("\n--dry: nothing written.\n");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("\nDATABASE_URL is not set — run with --dry to preview, or export it and re-run.\n");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
});

// The app creates these on first API hit; create them here too so the seed can
// run before anyone has opened the page.
await pool.query(`
  CREATE TABLE IF NOT EXISTS reta_setups (
    id SERIAL PRIMARY KEY,
    effective_from TEXT NOT NULL UNIQUE,
    vial_mg REAL NOT NULL DEFAULT 10,
    bac_ml REAL NOT NULL DEFAULT 2,
    syringe_units INTEGER NOT NULL DEFAULT 100,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reta_shots (
    id SERIAL PRIMARY KEY,
    shot_date TEXT NOT NULL,
    person TEXT NOT NULL,
    dose_mg REAL NOT NULL DEFAULT 0,
    weight_lb REAL,
    taken INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (shot_date, person)
  );
  CREATE INDEX IF NOT EXISTS idx_reta_shots_date ON reta_shots(shot_date);
  CREATE TABLE IF NOT EXISTS reta_week_notes (
    shot_date TEXT PRIMARY KEY,
    note TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
`);

for (const s of setups) {
  await pool.query(
    `INSERT INTO reta_setups (effective_from, vial_mg, bac_ml, syringe_units)
     VALUES ($1,$2::real,$3::real,100)
     ON CONFLICT (effective_from) DO UPDATE SET
       vial_mg = EXCLUDED.vial_mg, bac_ml = EXCLUDED.bac_ml, updated_at = CURRENT_TIMESTAMP`,
    [s.effective_from, s.vial_mg, s.bac_ml]
  );
}
for (const s of shots) {
  await pool.query(
    `INSERT INTO reta_shots (shot_date, person, dose_mg, weight_lb, taken)
     VALUES ($1,$2,$3::real,$4::real,$5::int)
     ON CONFLICT (shot_date, person) DO UPDATE SET
       dose_mg = EXCLUDED.dose_mg, weight_lb = EXCLUDED.weight_lb,
       taken = EXCLUDED.taken, updated_at = CURRENT_TIMESTAMP`,
    [s.shot_date, s.person, s.dose_mg, s.weight_lb, s.taken]
  );
}
for (const n of notes) {
  await pool.query(
    `INSERT INTO reta_week_notes (shot_date, note) VALUES ($1,$2)
     ON CONFLICT (shot_date) DO UPDATE SET note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`,
    [n.shot_date, n.note]
  );
}

const { rows: counted } = await pool.query(
  `SELECT (SELECT count(*) FROM reta_setups) AS setups,
          (SELECT count(*) FROM reta_shots) AS shots,
          (SELECT count(*) FROM reta_week_notes) AS notes`
);
console.log(`\nwritten. table totals → setups ${counted[0].setups}, shots ${counted[0].shots}, notes ${counted[0].notes}\n`);
await pool.end();
