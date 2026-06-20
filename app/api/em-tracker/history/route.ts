import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves the verified historical 31-week "closed inside EM" tally captured from
// the source Google Sheet. Read-only reference data; the going-forward record
// lives in the em_tracker table (see /api/em-tracker).

export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "em-tracker-history.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    return NextResponse.json(json);
  } catch (err) {
    console.error("[/api/em-tracker/history GET]", err);
    return NextResponse.json({ tallies: {}, total_weeks: 0 }, { status: 200 });
  }
}
