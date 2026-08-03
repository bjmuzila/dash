#!/usr/bin/env node
// Atomic, concurrency-safe changelog writer.
//
// WHY THIS EXISTS: /close used to hand the whole file to the model, which read
// it, rebuilt it in memory and wrote it back. Two sessions closing at the same
// time both read the same "before" and both wrote a full file — last write wins
// and the other session's day vanished. That is how Sunday 8/2/2026 disappeared
// from CUSTOMER_CHANGELOG.md while every other day survived. This script never
// rewrites the file from memory: it takes a lock, re-reads from disk, splices in
// only the new bullets, and renames a temp file into place.
//
// Usage:
//   node scripts/changelog-add.mjs --customer "bullet one" "bullet two"
//   node scripts/changelog-add.mjs --dev --date "Sunday 8/2/2026" "bullet"
//   echo "bullet" | node scripts/changelog-add.mjs --customer -
//
// Flags:
//   --customer          write to CUSTOMER_CHANGELOG.md (default)
//   --dev               write to CHANGELOG.md
//   --date "<heading>"  heading text; defaults to today in America/New_York
//   --dry-run           print the result instead of writing
//
// Exit codes: 0 written (or nothing to do), 1 error, 2 lock timeout.

import { readFile, writeFile, rename, mkdir, rmdir } from "fs/promises";
import path from "path";
import process from "process";

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = { file: "customer", date: null, dryRun: false, bullets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--customer") out.file = "customer";
    else if (a === "--dev") out.file = "dev";
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--date") out.date = argv[++i];
    else if (a === "-") out.bullets.push("-STDIN-");
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else out.bullets.push(a);
  }
  return out;
}

// "## Weekday M/D/YYYY" in America/New_York — the format the file already uses.
function todayHeading() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.month}/${parts.day}/${parts.year}`;
}

// mkdir is atomic on every platform we run on (Windows dev box, Linux VPS), so
// it is the lock primitive. Stale locks older than 60s are broken automatically
// so a killed session can't wedge every future /close.
async function withLock(lockPath, fn, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const { stat } = await import("fs/promises");
      const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs).catch(() => 0);
      if (age > 60000) {
        await rmdir(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        const e = new Error(`Timed out waiting for ${lockPath}`);
        e.code = "ELOCKTIMEOUT";
        throw e;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}

// Insert bullets under `heading`, creating the section directly below the intro
// if it doesn't exist yet. Reverse-chronological order is preserved because a
// new day always goes at the TOP, never appended to the end.
function splice(raw, heading, bullets) {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  const isHeading = (l) => /^##\s+/.test(l.trim());
  const headingText = (l) => l.trim().replace(/^##\s+/, "").trim();
  const bulletText = (l) => {
    const m = l.trim().match(/^[-*]\s+(.*)$/);
    return m ? m[1].trim() : null;
  };

  let idx = lines.findIndex((l) => isHeading(l) && headingText(l) === heading.trim());
  let added = 0;

  if (idx === -1) {
    // New day. Sit it above the first existing "## " heading, or after the
    // intro paragraph if the file has no sections yet.
    let insertAt = lines.findIndex(isHeading);
    if (insertAt === -1) {
      insertAt = lines.length;
      while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
      lines.splice(insertAt, 0, "");
    }
    const block = [`## ${heading.trim()}`, "", ...bullets.map((b) => `* ${b}`), ""];
    lines.splice(insertAt, 0, ...block);
    added = bullets.length;
    return { text: lines.join(eol), added };
  }

  // Existing day: walk to the end of its bullet block, skipping duplicates.
  let end = idx + 1;
  const existing = new Set();
  while (end < lines.length && !isHeading(lines[end])) {
    const b = bulletText(lines[end]);
    if (b) existing.add(b);
    end++;
  }
  while (end > idx + 1 && lines[end - 1].trim() === "") end--;

  const fresh = bullets.filter((b) => !existing.has(b.trim()));
  if (fresh.length === 0) return { text: raw, added: 0 };

  lines.splice(end, 0, ...fresh.map((b) => `* ${b}`));
  added = fresh.length;
  return { text: lines.join(eol), added };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.bullets.includes("-STDIN-")) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const piped = Buffer.concat(chunks)
      .toString("utf8")
      .split("\n")
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
    args.bullets = args.bullets.filter((b) => b !== "-STDIN-").concat(piped);
  }

  if (args.bullets.length === 0) {
    console.error("Nothing to add. Pass bullets as arguments or pipe them with `-`.");
    process.exit(1);
  }

  const target = args.file === "dev" ? "CHANGELOG.md" : "CUSTOMER_CHANGELOG.md";
  const filePath = path.join(ROOT, target);
  const heading = args.date || todayHeading();

  try {
    await withLock(`${filePath}.lock`, async () => {
      // Re-read INSIDE the lock. This is the whole point — whatever another
      // session committed while this one was thinking is already on disk.
      const raw = await readFile(filePath, "utf8");
      const { text, added } = splice(raw, heading, args.bullets);

      if (added === 0) {
        console.log(`${target}: nothing new to add under "${heading}".`);
        return;
      }
      if (args.dryRun) {
        console.log(text);
        return;
      }
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, text, "utf8");
      await rename(tmp, filePath);
      console.log(`${target}: added ${added} bullet${added === 1 ? "" : "s"} under "${heading}".`);
    });
  } catch (err) {
    if (err.code === "ELOCKTIMEOUT") {
      console.error(`Another session is writing ${target}. Try again in a moment.`);
      process.exit(2);
    }
    console.error(`Failed to update ${target}:`, err.message);
    process.exit(1);
  }
}

main();
