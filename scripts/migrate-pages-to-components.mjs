#!/usr/bin/env node
/**
 * Move the Vite-owned page components out of app/ so Next stops routing them.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * app-vite/src/App.tsx mounts every route as `lazy(() => import('@/app/<r>/page'))`.
 * Those files therefore have to live under app/ — and anything named page.tsx
 * under app/ IS a Next route, built and served whether you want it or not. So
 * every migrated page has a shadow twin:
 *
 *     /es-candles        Next    app/es-candles/page.tsx
 *     /app/es-candles    Vite    app/app/es-candles/route.ts -> serveSpaShell
 *
 * Inside the SPA the next/link shim + basename="/app" rewrites hrefs to
 * /app/<r>, so in-SPA navigation never leaks. Links rendered on the Next side
 * (/home, /mult-greek) do leak, and so do bookmarks and typed URLs — which is
 * how you end up profiling the Next shell while believing you're on Vite.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *   1. Reads app-vite/src/App.tsx and discovers every `@/app/<r>/page` import.
 *      Discovery, not a hardcoded list, so it stays correct as routes change.
 *   2. git mv app/<r>/page.tsx -> components/pages/<Pascal>.tsx
 *   3. Rewrites RELATIVE imports inside each moved file back to where its
 *      siblings still live (./tickerContext -> @/app/options/tickerContext).
 *      This is the step that makes the move non-trivial: several of these pages
 *      import siblings that are NOT pages and must stay put.
 *   4. Rewrites `@/app/<r>/page` -> `@/components/pages/<Pascal>` repo-wide, so
 *      App.tsx and any other importer (app/home/HomeClient.tsx renders
 *      <EsCandlesPage embedded />) follow the move.
 *
 * Dry run by default. Pass --apply to touch the disk.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * KEEP_ROUTES below stays as Next routes on purpose — see the note there.
 * It also never deletes a directory: after a move, app/<r>/ may still hold
 * layout.tsx or sibling components. A layout with no page is inert in Next, so
 * leftovers are harmless; the report lists them and you decide.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const APPLY = process.argv.includes("--apply");
const APP_TSX = "app-vite/src/App.tsx";
const DEST_DIR = "components/pages";

/**
 * Routes that must KEEP a real Next page.
 *
 *   home        middleware.ts redirects every unpaid user and every failed
 *               owner-gate to /home. It is in PAID_EXEMPT; /app/home is not.
 *               Point /home at the SPA and an unpaid user loops:
 *               /home -> /app/home -> not exempt -> /home -> ...
 *               (App.tsx already imports ./routes/HomeRoute, not @/app/home/page,
 *               so this is belt-and-braces.)
 *   mult-greek  also in PAID_EXEMPT, same loop. App.tsx mounts MultGreekClient
 *               directly, which is not a page.tsx, so Next never routed it.
 */
const KEEP_ROUTES = new Set(["home", "mult-greek"]);

/** Route slug -> component filename. Anything not listed is derived. */
const NAME_OVERRIDES = { test: "TestLab" };

const SRC_EXT = /\.(tsx?|jsx?)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage"]);

const pascal = (slug) =>
  NAME_OVERRIDES[slug] ??
  slug.split(/[-_]/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join("");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(rel, out);
    } else if (SRC_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

/** Every module specifier in a file: static imports/exports AND dynamic import(). */
function specifiers(src) {
  const out = [];
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
  for (let m; (m = re.exec(src)); ) out.push({ index: m.index + m[0].indexOf(m[2]), spec: m[2] });
  return out;
}

// ── 1. Discover ─────────────────────────────────────────────────────────────
const appTsxPath = path.join(REPO, APP_TSX);
if (!fs.existsSync(appTsxPath)) {
  console.error(`Cannot find ${APP_TSX}. Run this from the repo root.`);
  process.exit(1);
}
const routes = [...new Set(
  specifiers(fs.readFileSync(appTsxPath, "utf8"))
    .map(({ spec }) => spec.match(/^@\/app\/([^/]+)\/page$/)?.[1])
    .filter(Boolean),
)].filter((r) => {
  if (KEEP_ROUTES.has(r)) { console.log(`  skip  ${r} (KEEP_ROUTES)`); return false; }
  return true;
});

const moves = [];
for (const slug of routes) {
  const from = `app/${slug}/page.tsx`;
  if (!fs.existsSync(path.join(REPO, from))) {
    console.warn(`  WARN  ${from} not found — route "${slug}" left alone`);
    continue;
  }
  moves.push({ slug, from, to: `${DEST_DIR}/${pascal(slug)}.tsx`, oldSpec: `@/app/${slug}/page`, newSpec: `@/${DEST_DIR}/${pascal(slug)}` });
}

if (!moves.length) { console.log("Nothing to move."); process.exit(0); }

console.log(`\n${moves.length} page${moves.length === 1 ? "" : "s"} to move:\n`);
for (const m of moves) console.log(`  ${m.from.padEnd(46)} -> ${m.to}`);

// ── 2/3. Move, and repoint the moved file's relative imports ────────────────
// A moved file's `./sibling` used to resolve inside app/<slug>/. From
// components/pages/ it resolves to a file that isn't there. Rewrite to the
// alias form so the sibling can stay exactly where it is.
const relRewrites = [];
for (const m of moves) {
  const src = fs.readFileSync(path.join(REPO, m.from), "utf8");
  const edits = [];
  for (const { index, spec } of specifiers(src)) {
    if (!spec.startsWith(".")) continue;
    const resolved = path.posix.normalize(path.posix.join(`app/${m.slug}`, spec));
    if (resolved.startsWith("..")) {
      console.warn(`  WARN  ${m.from}: "${spec}" escapes the repo — left as-is, fix by hand`);
      continue;
    }
    edits.push({ index, spec, next: `@/${resolved}` });
  }
  let out = src;
  for (const e of [...edits].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, e.index) + e.next + out.slice(e.index + e.spec.length);
  }
  relRewrites.push({ ...m, src, out, count: edits.length });
}

