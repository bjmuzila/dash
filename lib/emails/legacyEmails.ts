import fs from "fs";
import path from "path";

// Legacy customer lists sourced from the exported unified_customers CSV.
//   Column A  → "Old emails"    (oldEmails)
//   Column F  → "Old emails 2"  (oldEmails2)
// The CSV is read from data/unified_customers.csv at runtime (parsed once,
// cached in module scope). Drop the export there and both audiences update
// on the next server start.

const CSV_PATH = path.join(process.cwd(), "data", "unified_customers.csv");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Minimal RFC-4180-ish line parser: handles double-quoted fields that may
// contain commas. Good enough for this export (emails/names/amounts).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function extractColumn(rows: string[][], idx: number): string[] {
  const seen = new Set<string>();
  for (const cols of rows) {
    const raw = (cols[idx] ?? "").trim().toLowerCase();
    if (raw && EMAIL_RE.test(raw)) seen.add(raw);
  }
  return Array.from(seen);
}

interface LegacyLists { oldEmails: string[]; oldEmails2: string[] }
let cache: LegacyLists | null = null;

export function loadLegacyEmails(): LegacyLists {
  if (cache) return cache;
  let text = "";
  try {
    text = fs.readFileSync(CSV_PATH, "utf8");
  } catch {
    // File not shipped — return empty lists rather than throwing.
    cache = { oldEmails: [], oldEmails2: [] };
    return cache;
  }
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map(parseCsvLine);
  // Skip the header row (contains "Email"/"Name"/… labels, not addresses).
  const body = rows.length && !EMAIL_RE.test((rows[0][0] ?? "").trim()) ? rows.slice(1) : rows;
  cache = {
    oldEmails: extractColumn(body, 0),   // Column A
    oldEmails2: extractColumn(body, 5),  // Column F
  };
  return cache;
}
