import { readFile } from "fs/promises";
import path from "path";
import WhatsNewClient from "./WhatsNewClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Entry = { date: string; items: string[] };

async function loadCustomerChangelog(): Promise<Entry[]> {
  let raw = "";
  try {
    const filePath = path.join(process.cwd(), "CUSTOMER_CHANGELOG.md");
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    console.error("[whats-new] failed to read CUSTOMER_CHANGELOG.md at", path.join(process.cwd(), "CUSTOMER_CHANGELOG.md"), err);
    return [];
  }

  const entries: Entry[] = [];
  let current: Entry | null = null;

  // Strip UTF-8 BOM and normalize CRLF so heading/item regexes match.
  raw = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    const dateMatch = line.match(/^##\s+(.*)$/);
    if (dateMatch) {
      current = { date: dateMatch[1].trim(), items: [] };
      entries.push(current);
      continue;
    }
    const itemMatch = line.match(/^[-*]\s+(.*)$/);
    if (itemMatch && current) {
      current.items.push(itemMatch[1].trim());
    }
  }

  return entries;
}

export default async function WhatsNewPage() {
  const entries = await loadCustomerChangelog();
  return <WhatsNewClient entries={entries} />;
}
