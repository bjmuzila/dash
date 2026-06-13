import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET() {
  try {
    const filePath = path.resolve(process.cwd(), "..", "data", "trump_calendar_latest.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Calendar file not found", events: [] }, { status: 404 });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, events: [] }, { status: 500 });
  }
}
