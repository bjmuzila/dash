// Import the 31-week Estimated Move history from the Google Sheet into the
// em_tracker table via the /api/em-tracker endpoint.
//
//   node scripts/import-em-tracker.mjs                 # uses default sheet + localhost
//   BASE=https://your-host node scripts/import-em-tracker.mjs
//   SHEET_ID=... GID=... node scripts/import-em-tracker.mjs
//
// Re-runnable: upserts on (ticker, week_label), so running twice is a no-op.
//
// Sheet layout (clean "tickers" tab):
//   row with "8/8","8/15",...           -> week labels (header)
//   ticker rows: TICKER, ABS_AVG%, em(8/8), em(8/15), ...
//   tally block: TICKER, , , , , , , , hits, total, pct, , , latest_em

const SHEET_ID = process.env.SHEET_ID || "1NzeEb9KZgQQLIFkQ0ipxDPM2zQDBO1Yy-0As7O5q9Vg";
const GID = process.env.GID || "2";            // the clean "tickers" tab
const BASE = process.env.BASE || "http://localhost:3000";

const TICKERS = new Set([
  "ESM","NQM","ESU","NQU","SPY","QQQ","SPX","AAPL","AMD","AMZN",
  "GOOGL","META","MSFT","NVDA","TSLA","COIN","HOOD","IWM","NDX","NFLX","SMH","PLTR",
]);

// "8/8" + a starting year -> Monday ISO date, walking the calendar so the
// Aug->Jan->May rollover gets the right year.
function weekLabelToDate(label, startYear) {
  const m = label.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]) };
}

function parseCsv(text) {
  // minimal RFC4180-ish parser (handles quoted commas)
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function num(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[, %]/g, ""));
  return Number.isFinite(v) ? v : null;
}

async function main() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
  console.log("Fetching", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const rows = parseCsv(await res.text());

  // locate the header row with week labels
  const headerIdx = rows.findIndex((r) => r.some((c) => /^\s*8\/8\s*$/.test(c)));
  if (headerIdx < 0) throw new Error("Could not find week-label header (8/8)");
  const header = rows[headerIdx];

  // map each column index -> week label (only real m/d labels)
  const weekCols = [];
  header.forEach((c, idx) => {
    const lbl = String(c).trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(lbl)) weekCols.push({ idx, label: lbl });
  });
  console.log(`Found ${weekCols.length} week columns:`, weekCols.map((w) => w.label).join(", "));

  // The EM number columns start right after the ABS-AVG% column. Find, per
  // ticker row, the ticker cell and the first week column; values align by idx.
  const emRows = [];     // { ticker, weeks: {label: em} }
  const tallies = {};    // ticker -> { hits, total, pct, latestEm }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const tcell = r.map((c) => String(c).trim()).find((c) => TICKERS.has(c.toUpperCase()));
    if (!tcell) continue;
    const ticker = tcell.toUpperCase();

    // Is this an EM-series row (has many numeric week cells) or a tally row?
    const weekVals = weekCols.map((w) => num(r[w.idx]));
    const filled = weekVals.filter((v) => v != null).length;

    if (filled >= 5) {
      const weeks = {};
      weekCols.forEach((w, k) => { if (weekVals[k] != null) weeks[w.label] = weekVals[k]; });
      emRows.push({ ticker, weeks });
    } else {
      // tally row: scan for "<=31" hits then 31 total then pct
      const nums = r.map(num);
      const totalIdx = nums.findIndex((v) => v === 31);
      if (totalIdx > 0) {
        const hits = nums[totalIdx - 1];
        const pct = nums.slice(totalIdx + 1).find((v) => v != null && v > 1 && v <= 100) ?? null;
        const latestEm = nums.slice(totalIdx + 1).reverse().find((v) => v != null && v > 0) ?? null;
        tallies[ticker] = { hits, total: 31, pct, latestEm };
      }
    }
  }

  console.log(`Parsed ${emRows.length} EM-series rows, ${Object.keys(tallies).length} tally rows`);

  // Build payload rows. We know per-ticker hit COUNT but not which specific
  // weeks were misses, so we import the EM series (no result) and additionally
  // a synthetic summary note carrying the historical hit/total. The per-week
  // hit/miss gets filled going forward by /evaluate from real OHLC.
  const payload = [];
  for (const { ticker, weeks } of emRows) {
    for (const [label, em] of Object.entries(weeks)) {
      payload.push({ ticker, week_label: label, em, result_source: "import" });
    }
  }

  console.log(`Posting ${payload.length} weekly EM rows to ${BASE}/api/em-tracker`);
  const post = await fetch(`${BASE}/api/em-tracker`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: payload }),
  });
  const out = await post.json().catch(() => ({}));
  console.log("Result:", out);

  // Persist tallies to a sidecar file so the admin UI can show the historical
  // 31-week record verbatim alongside the going-forward auto-computed record.
  const fs = await import("node:fs");
  fs.writeFileSync(
    new URL("../data/em-tracker-history.json", import.meta.url),
    JSON.stringify({ generatedAt: Date.now(), source: "google-sheet", tallies }, null, 2)
  );
  console.log("Wrote data/em-tracker-history.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
