import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves the OCR preview produced by scripts/import-em-from-discord.mjs so the
// EM Tracker importer can show each parsed week (with raw OCR) for review before
// committing. Read-only.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "em-discord-preview.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ weeks: [], note: "No preview yet — run scripts/import-em-from-discord.mjs" });
  }
}
