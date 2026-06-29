import { readFile } from "fs/promises";
import path from "path";

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

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        background:
          "radial-gradient(circle at top, rgba(33,158,188,0.08), transparent 40%), #05080d",
        padding: "24px 20px",
        color: "#e8edf5",
        fontFamily:
          "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div
          style={{
            fontSize: 14,
            color: "#FFFFFF",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 800,
            marginBottom: 8,
          }}
        >
          Product Updates
        </div>
        <h1 style={{ fontSize: 36, lineHeight: 1.1, margin: "0 0 10px", fontWeight: 800 }}>
          What&apos;s New
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#FFFFFF" }}>
          The latest improvements to your dashboard, in plain English.
        </p>

        {entries.length === 0 && (
          <div style={{ fontSize: 13, color: "#FFFFFF" }}>No updates yet.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {entries.map((entry, i) => (
            <div
              key={i}
              style={{
                border: "1px solid rgba(33,158,188,0.16)",
                borderTop: "2px solid rgba(33,158,188,0.45)",
                borderRadius: 16,
                background:
                  "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.08) 0%, transparent 55%), rgba(13,17,25,0.72)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                padding: "16px 20px",
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  color: "#219EBC",
                  marginBottom: 12,
                }}
              >
                {entry.date}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                {entry.items.map((item, j) => (
                  <li key={j} style={{ fontSize: 14, lineHeight: 1.6, color: "#e8edf5" }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
