#!/usr/bin/env node
/**
 * check-libdb-calls.mjs — fail the build when api-router calls a libDb function
 * the bundle doesn't export.
 *
 * WHY THIS EXISTS
 *   server-v2/api-router.js requires server-v2/_lib-db.cjs and calls ~200
 *   functions off it (as `libDb.x` or via the local alias `D.x`). Nothing
 *   verified those calls resolved, so a commit could add a call without adding
 *   the function and deploy perfectly green — the route just throws
 *   `TypeError: D.<fn> is not a function` at runtime, gets caught by the
 *   route's own try/catch, and returns a 500 the UI renders as "no data".
 *
 *   That shipped in v9.9.18 (2026-09-09): api-router gained
 *   `D.listPropRecurring(profile.id)`, `_lib-db.cjs` did not gain the function,
 *   and /owner/budget rendered every figure at zero with 927 rows sitting
 *   untouched in the table. It looked exactly like data loss.
 *
 * WHY NOT JUST REGENERATE THE BUNDLE
 *   Because you can't. The header in api-router.js says to rebuild it with
 *   esbuild from lib/db.ts. As of 2026-09-10 that command DELETES 32 functions
 *   the bundle has and lib/db.ts doesn't (listStatementTx, replaceOwnerTodo,
 *   normGexSymbol, the whole statement-import stack...). The two files have
 *   diverged in both directions and _lib-db.cjs is edited directly for now.
 *   See the 2026-09-10 (c) changelog entry. This guard is what makes that
 *   situation survivable: keep editing the bundle by hand, and let the build
 *   catch you when you forget.
 *
 * Wire it up in package.json:
 *   "prebuild": "node scripts/check-libdb-calls.mjs"
 * or add it to the existing build chain next to app-vite/scripts/check-routes.mjs.
 *
 * Run standalone:  node scripts/check-libdb-calls.mjs
 * Exit 0 = every call resolves. Exit 1 = at least one does not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = path.join(ROOT, 'server-v2', 'api-router.js');
const BUNDLE = path.join(ROOT, 'server-v2', '_lib-db.cjs');

// Calls that look like libDb but aren't — add a name here only after checking
// that the receiver really is a different object.
const IGNORE = new Set();

for (const f of [ROUTER, BUNDLE]) {
  if (!fs.existsSync(f)) {
    console.error(`[check-libdb] missing ${path.relative(ROOT, f)} — skipping (nothing to verify)`);
    process.exit(0);
  }
}

const router = fs.readFileSync(ROUTER, 'utf8');
const bundle = fs.readFileSync(BUNDLE, 'utf8');

// esbuild emits the export surface as `name: () => name,` inside its __export
// map. That map is authoritative — a function can exist in the file without
// being exported, and an unexported function is just as unreachable.
const exported = new Set();
for (const m of bundle.matchAll(/^\s+([A-Za-z_$][\w$]*): \(\) => \1,?$/gm)) exported.add(m[1]);

if (exported.size === 0) {
  console.error('[check-libdb] could not read the export map out of _lib-db.cjs — '
    + 'the bundle format changed. Fix this script rather than deleting it.');
  process.exit(1);
}

// `const D = libDb;` is the local alias used through most of the DB routes.
const called = new Map(); // name -> first line number seen
const lines = router.split('\n');
lines.forEach((line, i) => {
  for (const m of line.matchAll(/\b(?:libDb|D)\.([A-Za-z_$][\w$]*)\b/g)) {
    if (!called.has(m[1])) called.set(m[1], i + 1);
  }
});

const missing = [...called].filter(([name]) => !exported.has(name) && !IGNORE.has(name));

if (missing.length === 0) {
  console.log(`[check-libdb] OK — ${called.size} calls, all resolve against `
    + `${exported.size} bundle exports`);
  process.exit(0);
}

console.error('\n[check-libdb] FAIL — api-router.js calls functions _lib-db.cjs does not export:\n');
for (const [name, line] of missing) {
  console.error(`  server-v2/api-router.js:${line}  →  libDb.${name}()  NOT EXPORTED`);
}
console.error(`\n${missing.length} unresolved of ${called.size} calls.`);
console.error(
  '\nFix: add each function to server-v2/_lib-db.cjs — the body, plus its\n'
  + '`name: () => name,` line in the __export map near the top. Copy the\n'
  + 'implementation from lib/db.ts if it exists there.\n'
  + '\nDo NOT regenerate the bundle with esbuild from lib/db.ts. The two have\n'
  + 'diverged and a regenerate removes 32 functions the bundle needs. See the\n'
  + '2026-09-10 (c) entry in "md files/CHANGELOG.md".\n');
process.exit(1);
