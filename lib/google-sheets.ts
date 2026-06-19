// Server-side only. Appends waitlist signups to a Google Sheet via a service
// account. Safe no-op (logs a warning) when the env vars are not configured, so
// the app runs fine without Google Sheets.

import { google } from "googleapis";

const SHEET_ID = process.env.WAITLIST_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// Private keys in .env keep literal "\n"; convert back to real newlines.
const SA_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
// Tab name + range to append to. Defaults to first sheet's columns A:E.
const RANGE = process.env.WAITLIST_SHEET_RANGE || "Sheet1!A:E";

let _sheets: ReturnType<typeof google.sheets> | null = null;
let _headerEnsured = false;

function isConfigured(): boolean {
  return Boolean(SHEET_ID && SA_EMAIL && SA_KEY);
}

function getSheets() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/** Ensure a header row exists (only writes it if the sheet is empty). */
async function ensureHeader(sheets: ReturnType<typeof google.sheets>) {
  if (_headerEnsured) return;
  _headerEnsured = true;
  try {
    const tab = RANGE.split("!")[0];
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID!,
      range: `${tab}!A1:E1`,
    });
    const hasHeader = (res.data.values?.[0]?.length ?? 0) > 0;
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID!,
        range: `${tab}!A1:E1`,
        valueInputOption: "RAW",
        requestBody: { values: [["Email", "Source", "Referrer", "User Agent", "Signed Up"]] },
      });
    }
  } catch {
    // Header is best-effort; ignore failures.
  }
}

export async function appendWaitlistRowToSheet(row: {
  email: string;
  source?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
}): Promise<void> {
  if (!isConfigured()) {
    console.warn("[sheets] Google Sheets export not configured — skipping.");
    return;
  }
  const sheets = getSheets();
  await ensureHeader(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID!,
    range: RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          row.email,
          row.source ?? "landing",
          row.referrer ?? "",
          row.user_agent ?? "",
          new Date().toISOString(),
        ],
      ],
    },
  });
}
