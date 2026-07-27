import { readFile } from "fs/promises";
import path from "path";
import WhatsNewClient from "./WhatsNewClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Entry = { date: string; items: string[] };

// Pull M/D/YYYY out of a "## Weekday M/D/YYYY" heading and turn it into a
// sortable timestamp. Returns null for any heading we can't read a date from
// (those get parked at the bottom of the page rather than silently dropped).
function parseHeadingDate(heading: string): number | null {
  const m = heading.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || !day || !year || month > 12 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

async function loadCustomerChangelog(): Promise<Entry[]> {
  let raw = "";
  try {
    const filePath = path.join(process.cwd(), "CUSTOMER_CHANGELOG.md");
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    console.error("[whats-new] failed to read CUSTOMER_CHANGELOG.md at", path.join(process.cwd(), "CUSTOMER_CHANGELOG.md"), err);
    return [];
  }

  // Strip UTF-8 BOM and normalize CRLF so heading/item regexes match.
  raw = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  // Collect sections in file order first. `key` merges duplicate headings for
  // the same day (the changelog has picked up a few over time, e.g. two
  // separate 7/15/2026 sections) into a single card.
  type Section = { key: string; sortKey: number | null; date: string; items: string[]; seq: number };
  const byKey = new Map<string, Section>();
  let current: Section | null = null;
  let seq = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();

    const dateMatch = line.match(/^##\s+(.*)$/);
    if (dateMatch) {
      const date = dateMatch[1].trim();
      const sortKey = parseHeadingDate(date);
      // Merge on the parsed date when we have one; fall back to the raw
      // heading text so undated sections still group with themselves.
      const key = sortKey !== null ? `d:${sortKey}` : `t:${date.toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        current = existing;
      } else {
        current = { key, sortKey, date, items: [], seq: seq++ };
        byKey.set(key, current);
      }
      continue;
    }

    const itemMatch = line.match(/^[-*]\s+(.*)$/);
    if (itemMatch && current) {
      const item = itemMatch[1].trim();
      // Skip exact duplicates within a day (possible once merged).
      if (!current.items.includes(item)) current.items.push(item);
    }
  }

  const sections = [...byKey.values()];

  // Newest first. Anything we couldn't date keeps its file order and sits
  // below every dated section, so a malformed heading can never push real
  // entries down the page (which is exactly what used to happen when /close
  // appended a new day to the END of the file).
  sections.sort((a, b) => {
    if (a.sortKey !== null && b.sortKey !== null) return b.sortKey - a.sortKey;
    if (a.sortKey !== null) return -1;
    if (b.sortKey !== null) return 1;
    return a.seq - b.seq;
  });

  // Keep `date` as the verbatim heading text — app/api/whats-new/route.ts
  // matches on it to delete a single bullet.
  return sections
    .filter((s) => s.items.length > 0)
    .map((s) => ({ date: s.date, items: s.items }));
}

export default async function WhatsNewPage() {
  const entries = await loadCustomerChangelog();
  return <WhatsNewClient entries={entries} />;
}
