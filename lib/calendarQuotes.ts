// Server-side only. Reads the "quote of the day" list from a Google Sheet.
//
// Expected sheet shape: two columns, one holding a date and one holding the
// quote text. Column order is auto-detected, and a header row is ignored.
//
//   A            B
//   2026-07-31   "Markets are never wrong, opinions often are." — Jesse Livermore
//   2026-08-01   ...
//
// Configure with:
//   CALENDAR_QUOTE_SHEET_ID       spreadsheet id (from the sheet URL)
//   CALENDAR_QUOTE_SHEET_RANGE    optional, defaults to "Sheet1!A:B"
//
// Reuses the same service account as the waitlist export
// (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY). The sheet must be
// shared with that service account email (Viewer is enough).
//
// Safe no-op when unconfigured or unreachable: callers fall back to the
// built-in quote list.

import { google } from "googleapis";

const SHEET_ID = process.env.CALENDAR_QUOTE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// Private keys in .env keep literal "\n"; convert back to real newlines.
const SA_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const RANGE = process.env.CALENDAR_QUOTE_SHEET_RANGE || "Sheet1!A:B";

const CACHE_TTL_MS = 5 * 60_000;

export type QuoteRow = {
  /** YYYY-MM-DD, or null when the row has no parseable date. */
  date: string | null;
  quote: string;
};

let _sheets: ReturnType<typeof google.sheets> | null = null;
let _cache: { at: number; rows: QuoteRow[] } | null = null;

export function isQuoteSheetConfigured(): boolean {
  return Boolean(SHEET_ID && SA_EMAIL && SA_KEY);
}

function getSheets() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

const pad = (n: string | number) => String(n).padStart(2, "0");

const HEADER_WORDS = /^(date|day|when|quote|quotes|text|saying|message|author|by|note)\b/i;

/** True when a row looks like a column-header row rather than data. */
function isHeaderRow(dateCell: string, quoteCell: string): boolean {
  const d = dateCell.trim();
  const q = quoteCell.trim();
  const short = (s: string) => s.length > 0 && s.length <= 30;
  return (short(d) && HEADER_WORDS.test(d)) || (short(q) && HEADER_WORDS.test(q));
}

/**
 * The panel renders the text already wrapped in curly quotes, so strip any
 * quote marks the sheet carries to avoid `“"…" — Author”`.
 *
 *   "Saying." — Author   →   Saying. — Author
 *   “Saying.” — Author   →   Saying. — Author
 *   "Saying."            →   Saying.
 */
export function normalizeQuote(raw: string): string {
  let s = raw.trim();

  // Quoted saying followed by an attribution dash.
  const m = /^["“]([\s\S]+?)["”]\s*([—–-]\s*[\s\S]+)$/.exec(s);
  if (m) return `${m[1].trim()} ${m[2].trim()}`;

  // Whole cell wrapped in quotes.
  if (/^["“][\s\S]*["”]$/.test(s)) s = s.slice(1, -1).trim();

  return s;
}

/** Tolerant date parse → "YYYY-MM-DD", or null when the cell isn't a date. */
export function toDateKey(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // 2026-07-31
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // 7/31/2026 or 7-31-26 (US month-first, which is what Sheets renders for
  // a US-locale spreadsheet)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${pad(m[1])}-${pad(m[2])}`;
  }

  // Google Sheets serial number (days since 1899-12-30), if the range is ever
  // read unformatted.
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20_000 && serial < 80_000) {
      const ms = Math.round((serial - 25_569) * 86_400_000);
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  // "Jul 31, 2026" / "31 July 2026" / "July 31 2026"
  const parsed = Date.parse(`${s} 00:00:00 GMT`);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);

  return null;
}

/**
 * Fetch and normalise the quote rows. Returns [] when unconfigured or on any
 * API error — never throws, so the route can fall back cleanly.
 */
export async function getQuoteRows(opts?: { force?: boolean }): Promise<QuoteRow[]> {
  if (!isQuoteSheetConfigured()) return [];

  if (!opts?.force && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.rows;
  }

  let values: string[][] = [];
  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: SHEET_ID!,
      range: RANGE,
    });
    values = (res.data.values ?? []) as string[][];
  } catch (err) {
    console.warn("[calendar-quote] sheet read failed:", (err as Error)?.message);
    // Serve a stale cache rather than nothing if we have one.
    return _cache?.rows ?? [];
  }

  // Work out which column holds the dates by sampling the first 20 rows.
  let hitsA = 0;
  let hitsB = 0;
  for (const row of values.slice(0, 20)) {
    if (toDateKey(row?.[0])) hitsA++;
    if (toDateKey(row?.[1])) hitsB++;
  }
  const dateCol = hitsB > hitsA ? 1 : 0;
  const quoteCol = dateCol === 0 ? 1 : 0;

  const rows: QuoteRow[] = [];
  values.forEach((row, i) => {
    const date = toDateKey(row?.[dateCol]);
    let quote = String(row?.[quoteCol] ?? "").trim();
    if (!quote) return;
    // Drop a header row: first row, no date, and short label-ish cells.
    if (i === 0 && !date && isHeaderRow(String(row?.[dateCol] ?? ""), quote)) return;
    quote = normalizeQuote(quote);
    if (!quote) return;
    rows.push({ date, quote });
  });

  _cache = { at: Date.now(), rows };
  return rows;
}

/** Clear the in-memory cache (used by the ?refresh=1 debug path). */
export function clearQuoteCache() {
  _cache = null;
}
