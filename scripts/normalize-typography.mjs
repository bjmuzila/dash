#!/usr/bin/env node
/**
 * normalize-typography.mjs — snap every inline font size across the app to the
 * site type scale so text is uniform everywhere.
 *
 *   SCALE (px):  micro 10 · label 12 · body 14 · subhead 15 · title 17 · display 20+
 *
 * It rewrites numeric `fontSize:` (JS/TS style objects) and `font-size:` (CSS +
 * CSS-in-template-strings) to the nearest tier. It DOES NOT touch:
 *   - display sizes >= 20 (heroes, countdowns, big stat numbers)
 *   - non-numeric values (clamp(), calc(), var(), %, vw, em, expressions, ${…})
 *   - embedded design documents (post studio / social-card / x-post HTML), which
 *     have their own typography — see DENY below.
 *
 * Usage (from repo root):
 *   node scripts/normalize-typography.mjs            # DRY RUN — reports only
 *   node scripts/normalize-typography.mjs --write    # apply changes
 *
 * Review `git diff` after --write, then build + deploy as usual.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const WRITE = process.argv.includes("--write");
const ROOT = process.cwd();

// Directories to sweep (relative to repo root).
const INCLUDE_DIRS = ["app", "components", "hooks", "lib", "owner-vite/src"];
const EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "build"]);

// Files whose typography is an intentional embedded design — never normalize.
const DENY = /(studioHtml|social-cards?|x-post|post-images|post-studio|mockup|-ad\.|renders|banner|hero-composer|opengraph|twitter-image)/i;

// ── the scale ────────────────────────────────────────────────────────────────
// Snap a raw px number to the nearest tier. Returns null to LEAVE unchanged
// (display sizes >= 20 are preserved so heroes/countdowns aren't shrunk).
function snap(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 20) return null;   // display / hero — preserve
  if (n < 11) return 10;      // micro   (8,9,10,10.5)
  if (n < 13) return 12;      // label   (11,12,12.5)
  if (n < 15.5) return 14;    // body    (13,14,15)  ← unifies the 13–15 band
  return 17;                  // title   (16,17,18,19)
}
// NOTE: subhead 15 is a real tier but can't be told apart from body-15 by number
// alone, so the sweep folds 15 → 14 for a uniform body. Use the TYPE.subhead
// token by hand where a heading should sit at 15.

let filesChanged = 0, totalEdits = 0;
const perFile = [];

function processFile(path) {
  if (DENY.test(basename(path))) return;
  let src;
  try { src = readFileSync(path, "utf8"); } catch { return; }
  let edits = 0;

  const bump = (raw) => {
    const s = snap(parseFloat(raw));
    if (s == null || s === parseFloat(raw)) return null;
    edits++;
    return s;
  };

  // 1) JS/TS: fontSize: "14px"  or  fontSize: '14px'
  let out = src.replace(/\bfontSize:\s*(['"])(\d+(?:\.\d+)?)px\1/g, (m, q, num) => {
    const s = bump(num); return s == null ? m : `fontSize: ${q}${s}px${q}`;
  });
  // 2) JS/TS: fontSize: 14   (bare number literal, must be followed by a delimiter
  //    so we never touch expressions like `fontSize: x` or `fontSize: base + 2`)
  out = out.replace(/\bfontSize:\s*(\d+(?:\.\d+)?)(?=\s*[,}\]\)\n])/g, (m, num) => {
    const s = bump(num); return s == null ? m : `fontSize: ${s}`;
  });
  // 3) CSS / template CSS: font-size: 14px
  out = out.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, num) => {
    const s = bump(num); return s == null ? m : `font-size: ${s}px`;
  });

  if (edits > 0) {
    filesChanged++; totalEdits += edits;
    perFile.push([path.replace(ROOT + "/", ""), edits]);
    if (WRITE) writeFileSync(path, out);
  }
}

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full);
    else if (EXT.has(extname(name))) processFile(full);
  }
}

for (const d of INCLUDE_DIRS) walk(join(ROOT, d));

perFile.sort((a, b) => b[1] - a[1]);
console.log(`\nTypography ${WRITE ? "REWRITE" : "DRY RUN"} — scale: 10 / 12 / 14 / 15 / 17 (+20 display preserved)\n`);
for (const [f, n] of perFile.slice(0, 40)) console.log(`  ${String(n).padStart(4)}  ${f}`);
if (perFile.length > 40) console.log(`  … and ${perFile.length - 40} more files`);
console.log(`\n${totalEdits} edits across ${filesChanged} files.`);
console.log(WRITE ? "Applied. Review `git diff`, then build + deploy." : "Dry run — re-run with --write to apply.\n");
