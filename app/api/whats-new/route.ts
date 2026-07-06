import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { getServerUserId } from "@/lib/supabase/server";

// Owner-only edit endpoint for the What's New page. Lets the owner strike a
// single bullet from CUSTOMER_CHANGELOG.md straight from the page, instead of
// editing the file by hand. Fail-closed: unset OWNER_USER_ID denies, not opens.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const CHANGELOG_PATH = path.join(process.cwd(), "CUSTOMER_CHANGELOG.md");

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

export async function DELETE(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

  try {
    const { date, item } = (await req.json()) as { date?: string; item?: string };
    if (!date || !item) return NextResponse.json({ error: "date and item are required" }, { status: 400 });

    const raw = (await readFile(CHANGELOG_PATH, "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");

    let inSection = false;
    let removed = false;
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const headingMatch = trimmed.match(/^##\s+(.*)$/);
      if (headingMatch) {
        inSection = headingMatch[1].trim() === date;
        out.push(line);
        continue;
      }
      const itemMatch = trimmed.match(/^[-*]\s+(.*)$/);
      if (inSection && !removed && itemMatch && itemMatch[1].trim() === item.trim()) {
        removed = true; // drop this one line, keep everything else
        continue;
      }
      out.push(line);
    }

    if (!removed) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    await writeFile(CHANGELOG_PATH, out.join("\n"), "utf8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Delete failed", detail: String(err) }, { status: 500 });
  }
}