const totalRel = relRewrites.reduce((n, r) => n + r.count, 0);
console.log(`\n${totalRel} relative import${totalRel === 1 ? "" : "s"} inside moved files will be re-anchored to @/app/<route>/…`);
for (const r of relRewrites.filter((r) => r.count)) console.log(`  ${r.to}: ${r.count}`);

// ── 4. Repo-wide specifier rewrite ──────────────────────────────────────────
const specMap = new Map(moves.map((m) => [m.oldSpec, m.newSpec]));
const importerEdits = [];
for (const file of walk(".")) {
  if (moves.some((m) => m.from === file)) continue; // handled above
  const src = fs.readFileSync(path.join(REPO, file), "utf8");
  const edits = specifiers(src)
    .filter(({ spec }) => specMap.has(spec))
    .map(({ index, spec }) => ({ index, spec, next: specMap.get(spec) }));
  if (!edits.length) continue;
  let out = src;
  for (const e of [...edits].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, e.index) + e.next + out.slice(e.index + e.spec.length);
  }
  importerEdits.push({ file, out, count: edits.length });
}

console.log(`\n${importerEdits.length} file${importerEdits.length === 1 ? "" : "s"} import a moved page:\n`);
for (const e of importerEdits) console.log(`  ${e.file}  (${e.count})`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply.\n");
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(REPO, DEST_DIR), { recursive: true });
for (const r of relRewrites) {
  try {
    execFileSync("git", ["mv", r.from, r.to], { cwd: REPO, stdio: "pipe" });
  } catch {
    // Not tracked, or git unavailable — plain rename, then stage it.
    fs.renameSync(path.join(REPO, r.from), path.join(REPO, r.to));
    try { execFileSync("git", ["add", r.to], { cwd: REPO, stdio: "pipe" }); } catch { /* not a repo */ }
  }
  if (r.count) fs.writeFileSync(path.join(REPO, r.to), r.out);
}
for (const e of importerEdits) fs.writeFileSync(path.join(REPO, e.file), e.out);

// ── Report ──────────────────────────────────────────────────────────────────
console.log("\nApplied.\n");
const leftovers = [];
for (const m of moves) {
  const dir = path.join(REPO, "app", m.slug);
  if (!fs.existsSync(dir)) continue;
  const rest = fs.readdirSync(dir);
  if (rest.length) leftovers.push([m.slug, rest]);
}
if (leftovers.length) {
  console.log("Directories still holding files (a layout with no page is inert — review, don't bulk-delete):");
  for (const [slug, rest] of leftovers) console.log(`  app/${slug}/  ${rest.join(", ")}`);
} else {
  console.log("All source route directories are empty.");
}

// Next-only exports are inert outside app/. Not an error, but dead weight.
const deadExports = [];
for (const m of moves) {
  const src = fs.readFileSync(path.join(REPO, m.to), "utf8");
  const hits = [...src.matchAll(/^export\s+(?:const|async\s+function|function)\s+(metadata|generateMetadata|dynamic|revalidate|fetchCache|runtime|viewport)\b/gm)].map((x) => x[1]);
  if (hits.length) deadExports.push([m.to, [...new Set(hits)]]);
}
if (deadExports.length) {
  console.log("\nNext route exports that no longer do anything (safe to delete):");
  for (const [file, names] of deadExports) console.log(`  ${file}: ${names.join(", ")}`);
}

console.log(`
Next:
  npx tsc --noEmit
  npm run build            # confirm /es-candles & co. are gone from the route list
  cd app-vite && npm run build
`);
