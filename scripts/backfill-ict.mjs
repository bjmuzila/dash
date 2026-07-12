/**
 * backfill-ict.mjs — replay the ICT setup scanner over past sessions.
 *
 * The recorder only ever scans "today", so any day that was scanned while a
 * detector was broken stayed empty — fixing the detector does NOT retroactively
 * write rows. This replays POST /api/ict-setups {action:"scan"} for a range of
 * dates so the newly-detected setups (notably IFVG) get inserted and graded.
 *
 * Safe to re-run: insertIctSetup is idempotent on setup_key, so existing rows are
 * left alone and only genuinely new detections are added.
 *
 * Usage:
 *   node scripts/backfill-ict.mjs --days=30
 *   node scripts/backfill-ict.mjs --from=2026-06-12 --to=2026-07-11
 *   node scripts/backfill-ict.mjs --days=30 --dry     # report only, no writes
 *
 * Env:
 *   ICT_BASE_URL        default http://localhost:3000
 *   INTERNAL_API_TOKEN  required if the server sets it
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const BASE = process.env.ICT_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.INTERNAL_API_TOKEN || "";
const DRY = !!args.dry;

/** "YYYY-MM-DD" in ET for a Date. */
const etDate = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

function dateRange() {
  if (args.from && args.to) {
    const out = [];
    for (let t = new Date(`${args.from}T12:00:00Z`); etDate(t) <= String(args.to); t.setUTCDate(t.getUTCDate() + 1)) {
      out.push(etDate(t));
    }
    return out;
  }
  const days = Number(args.days || 30);
  const out = [];
  for (let i = days; i >= 1; i--) out.push(etDate(new Date(Date.now() - i * 86_400_000)));
  return out;
}

const isWeekend = (d) => {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};

async function scan(date) {
  const res = await fetch(`${BASE}/api/ict-setups`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "x-internal-token": TOKEN } : {}),
    },
    body: JSON.stringify({ action: "scan", date }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function ifvgCount(date) {
  const res = await fetch(`${BASE}/api/ict-setups?date=${date}`, {
    headers: TOKEN ? { "x-internal-token": TOKEN } : {},
  });
  if (!res.ok) return null;
  const j = await res.json();
  return (j.setups || []).filter((s) => s.kind === "ifvg").length;
}

const dates = dateRange().filter((d) => !isWeekend(d));
console.log(`${DRY ? "[DRY] " : ""}backfilling ${dates.length} sessions via ${BASE}\n`);

let totRecorded = 0, totGraded = 0, totIfvgBefore = 0, totIfvgAfter = 0;

for (const date of dates) {
  try {
    const before = await ifvgCount(date);
    if (DRY) {
      console.log(`${date}  ifvg(existing)=${before ?? "?"}  [dry — no scan]`);
      totIfvgBefore += before ?? 0;
      continue;
    }
    const r = await scan(date);
    const after = await ifvgCount(date);
    totRecorded += r.recorded || 0;
    totGraded += r.graded || 0;
    totIfvgBefore += before ?? 0;
    totIfvgAfter += after ?? 0;
    const delta = (after ?? 0) - (before ?? 0);
    console.log(
      `${date}  detected=${String(r.detected ?? 0).padStart(3)}` +
      `  new=${String(r.recorded ?? 0).padStart(3)}` +
      `  graded=${String(r.graded ?? 0).padStart(3)}` +
      `  ifvg ${before ?? "?"}→${after ?? "?"}${delta > 0 ? `  (+${delta})` : ""}` +
      `${r.note ? `  ${r.note}` : ""}`,
    );
  } catch (e) {
    console.log(`${date}  ERROR  ${e.message}`);
  }
}

console.log(
  `\ndone. new rows=${totRecorded}  graded=${totGraded}  ` +
  `ifvg ${totIfvgBefore} → ${totIfvgAfter} (+${totIfvgAfter - totIfvgBefore})`,
);
