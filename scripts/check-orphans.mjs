#!/usr/bin/env node
/**
 * Fail the build when a module that is SUPPOSED to be wired in isn't.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * lib/sharedCache.ts shipped to prod twice with nothing importing it. Both
 * times the file was present and correct, the call sites in EsChartCard.tsx had
 * been reverted, and every gate passed:
 *
 *   • next.config.js sets typescript.ignoreBuildErrors, so `next build` cannot
 *     fail on types — and an unused module is not a type error anyway;
 *   • `vite build` does no type checking at all;
 *   • the page still worked. It just quietly did 8 extra requests per load.
 *
 * An unimported module is invisible to every tool in the pipeline. Tree-shaking
 * removes it, the bundle shrinks, and the regression looks like a clean build.
 * This script is the only thing that would have caught it.
 *
 * ── TWO CHECKS ──────────────────────────────────────────────────────────────
 *   1. REQUIRED WIRING (hard fail under --strict). Each entry names a module
 *      and the files that must import it. Explicit, so there are no false
 *      positives, and the table doubles as documentation of what depends on
 *      what — which is the part that was missing when this regressed.
 *   2. GENERAL ORPHANS (warn only). Anything under lib/ that nothing imports.
 *      Advisory: plenty of legitimate reasons a helper is temporarily unused,
 *      and a noisy gate is a gate people learn to skip.
 *
 * Usage:
 *   node scripts/check-orphans.mjs            # report, always exit 0
 *   node scripts/check-orphans.mjs --strict   # exit 1 if required wiring broke
 *   node scripts/check-orphans.mjs --json     # machine-readable
 *
 * Wire it in with:
 *   npm pkg set scripts.prebuild="node scripts/audit-ui.mjs --strict && node scripts/check-orphans.mjs --strict"
 */

import fs from "node:fs";
import path from "node:path";

// Mirrors ROOTS in scripts/audit-ui.mjs.
const ROOTS = ["app", "components", "lib", "app-vite/src", "hooks", "scripts"];
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");

/**
 * Modules whose wiring is load-bearing and has silently regressed before.
 * `importedBy` paths are exact and repo-relative. Add an entry whenever you fix
 * a bug by *calling* something new — that call site is now the thing that can
 * quietly disappear.
 */
const REQUIRED_WIRING = [
  {
    module: "lib/sharedCache.ts",
    importedBy: [
      "components/dashboard/es-candles/EsChartCard.tsx",
      "components/dashboard/es-candles/ChainRail.tsx",
    ],
    why:
      "Collapses the page-global reads (levels, mvc, es-spx-basis, eod-gex, " +
      "expirations) that three EsChartCards would otherwise each fetch. " +
      "Reverted twice; both times it reached prod as 8 redundant requests per load.",
  },
  {
    module: "lib/dedupeFetch.ts",
    importedBy: ["components/dashboard/es-candles/EsChartCard.tsx"],
    why: "The option-strike-gex-history backfill relies on its holdMs window to stay at one request per card.",
  },
];

/** Files that may legitimately have no importer. */
const ORPHAN_ALLOW = [
  /^app\/.*\/(page|layout|route|error|loading|not-found|template|default)\.tsx?$/,
  /^app\/(global-error|error|not-found|opengraph-image|icon|apple-icon)\.tsx?$/,
  /^app-vite\/src\/main\.tsx$/,
  /^scripts\//,
  /\.d\.ts$/,
];

const SRC_EXT = /\.(tsx?|jsx?|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage"]);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel, out); }
    else if (SRC_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

/** Static imports/exports plus dynamic import() and require(). */
function specifiers(src) {
  const out = [];
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
  for (let m; (m = re.exec(src)); ) out.push(m[2]);
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
const srcOf = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

/** Resolve a specifier to a repo-relative file, or null if it isn't ours. */
function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else return null; // bare package
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
                      `${base}/index.ts`, `${base}/index.tsx`]) {
    if (srcOf.has(cand)) return cand;
  }
  return null;
}

// file -> Set of files importing it
const importedBy = new Map(files.map((f) => [f, new Set()]));
for (const [file, src] of srcOf) {
  for (const spec of specifiers(src)) {
    const target = resolve(spec, file);
    if (target && target !== file) importedBy.get(target).add(file);
  }
}

// ── Check 1: required wiring ────────────────────────────────────────────────
const broken = [];
for (const req of REQUIRED_WIRING) {
  if (!srcOf.has(req.module)) {
    broken.push({ ...req, problem: "module is missing entirely" });
    continue;
  }
  const actual = importedBy.get(req.module);
  const missing = req.importedBy.filter((f) => !actual.has(f));
  if (missing.length) {
    broken.push({
      ...req,
      problem: `not imported by ${missing.join(", ")}`,
      missing,
      stillImportedBy: [...actual],
    });
  }
}

// ── Check 2: general orphans under lib/ (advisory) ──────────────────────────
const orphans = files.filter(
  (f) => f.startsWith("lib/") &&
         importedBy.get(f).size === 0 &&
         !ORPHAN_ALLOW.some((re) => re.test(f)),
);

if (JSON_OUT) {
  console.log(JSON.stringify({ broken, orphans }, null, 2));
  process.exit(STRICT && broken.length ? 1 : 0);
}

if (orphans.length) {
  console.log(`check-orphans: ${orphans.length} unimported module(s) under lib/ (advisory):`);
  for (const o of orphans) console.log(`  · ${o}`);
  console.log("");
}

if (!broken.length) {
  console.log(`check-orphans: OK — ${REQUIRED_WIRING.length} required wiring rule(s) satisfied.`);
  process.exit(0);
}

console.error("\ncheck-orphans: FAIL\n");
for (const b of broken) {
  console.error(`  • ${b.module} — ${b.problem}`);
  console.error(`    why it matters: ${b.why}`);
  if (b.stillImportedBy?.length) console.error(`    still imported by: ${b.stillImportedBy.join(", ")}`);
  console.error("");
}
console.error("If this is intentional, update REQUIRED_WIRING in scripts/check-orphans.mjs");
console.error("in the SAME commit — an out-of-date table is worse than no table.\n");
process.exit(STRICT ? 1 : 0);
